/**
 * Server bootstrap phase: connect with operator-supplied initial creds, push
 * the platform's public key, switch sshd to port 2822, disable password auth.
 *
 * Uses the safe ADD-2822-then-REMOVE-22 pattern with an `at`-scheduled rollback
 * so that a misconfigured firewall or sshd_config can't lock us out of the box.
 *
 * On success: server.sshPort=2822, setupPhase advances to "install".
 * On failure: setupStatus=failed; original port 22 remains reachable.
 */

import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { Client } from "ssh2";
import { servers, sshKeys } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { decryptBootstrapCreds } from "@/lib/server/bootstrap-creds";
import {
  DISK_TOPOLOGY_PROBE,
  type DiskTopology,
  parseDiskTopology,
} from "@/lib/server/disk-topology";
import { type NumaTopology, parseNumaCpulists } from "@/lib/server/numa";
import {
  claimPhaseRunning,
  completePhase,
  failPhase,
} from "@/lib/server/setup-phase";
import { decryptPrivateKey } from "@/lib/ssh";
import { execCommand } from "@/lib/ssh/exec";
import { JobLogger } from "@/lib/worker/job-log";
import type { ServerBootstrapPayload } from "@/lib/worker/job-types";

const TARGET_PORT = 2822;
const ROLLBACK_TIMEOUT_SEC = 300;
const SSHD_BACKUP = "/etc/ssh/sshd_config.krova-bootstrap-backup";
/** Marker file the rollback subshell checks for. If present when sleep ends,
 *  rollback fires; if removed (cancellation), it does not. */
const ROLLBACK_MARKER = "/tmp/krova-bootstrap-rollback-active";

function connect(opts: {
  host: string;
  port: number;
  user: string;
  password?: string;
  privateKey?: string;
}): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const timer = setTimeout(() => {
      client.destroy();
      reject(
        new Error(`SSH connection to ${opts.host}:${opts.port} timed out`)
      );
    }, 30_000);
    client
      .on("ready", () => {
        clearTimeout(timer);
        resolve(client);
      })
      .on("error", (err) => {
        clearTimeout(timer);
        reject(
          new Error(
            `SSH connection to ${opts.host}:${opts.port} failed: ${err.message}`
          )
        );
      })
      .connect({
        host: opts.host,
        port: opts.port,
        username: opts.user,
        ...(opts.password ? { password: opts.password } : {}),
        ...(opts.privateKey ? { privateKey: opts.privateKey } : {}),
        readyTimeout: 30_000,
        tryKeyboard: !!opts.password,
      });
  });
}

