/**
 * Execute commands inside a VM via the vsock guest agent.
 *
 * This uses Firecracker's virtio-vsock to communicate with the krova-agent
 * running inside the guest — completely bypassing the VM's network stack and SSH.
 * The customer CANNOT block, disable, or interfere with this channel.
 *
 * NO SSH keys are stored inside the VM for platform management.
 * The vsock guest agent is the sole management channel.
 *
 * Replaces the QEMU Guest Agent approach (virsh qemu-agent-command).
 *
 * Communication flow:
 *   Worker → SSH to host → krova-vsock-exec → Firecracker vsock UDS → guest agent
 */

import type { Client } from "ssh2";
import { execCommand } from "@/lib/ssh/exec";
import { cubePaths } from "@/lib/ssh/jailer";
import { shellEscape } from "@/lib/ssh/utils";

const VSOCK_EXEC = "/usr/local/bin/krova-vsock-exec";

/**
 * Shell prelude that sets `$VS` to the cube's vsock UDS for whichever launch
 * mode it is in — jailed (chroot path) vs bare (cube-dir path) — by probing
 * which socket exists. Mode-agnostic with NO extra round-trip (folded into the
 * command that follows) and NO signature change across guest-exec's many
 * callers. The cube id is CUID2 (safe chars), so the literal paths need no
 * quoting; `$VS` is quoted at the use site.
 */
function vsockResolvePrelude(cubeId: string): string {
  const jailV = cubePaths(cubeId, "jailed").vsockPath;
  const bareV = cubePaths(cubeId, "bare").vsockPath;
  return `VS=$([ -S ${jailV} ] && printf %s ${jailV} || printf %s ${bareV}); `;
}

export interface GuestExecResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

/**
 * Execute a command inside a VM via the vsock guest agent.
 * This is the ONLY way the platform executes commands inside VMs.
 * No SSH keys, no management sshd, no fallback.
 */
export async function guestExec(
  client: Client,
  cubeId: string,
  command: string,
  timeoutMs = 30_000
): Promise<GuestExecResult> {
  // Base64 encode the shell command for safe JSON embedding
  const cmdB64 = Buffer.from(command).toString("base64");

  // Build the JSON command for the guest agent
  const agentCmd = JSON.stringify({
    cmd: "exec",
    payload: cmdB64,
    timeout: Math.floor(timeoutMs / 1000),
  });

  // Shell-escape the JSON to prevent injection when passed as a CLI argument.
  // shellEscape wraps in single quotes and escapes embedded single quotes.
  const result = await execCommand(
    client,
    `${vsockResolvePrelude(cubeId)}${VSOCK_EXEC} "$VS" ${shellEscape(agentCmd)}`,
    timeoutMs + 10_000 // Add buffer for connection overhead
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `Guest agent exec failed: ${result.stderr || result.stdout}`
    );
  }

  // Parse the JSON response from the agent
  let response: {
    status: string;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    message?: string;
  };

  try {
    response = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error(
      `Failed to parse guest agent response: ${result.stdout.slice(0, 500)}`
    );
  }

  if (response.status === "error") {
    throw new Error(
      `Guest agent error: ${response.message || "unknown error"}`
    );
  }

  const stdout = response.stdout
    ? Buffer.from(response.stdout, "base64").toString()
    : "";
  const stderr = response.stderr
    ? Buffer.from(response.stderr, "base64").toString()
    : "";

  return {
    exitCode: response.exitCode ?? 0,
    stdout,
    stderr,
  };
}

/**
 * Ping the guest agent to check if the VM is responsive.
 * Returns true if the agent responds, false otherwise.
 */
export async function guestPing(
  client: Client,
  cubeId: string
): Promise<boolean> {
  try {
    const result = await execCommand(
      client,
      `${vsockResolvePrelude(cubeId)}${VSOCK_EXEC} "$VS" '{"cmd":"ping"}'`,
      10_000
    );

    if (result.exitCode !== 0) {
      return false;
    }

    const response = JSON.parse(result.stdout.trim());
    return response.status === "ok";
  } catch {
    return false;
  }
}

/**
 * Live resource snapshot from the in-guest agent. All counter fields are
 * point-in-time values from /proc; cpu_*_pct are derived from a short
 * (~100ms) /proc/stat delta sample inside the agent.
 */
export interface GuestMetrics {
  cpu_idle_pct: number;
  cpu_system_pct: number;
  cpu_user_pct: number;
  disk_avail_bytes: number;
  disk_total_bytes: number;
  disk_used_bytes: number;
  load_avg_1m: number;
  load_avg_5m: number;
  load_avg_15m: number;
  mem_available_kb: number;
  mem_total_kb: number;
  mem_used_kb: number;
  uptime_sec: number;
}

/**
 * Ask the guest agent for a live resource snapshot. Returns null if the
 * agent doesn't respond, returns an error envelope, or returns an
 * unparseable payload — callers treat null the same as "agent unreachable".
 */
export async function guestMetrics(
  client: Client,
  cubeId: string
): Promise<GuestMetrics | null> {
  try {
    const result = await execCommand(
      client,
      `${vsockResolvePrelude(cubeId)}${VSOCK_EXEC} "$VS" '{"cmd":"metrics"}'`,
      10_000
    );

    if (result.exitCode !== 0) {
      return null;
    }

    const response = JSON.parse(result.stdout.trim()) as
      | (GuestMetrics & { status: "ok" })
      | { status: "error"; message?: string };

    if (response.status !== "ok") {
      return null;
    }

    return {
      uptime_sec: response.uptime_sec,
      load_avg_1m: response.load_avg_1m,
      load_avg_5m: response.load_avg_5m,
      load_avg_15m: response.load_avg_15m,
      cpu_user_pct: response.cpu_user_pct,
      cpu_system_pct: response.cpu_system_pct,
      cpu_idle_pct: response.cpu_idle_pct,
      mem_total_kb: response.mem_total_kb,
      mem_used_kb: response.mem_used_kb,
      mem_available_kb: response.mem_available_kb,
      disk_total_bytes: response.disk_total_bytes,
      disk_used_bytes: response.disk_used_bytes,
      disk_avail_bytes: response.disk_avail_bytes,
    };
  } catch {
    return null;
  }
}
