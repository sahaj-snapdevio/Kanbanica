/**
 * Cube reachability + live-metrics cron.
 *
 * Runs every minute on top of `cube.state-sync` (which polls Firecracker's
 * hypervisor state every 2 minutes). State-sync answers "is the VM
 * running?"; this job answers "is the guest actually usable?" with three
 * layers:
 *
 *   L1  vsock ping        Guest kernel + userspace responsive
 *   L2  SSH port reachable sshd inside the cube (probed directly via the
 *                          cube's bridge IP — NOT 127.0.0.1:<hostPort>,
 *                          which would skip iptables PREROUTING and
 *                          always fail; see checkSshPort below)
 *   L3  live metrics      Load / CPU / mem / disk snapshot from the agent
 *
 * The three checks run SEQUENTIALLY per cube (not parallel) and the
 * per-server cube concurrency is capped so the worker never exceeds
 * sshd's default MaxSessions=10. Earlier versions parallel-fired
 * 3×N exec channels on a single SSH connection and tripped that limit,
 * producing spurious `agentOk:false` flips that looked like real
 * outages — keeping the channel budget low is what makes the cron
 * trustworthy.
 *
 * Per-tick output is a `CubeReachabilitySnapshot` + a `CubeMetricsSnapshot`
 * persisted on the cube row (additive nullable columns, no history). A
 * Pusher `cube.reachability` event is fired on `private-cube-{cubeId}`
 * so the detail page can render the badge + metrics live without polling.
 *
 * The job is a pure observer — it never transitions cube.status and never
 * touches updatedAt. State changes still go through `cube.state-sync` and
 * the deliberate lifecycle handlers (cube-sleep, cube-wake, etc.).
 */

import { and, eq, inArray, ne } from "drizzle-orm";
import type { Client } from "ssh2";
import { DEFAULT_CUBE_SSH_PORT } from "@/config/platform";
import {
  type CubeMetricsSnapshot,
  type CubeReachabilitySnapshot,
  cubes,
  servers,
  sshKeys,
  tcpPortMappings,
} from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { triggerEvent } from "@/lib/pusher";
import {
  createSshConnection,
  decryptPrivateKey,
  execCommand,
  guestMetrics,
  guestPing,
} from "@/lib/ssh";

const SERVER_BATCH_SIZE = 10;
const PER_SERVER_CUBE_CONCURRENCY = 5;
// Outer wrapper timeout per guest check. MUST exceed the inner execCommand
// timeout (10s in guestPing/guestMetrics) — otherwise the outer fires first,
// abandons the promise, but the inner vsock channel keeps running until ITS
// 10s timeout, overlapping the next serial check and eating MaxSessions
// headroom. At 12s the inner 10s timeout always tears the channel down first.
const PER_CHECK_TIMEOUT_MS = 12_000;
const SSH_PROBE_TIMEOUT_MS = 4000;

type ActiveServer = {
  id: string;
  hostname: string;
  publicIp: string;
  sshPort: number;
  sshKeyId: string;
};

type ActiveCube = {
  id: string;
  spaceId: string;
  status: string;
  /** Internal bridge IP of the cube (e.g. 10.<S>.x). Guaranteed non-null
   *  by the `loadServerCubes` filter (we only enqueue probes for cubes in
   *  `status='running'`, and any cube that ever reached `running` has had
   *  `internalIp` persisted by `cube-boot.ts` step 5b). Used for the L2 SSH
   *  probe — the host and cube share the br0 bridge so we can hit the
   *  cube's sshd directly via its private IP, bypassing the iptables NAT
   *  path that 127.0.0.1:<hostPort> would otherwise require us to traverse. */
  internalIp: string;
  /** The port sshd is listening on inside the cube right now. Read live from
   *  the SSH-flagged row in `tcp_port_mappings` — the source of truth for
   *  "which port the iptables DNAT for SSH currently points at". Defaults to
   *  DEFAULT_CUBE_SSH_PORT when no SSH mapping row exists yet (e.g. a cube
   *  mid-provision). Hardcoding 22 here would silently lie about
   *  reachability for any customer who has moved sshd inside their cube and
   *  updated us via `PUT /cubes/{cubeId}/ssh-port`. */
  cubeSshPort: number;
  /** Existing snapshot — used to preserve `last*SeenAt` across failed ticks. */
  prevReachability: CubeReachabilitySnapshot | null;
};

export async function handleCubeReachability(): Promise<void> {
  const activeServers = await db
    .select({
      id: servers.id,
      hostname: servers.hostname,
      publicIp: servers.publicIp,
      sshPort: servers.sshPort,
      sshKeyId: servers.sshKeyId,
    })
    .from(servers)
    .where(eq(servers.status, "active"));

  for (let i = 0; i < activeServers.length; i += SERVER_BATCH_SIZE) {
    const batch = activeServers.slice(i, i + SERVER_BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async (server) => {
        try {
          await pollServer(server);
        } catch (err) {
          console.error(
            `[cube-reachability] server ${server.hostname} failed:`,
            err
          );
        }
      })
    );
  }
}