async function runHandler(job: Job<ServerBootstrapPayload>): Promise<void> {
  const { serverId, encryptedCreds } = job.data;
  const phase = "bootstrap" as const;

  const claimed = await claimPhaseRunning(serverId, phase);
  if (!claimed) {
    console.log(`[server-bootstrap] ${serverId} not claimable, skipping`);
    return;
  }

  const log = new JobLogger(job.id, "server.bootstrap", "server", serverId);
  let bootstrapClient: Client | null = null;

  try {
    await log.info("Bootstrap phase started");

    const server = await db.query.servers.findFirst({
      where: eq(servers.id, serverId),
    });
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    const platformKey = await db.query.sshKeys.findFirst({
      where: eq(sshKeys.id, server.sshKeyId),
    });
    if (!platformKey) {
      throw new Error("Platform SSH key not found");
    }

    const creds = decryptBootstrapCreds(encryptedCreds);

    // 1. Connect with operator's initial creds
    bootstrapClient = await log.step(
      `Connect via operator credentials (${creds.initialUser}@${server.publicIp}:${creds.initialPort})`,
      async () =>
        connect({
          host: server.publicIp,
          port: creds.initialPort,
          user: creds.initialUser,
          password: creds.password,
          privateKey: creds.privateKey,
        })
    );

    // 2. Preflight — must be Linux, must have sshd_config writable
    await log.step(
      "Preflight checks (Linux + sshd_config writable)",
      async () => {
        const uname = await execCommand(bootstrapClient!, "uname -s", 5000);
        if (
          uname.exitCode !== 0 ||
          !uname.stdout.toLowerCase().includes("linux")
        ) {
          throw new Error("Target server is not running Linux");
        }
        const sshdCheck = await execCommand(
          bootstrapClient!,
          "test -w /etc/ssh/sshd_config && echo writable || echo readonly",
          5000
        );
        if (sshdCheck.stdout.trim() !== "writable") {
          throw new Error(
            "Cannot write to /etc/ssh/sshd_config — connect as root or a sudoer with NOPASSWD"
          );
        }
      }
    );

    // 2b. Detect hardware capacity. Read-only — runs before any destructive
    //     sshd changes so a parse failure aborts cleanly. Values are persisted
    //     in step 10 alongside sshPort.
    let totalCpus = 0;
    let totalRamMb = 0;
    let totalDiskGb = 0;
    let numaNodeCount = 1;
    let numaTopology: NumaTopology = [];
    let diskTopology: DiskTopology = [];
    await log.step("Detect hardware capacity", async () => {
      const cpuRes = await execCommand(bootstrapClient!, "nproc", 5000);
      const ramRes = await execCommand(
        bootstrapClient!,
        "awk '/^MemTotal:/ {printf \"%d\", $2/1024}' /proc/meminfo",
        5000
      );
      const diskRes = await execCommand(
        bootstrapClient!,
        "df -B1G --output=size / | awk 'NR==2 {print $1}'",
        5000
      );
      totalCpus = Number.parseInt(cpuRes.stdout.trim(), 10);
      totalRamMb = Number.parseInt(ramRes.stdout.trim(), 10);
      totalDiskGb = Number.parseInt(diskRes.stdout.trim(), 10);
      if (
        cpuRes.exitCode !== 0 ||
        ramRes.exitCode !== 0 ||
        diskRes.exitCode !== 0 ||
        !Number.isFinite(totalCpus) ||
        totalCpus <= 0 ||
        !Number.isFinite(totalRamMb) ||
        totalRamMb <= 0 ||
        !Number.isFinite(totalDiskGb) ||
        totalDiskGb <= 0
      ) {
        throw new Error(
          `Hardware detection failed: cpus="${cpuRes.stdout.trim()}" ram="${ramRes.stdout.trim()}" disk="${diskRes.stdout.trim()}"`
        );
      }
      // NUMA topology (read-only, UNGATED — recorded regardless of the L2 flag).
      // One line per node: "<node>\t<cpulist>". A non-NUMA / single-socket kernel
      // has no node* dirs → empty → numaNodeCount 1, topology [] (the L2 no-op).
      const numaRes = await execCommand(
        bootstrapClient!,
        `for n in /sys/devices/system/node/node[0-9]*; do [ -d "$n" ] && printf '%s\\t%s\\n' "$(basename "$n" | tr -dc 0-9)" "$(cat "$n/cpulist")"; done`,
        5000
      );
      numaTopology = parseNumaCpulists(numaRes.stdout);
      numaNodeCount = Math.max(1, numaTopology.length);

      // Disk topology (read-only, UNGATED — recorded regardless of any flag,
      // mirrors NUMA above; Rule 35 auto-detect). Tolerant: odd/loop-only
      // layouts → [] → the disk-tuning paths fall back to base/no-op behavior.
      const diskTopoRes = await execCommand(
        bootstrapClient!,
        DISK_TOPOLOGY_PROBE,
        5000
      );
      diskTopology = parseDiskTopology(diskTopoRes.stdout);
    });
    await log.info(
      `Hardware: ${totalCpus} CPUs · ${totalRamMb} MB RAM · ${totalDiskGb} GB disk`
    );

    // 3. Append platform public key to root's authorized_keys (idempotent).
    //    The pubkey is base64-encoded over the wire so untrusted bytes can't
    //    break out of the shell command. Decoded into a temp file on the host,
    //    then grep-then-append to avoid duplicates.
    const pubKeyB64 = Buffer.from(platformKey.publicKey.trim()).toString(
      "base64"
    );
    await log.step("Install platform public key", async () => {
      const keyAppendRes = await execCommand(
        bootstrapClient!,
        [
          "mkdir -p /root/.ssh",
          "chmod 700 /root/.ssh",
          "touch /root/.ssh/authorized_keys",
          "chmod 600 /root/.ssh/authorized_keys",
          "T=$(mktemp)",
          `echo '${pubKeyB64}' | base64 -d > "$T"`,
          'grep -qFf "$T" /root/.ssh/authorized_keys 2>/dev/null || cat "$T" >> /root/.ssh/authorized_keys',
          'rm -f "$T"',
        ].join(" && "),
        10_000
      );
      if (keyAppendRes.exitCode !== 0) {
        throw new Error(
          `exit ${keyAppendRes.exitCode}: ${keyAppendRes.stderr.slice(-500) || keyAppendRes.stdout.slice(-500)}`
        );
      }
    });

    // 4. Save backup of sshd_config + arm a backgrounded-sleep rollback that
    //    fires if we don't cancel within ROLLBACK_TIMEOUT_SEC. No external
    //    dependency (no `at`), works on every standard distro. The marker
    //    file is checked AFTER sleep — removing it cancels rollback.
    await log.step("Arm sshd_config rollback safety net", async () => {
      await execCommand(
        bootstrapClient!,
        `cp /etc/ssh/sshd_config ${SSHD_BACKUP}`,
        5000
      );
      await execCommand(bootstrapClient!, `touch ${ROLLBACK_MARKER}`, 5000);
      // nohup + disown so the subshell survives the SSH session closing.
      await execCommand(
        bootstrapClient!,
        `nohup bash -c 'sleep ${ROLLBACK_TIMEOUT_SEC} && [ -f ${ROLLBACK_MARKER} ] && cp ${SSHD_BACKUP} /etc/ssh/sshd_config && systemctl reload sshd; rm -f ${ROLLBACK_MARKER}' </dev/null >/dev/null 2>&1 &`,
        10_000
      );
    });

    // 4b. Pre-clear barriers that would prevent sshd from binding to 2822:
    //     SELinux (RHEL-family blocks non-default sshd ports), firewalld, ufw.
    //     Each branch is best-effort and idempotent — silent on systems where
    //     the tool isn't installed or active.
    await log.step(
      `Pre-clear firewall + SELinux for port ${TARGET_PORT}`,
      async () => {
        await execCommand(
          bootstrapClient!,
          [
            // SELinux: register port 2822 as ssh_port_t when SELinux is enforcing
            'if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = Enforcing ]; then',
            "  command -v semanage >/dev/null 2>&1 || dnf install -y policycoreutils-python-utils >/dev/null 2>&1 || yum install -y policycoreutils-python-utils >/dev/null 2>&1 || true;",
            `  semanage port -a -t ssh_port_t -p tcp ${TARGET_PORT} 2>/dev/null || semanage port -m -t ssh_port_t -p tcp ${TARGET_PORT} 2>/dev/null || true;`,
            "fi;",
            // firewalld
            `if systemctl is-active --quiet firewalld 2>/dev/null; then firewall-cmd --add-port=${TARGET_PORT}/tcp --permanent >/dev/null 2>&1 || true; firewall-cmd --reload >/dev/null 2>&1 || true; fi;`,
            // ufw
            `if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then ufw allow ${TARGET_PORT}/tcp >/dev/null 2>&1 || true; fi;`,
            "true",
          ].join(" "),
          120_000
        );
      }
    );

    // 5. Add `Port 2822` (keep Port 22 for now), validate config, RESTART sshd
    //    (not reload — Ubuntu/Debian 22+ socket-activated ssh.socket only picks
    //    up new Port directives on a full daemon restart, and only after the
    //    socket itself is disabled so the daemon owns its own listeners).
    //    Then verify sshd actually bound to 2822 *locally* before doing the
    //    remote SSH probe — isolates "sshd misconfig" from "remote network
    //    can't reach 2822" so failures are diagnosable.
    await log.step(
      `Configure sshd to listen on ${TARGET_PORT} + verify local bind`,
      async () => {
        await execCommand(
          bootstrapClient!,
          `grep -qE '^Port ${TARGET_PORT}' /etc/ssh/sshd_config || echo 'Port ${TARGET_PORT}' >> /etc/ssh/sshd_config`,
          5000
        );
        const sshdValidate = await execCommand(
          bootstrapClient!,
          "sshd -t",
          5000
        );
        if (sshdValidate.exitCode !== 0) {
          throw new Error(
            `sshd_config validation failed: ${sshdValidate.stderr.trim() || sshdValidate.stdout.trim()}`
          );
        }

        // Detect the actual sshd service unit name + handle socket activation.
        // - Ubuntu/Debian: unit is `ssh.service`, often fronted by `ssh.socket`
        // - RHEL family: unit is `sshd.service`, no socket
        // If the socket is active, sshd inherits its listeners from the socket
        // and the `Port` directive in sshd_config is ignored. We disable the
        // socket so sshd owns its own listeners, then restart the daemon.
        const restartRes = await execCommand(
          bootstrapClient!,
          [
            "set -e",
            "if systemctl list-unit-files 2>/dev/null | grep -q '^sshd\\.service'; then UNIT=sshd.service; else UNIT=ssh.service; fi",
            "if systemctl is-active ssh.socket >/dev/null 2>&1; then systemctl stop ssh.socket; systemctl disable ssh.socket >/dev/null 2>&1 || true; fi",
            'systemctl enable "$UNIT" >/dev/null 2>&1 || true',
            'systemctl restart "$UNIT"',
            'echo "sshd unit: $UNIT"',
          ].join("; "),
          30_000
        );
        if (restartRes.exitCode !== 0) {
          throw new Error(
            `sshd restart failed: ${restartRes.stderr.slice(-500) || restartRes.stdout.slice(-500)}`
          );
        }

        const bindCheck = await execCommand(
          bootstrapClient!,
          // Try ss first; fall back to netstat on systems without iproute2.
          // Then on failure, dump journalctl for both `sshd` and `ssh` units
          // (Debian/Ubuntu use the latter), plus tail /var/log/auth.log if
          // present (some Debian/Ubuntu setups still write there).
          "for i in 1 2 3 4 5 6 7 8; do " +
            `(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -qE ':${TARGET_PORT}\\b' && exit 0; ` +
            "sleep 1; " +
            "done; " +
            `echo '=== journalctl ==='; ` +
            `journalctl -u sshd -u ssh --since '2 minutes ago' --no-pager 2>/dev/null | tail -40; ` +
            `echo '=== auth.log ==='; ` +
            "tail -40 /var/log/auth.log 2>/dev/null || true; " +
            `echo '=== sshd_config ==='; ` +
            `grep -E '^(Port|ListenAddress)' /etc/ssh/sshd_config || true; ` +
            "exit 1",
          20_000
        );
        if (bindCheck.exitCode !== 0) {
          throw new Error(
            `sshd did not bind to port ${TARGET_PORT} after restart. Diagnostic dump:\n${bindCheck.stdout.slice(-2000) || bindCheck.stderr.slice(-2000)}`
          );
        }
      }
    );

    // 6. Verify 2822 works with the platform key
    const platformKeyDecrypted = decryptPrivateKey(
      platformKey.encryptedPrivateKey,
      env.APP_SECRET
    );
    await log.step(`Verify platform key access on ${TARGET_PORT}`, async () => {
      const verifyClient = await connect({
        host: server.publicIp,
        port: TARGET_PORT,
        user: "root",
        privateKey: platformKeyDecrypted,
      });
      const probe = await execCommand(verifyClient, "echo ok", 5000);
      verifyClient.end();
      if (probe.stdout.trim() !== "ok") {
        throw new Error(
          `sshd on port ${TARGET_PORT} not reachable with platform key`
        );
      }
    });

    // 7. Now safe to remove Port 22 + disable password auth
    await log.step("Disable port 22 + password auth", async () => {
      await execCommand(
        bootstrapClient!,
        `sed -i '/^Port 22$/d' /etc/ssh/sshd_config && \
       sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && \
       grep -q '^PasswordAuthentication ' /etc/ssh/sshd_config || echo 'PasswordAuthentication no' >> /etc/ssh/sshd_config && \
       sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config && \
       grep -q '^PermitRootLogin ' /etc/ssh/sshd_config || echo 'PermitRootLogin prohibit-password' >> /etc/ssh/sshd_config`,
        10_000
      );
      await execCommand(bootstrapClient!, "systemctl reload sshd", 10_000);
    });

    // 8. Final verification — must still reach 2822 with platform key after the lockdown
    await log.step("Final hardened verification", async () => {
      const finalClient = await connect({
        host: server.publicIp,
        port: TARGET_PORT,
        user: "root",
        privateKey: platformKeyDecrypted,
      });
      const finalProbe = await execCommand(finalClient, "echo ok", 5000);
      finalClient.end();
      if (finalProbe.stdout.trim() !== "ok") {
        throw new Error("Final hardened verification failed");
      }
    });

    // 9. Cancel rollback (remove marker — sleeping subshell will skip restore
    //    when sleep ends) and remove the sshd_config backup.
    await execCommand(
      bootstrapClient,
      `rm -f ${ROLLBACK_MARKER} ${SSHD_BACKUP}`,
      5000
    ).catch(() => {});

    // 10. Persist the new SSH port + detected hardware capacity, advance phase
    await db
      .update(servers)
      .set({
        sshPort: TARGET_PORT,
        totalCpus,
        totalRamMb,
        totalDiskGb,
        numaNodeCount,
        numaTopology: numaTopology.length > 0 ? numaTopology : null,
        diskTopology: diskTopology.length > 0 ? diskTopology : null,
        updatedAt: new Date(),
      })
      .where(eq(servers.id, serverId));

    await log.info(
      `Bootstrap phase complete — port ${TARGET_PORT}, ${totalCpus} CPUs, ${totalRamMb} MB RAM, ${totalDiskGb} GB disk`
    );
    await completePhase(serverId, phase);

    audit({
      action: "server.setup.bootstrap_complete",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Server "${server.hostname}" bootstrap complete — port ${TARGET_PORT}, ${totalCpus} CPUs, ${totalRamMb} MB RAM, ${totalDiskGb} GB disk`,
      metadata: { totalCpus, totalRamMb, totalDiskGb },
      source: "worker",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[server-bootstrap] failed for ${serverId}:`, err);
    await log.error(`Bootstrap phase failed: ${msg}`);
    await failPhase(serverId, phase, msg);
    audit({
      action: "server.setup.bootstrap_failed",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Server bootstrap failed: ${msg.slice(0, 200)}`,
      metadata: { error: msg.slice(0, 1000) },
      source: "worker",
    });
  } finally {
    if (bootstrapClient) {
      try {
        bootstrapClient.end();
      } catch {
        /* noop */
      }
    }
  }
}

export async function handleServerBootstrap(
  jobs: Job<ServerBootstrapPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await runHandler(job);
  }
}