async function pollServer(server: ActiveServer): Promise<void> {
  const sshKey = await db.query.sshKeys.findFirst({
    where: eq(sshKeys.id, server.sshKeyId),
  });
  if (!sshKey) {
    return;
  }

  const targets = await loadServerCubes(server.id);
  if (targets.length === 0) {
    return;
  }

  const decryptedKey = decryptPrivateKey(
    sshKey.encryptedPrivateKey,
    env.APP_SECRET
  );

  let client;
  try {
    client = await createSshConnection(
      server.publicIp,
      server.sshPort,
      decryptedKey
    );
  } catch {
    return; // can't reach host; the next tick will retry
  }

  try {
    // Cap concurrent cubes per server. Each cube serializes its own 3
    // checks (ping → metrics → ssh-probe), so the number of parallel SSH
    // exec channels on this connection is exactly the batch size.
    // sshd's default `MaxSessions=10` — keeping this at 5 leaves headroom
    // for ad-hoc admin / monitoring channels on the same connection.
    for (let i = 0; i < targets.length; i += PER_SERVER_CUBE_CONCURRENCY) {
      const batch = targets.slice(i, i + PER_SERVER_CUBE_CONCURRENCY);
      await Promise.allSettled(batch.map((cube) => pollCube(client, cube)));
    }
  } finally {
    client.end();
  }
}

async function loadServerCubes(serverId: string): Promise<ActiveCube[]> {
  // Active = on hypervisor and (in DB's view) usable. Skip transferring cubes
  // so we don't bother a half-migrated VM whose vsock socket may not exist.
  //
  // The query LEFT-JOINs `tcp_port_mappings` to pick up the cube's CURRENT
  // sshd port (the row flagged `isSsh=true`). When a customer moves sshd
  // off port 22 and updates us via the Networking-tab PATCH flow, that row
  // is rewritten — reading it here is what makes the L2 probe self-heal
  // instead of forever probing :22. Status filter is `active | pending`
  // because a port-edit briefly flips the row to `pending` while the
  // worker swaps the iptables rule; testing the new port during that
  // window is correct (and harmless if the rule isn't installed yet —
  // the probe just fails for one tick).
  const rows = await db
    .select({
      id: cubes.id,
      spaceId: cubes.spaceId,
      status: cubes.status,
      internalIp: cubes.internalIp,
      reachabilityJsonb: cubes.reachabilityJsonb,
      transferState: cubes.transferState,
      sshCubePort: tcpPortMappings.cubePort,
    })
    .from(cubes)
    .leftJoin(
      tcpPortMappings,
      and(
        eq(tcpPortMappings.cubeId, cubes.id),
        eq(tcpPortMappings.isSsh, true),
        inArray(tcpPortMappings.status, ["active", "pending"])
      )
    )
    .where(
      and(
        eq(cubes.serverId, serverId),
        inArray(cubes.status, ["running"]),
        ne(cubes.transferState, "snapshotting"),
        ne(cubes.transferState, "restoring"),
        ne(cubes.transferState, "finalizing"),
        // Also exclude `cancelling` — the cancel handler may be mid-recovery
        // (waking the source, tearing down destination) and a stale
        // reachability probe could observe an inconsistent VM. See audit M11.
        ne(cubes.transferState, "cancelling")
      )
    );

  // Every cube row has `internalIp` assigned — `cube-boot.ts` allocates and
  // persists it (step 5b) before the cube ever leaves `pending`, so any row
  // visible here always carries one. The schema column is technically
  // nullable to model the pending-pre-boot worker-only window; the `!`
  // below reflects the runtime invariant.
  return rows.map((r) => ({
    id: r.id,
    spaceId: r.spaceId,
    status: r.status,
    internalIp: r.internalIp!,
    cubeSshPort: r.sshCubePort ?? DEFAULT_CUBE_SSH_PORT,
    prevReachability: r.reachabilityJsonb,
  }));
}

async function pollCube(client: Client, cube: ActiveCube): Promise<void> {
  const nowIso = new Date().toISOString();

  // SERIALIZE the three checks. Running them in parallel here multiplies
  // the SSH-channel count by 3× per cube, which combined with
  // PER_SERVER_CUBE_CONCURRENCY would burn through sshd's
  // `MaxSessions=10` budget and produce spurious `agentOk:false` flips
  // (the agent isn't down — sshd is just rejecting the exec). Sequential
  // execs cost us latency, not correctness; per-tick budget on a 60s
  // cron is plenty.
  const pingOk = await withTimeout(
    guestPing(client, cube.id),
    PER_CHECK_TIMEOUT_MS,
    false
  );
  const metrics = await withTimeout(
    guestMetrics(client, cube.id),
    PER_CHECK_TIMEOUT_MS,
    null
  );
  const sshOk = await withTimeout(
    checkSshPort(client, cube.internalIp, cube.cubeSshPort),
    SSH_PROBE_TIMEOUT_MS,
    false
  );

  const reachability: CubeReachabilitySnapshot = {
    agentOk: pingOk,
    sshOk,
    lastAgentSeenAt: pingOk
      ? nowIso
      : (cube.prevReachability?.lastAgentSeenAt ?? null),
    lastSshSeenAt: sshOk
      ? nowIso
      : (cube.prevReachability?.lastSshSeenAt ?? null),
  };

  const metricsSnapshot: CubeMetricsSnapshot | null = metrics
    ? { collectedAt: nowIso, ...metrics }
    : null;

  await db
    .update(cubes)
    .set({
      lastReachabilityAt: new Date(),
      reachabilityJsonb: reachability,
      // Only overwrite metrics when we actually got a fresh snapshot —
      // a stale-but-real value is more useful than null in the UI.
      ...(metricsSnapshot ? { lastMetricsJsonb: metricsSnapshot } : {}),
    })
    .where(eq(cubes.id, cube.id));

  // Pusher fan-out — best-effort, never blocks the next cube
  triggerEvent(`private-cube-${cube.id}`, "cube.reachability", {
    cubeId: cube.id,
    reachability,
    metrics: metricsSnapshot,
    lastReachabilityAt: nowIso,
  }).catch((err) => {
    console.error(
      `[cube-reachability] pusher trigger failed for ${cube.id}:`,
      err
    );
  });
}

/**
 * Probe sshd inside the cube directly via the cube's private bridge IP.
 *
 * We deliberately do NOT probe via 127.0.0.1:<hostPort> on the host.
 * Customer SSH (`ssh root@connect.<server>.krova.cloud -p <hostPort>`) goes
 * through the iptables PREROUTING DNAT rule, but PREROUTING only fires for
 * traffic arriving on an external interface. Loopback traffic from inside
 * the host (which is where this exec runs) goes through OUTPUT, never
 * PREROUTING — so a loopback probe against 127.0.0.1:<hostPort> would
 * always fail even on a perfectly healthy cube. Hitting the cube's bridge
 * IP on the cube's own SSH port is the natural shortcut: host and cube
 * share the `br0` bridge, so the TCP connect() reaches sshd directly. If
 * sshd is up, this returns 0; if sshd is dead, listening on a different
 * port, or the kernel is hung, this returns non-zero.
 *
 * We probe with bash's built-in `/dev/tcp/<ip>/<port>` instead of `nc -z`
 * because `nc` is NOT in the base-packages install list on Ubuntu /
 * Debian / AlmaLinux minimal — it was silently absent on every host we
 * ever provisioned, so the previous nc-based probe was a no-op until this
 * change. Bash is guaranteed present (every host setup phase relies on it)
 * and `/dev/tcp` is a built-in bash feature that needs no package.
 *
 * IMPORTANT: must invoke `bash -c` explicitly. On Ubuntu/Debian `/bin/sh`
 * is `dash`, which does NOT support `/dev/tcp`. ssh2's exec channel spawns
 * through the user's login shell — typically /bin/bash for root on our
 * hosts, but the explicit `bash -c` makes us immune to a stray shell
 * change.
 *
 * Caller passes a sane `cubeSshPort` (1–65535, default
 * `DEFAULT_CUBE_SSH_PORT`). Defensive re-validation here keeps the shell
 * interpolation safe.
 */
async function checkSshPort(
  client: Client,
  internalIp: string,
  cubeSshPort: number
): Promise<boolean> {
  // Reject anything that doesn't look like a dotted-quad. Defense-in-depth
  // for the shell interpolation below.
  if (!/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(internalIp)) {
    return false;
  }
  // Reject implausible port values. Per `tcp_port_mappings` we should
  // never see anything outside 1..65535, but a corrupted row should not
  // produce a bash crash here.
  if (
    !Number.isInteger(cubeSshPort) ||
    cubeSshPort < 1 ||
    cubeSshPort > 65_535
  ) {
    return false;
  }
  try {
    // `timeout 2` kills the bash process after 2s on a hang (returns 124).
    // `exec 3<>/dev/tcp/IP/PORT` opens a bidirectional TCP socket on FD 3.
    // Success → bash exits 0; refused / unreachable / timed-out → non-zero.
    // `2>/dev/null` silences bash's "Connection refused" warnings on the
    // failing path so they don't end up in our job logs.
    const result = await execCommand(
      client,
      `timeout 2 bash -c 'exec 3<>/dev/tcp/${internalIp}/${cubeSshPort}' 2>/dev/null`,
      SSH_PROBE_TIMEOUT_MS
    );
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(fallback);
    }, ms);
    promise
      .then((value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}
