/**
 * ON-HOST cube-lifecycle E2E (`pnpm test:e2e`).
 *
 * Drives the platform's REAL setup-phase + cube-lifecycle handlers against a
 * REAL KVM dev host, boots a cube from the REAL Krova rootfs, runs in-guest
 * tests (apt install, network, DNS), then exercises the full lifecycle
 * (snapshot → sleep → wake → resize → backup → restore → delete) — asserting
 * real DB + host state after each step.
 *
 * NOT a node:test file — it's a long stateful sequential flow against live
 * infra, run via `node --env-file=.env.e2e --import tsx`. The handlers are
 * invoked DIRECTLY (a throwaway pg-boss schema is created so their follow-up
 * enqueues succeed harmlessly; no worker processes them → deterministic, no
 * cron interference).
 *
 * SAFETY: requires a DEDICATED dev/test host (bootstrap hardens its sshd +
 * the reboot phase reboots it). Never point E2E_SSH_HOST at production.
 */

import { readFileSync } from "node:fs";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import type { Client } from "ssh2";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { encryptValue } from "@/lib/encrypt";
import { env } from "@/lib/env";
import { allocateServerAndCreateCube } from "@/lib/server/allocate";
import { encryptBootstrapCreds } from "@/lib/server/bootstrap-creds";
import { completePhase } from "@/lib/server/setup-phase";
import { createSshConnection } from "@/lib/ssh/connection";
import { encryptPrivateKey } from "@/lib/ssh/decrypt";
import { execCommand } from "@/lib/ssh/exec";

// ── env / config ─────────────────────────────────────────────────────────────
function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`E2E: missing required env ${name}`);
  }
  return v;
}
const SSH_HOST = reqEnv("E2E_SSH_HOST");
const SSH_PORT = Number.parseInt(process.env.E2E_SSH_PORT ?? "22", 10);
const SSH_USER = process.env.E2E_SSH_USER ?? "root";
const HOST_KEY_PATH = reqEnv("E2E_HOST_KEY_PATH").replace(
  /^~/,
  process.env.HOME ?? "~"
);
const HOST_IMAGES_DIR =
  process.env.E2E_HOST_IMAGES_DIR ?? "/root/krova-build/out";
const SERVER_HOSTNAME = process.env.E2E_SERVER_HOSTNAME ?? "e2e-devtest";
const IMAGE_ID = "ubuntu-24.04";
const HOST_PRIVATE_KEY = readFileSync(HOST_KEY_PATH, "utf8");

// ── step runner ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`  PASS: ${label}  (${Math.round((Date.now() - t0) / 1000)}s)`);
    passed++;
    return r;
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${label}: ${msg}`);
    console.error(`  FAIL: ${label}\n        ${msg}`);
    throw err;
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(msg);
  }
}

// pg-boss v12 work handlers receive an ARRAY of jobs (Job[]). Each handler does
// `for (const job of jobs)`, so we hand it a single-element batch. The return type
// is a bare generic `T[]` inferred from each call site's contextual type (the
// handler's `Job<Payload>[]` param), so the one helper satisfies every handler's
// distinct payload with NO `any` — the fabricated stub is cast through `unknown`.
function jobs<T>(data: Record<string, unknown>): T[] {
  return [
    { id: createId(), name: "e2e", data, retrycount: 0 },
  ] as unknown as T[];
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Run a command INSIDE the cube: host SSHes to the cube over br0 with the
 *  ephemeral key staged on the host. Returns stdout (throws on non-zero).
 *
 *  The command is base64-encoded and decoded+run by bash on the cube (Rule 39):
 *  the payload travels through TWO shell layers (the host's execCommand + the
 *  host→cube ssh), and a bare `$`/quote/pipe in `cmd` would otherwise be eaten
 *  by the host shell (e.g. `awk '{print $2}'` → `$2` expands to empty on the
 *  host). base64 is alphanumeric + `/+=`, so it survives both layers untouched. */
async function inGuest(
  hostClient: Client,
  cubeIp: string,
  cmd: string,
  timeoutMs = 120_000
): Promise<string> {
  const b64 = Buffer.from(cmd, "utf8").toString("base64");
  const ssh = `ssh -i /tmp/e2e-cube-key -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15 root@${cubeIp} "echo ${b64} | base64 -d | bash"`;
  const res = await execCommand(hostClient, ssh, timeoutMs);
  if (res.exitCode !== 0) {
    throw new Error(
      `in-guest cmd failed (exit ${res.exitCode}): ${res.stderr.slice(-400) || res.stdout.slice(-400)}`
    );
  }
  return res.stdout;
}

async function serverRow() {
  const [s] = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.id, SERVER_ID))
    .limit(1);
  assert(s, "server row vanished");
  return s;
}
async function cubeRow(id: string) {
  const [c] = await db
    .select()
    .from(schema.cubes)
    .where(eq(schema.cubes.id, id))
    .limit(1);
  return c ?? null;
}

let SERVER_ID = "";
let SPACE_ID = "";

async function main() {
  console.log("Krova on-host cube-lifecycle E2E");
  console.log(`  host=${SSH_USER}@${SSH_HOST}:${SSH_PORT}  image=${IMAGE_ID}`);

  // Lazily create the pg-boss schema so handler follow-up enqueues succeed.
  await step("init pg-boss schema (throwaway DB)", async () => {
    const { getBoss } = await import("@/lib/worker/enqueue");
    await getBoss();
  });

  // Handlers (dynamic import so env is validated first).
  const { handleServerBootstrap } = await import(
    "@/lib/worker/handlers/server-bootstrap"
  );
  const { handleServerInstall } = await import(
    "@/lib/worker/handlers/server-install"
  );
  const { handleServerNetwork } = await import(
    "@/lib/worker/handlers/server-network"
  );
  const { handleServerReboot } = await import(
    "@/lib/worker/handlers/server-reboot"
  );
  const { handleServerVerify } = await import(
    "@/lib/worker/handlers/server-verify"
  );
  const { handleCubeProvision } = await import(
    "@/lib/worker/handlers/cube-provision"
  );
  const { handleSnapshotCreate } = await import(
    "@/lib/worker/handlers/snapshot-create"
  );
  const { handleSnapshotRestore } = await import(
    "@/lib/worker/handlers/snapshot-restore"
  );
  const { handleCubeSleep } = await import("@/lib/worker/handlers/cube-sleep");
  const { handleCubeWake } = await import("@/lib/worker/handlers/cube-wake");
  const { handleCubeResize } = await import(
    "@/lib/worker/handlers/cube-resize"
  );
  const { handleBackupCreate } = await import(
    "@/lib/worker/handlers/backup-create"
  );
  const { handleCubeDelete } = await import(
    "@/lib/worker/handlers/cube-delete"
  );
  const { handleBackupRedeploy } = await import(
    "@/lib/worker/handlers/backup-redeploy"
  );

  // ─── SEED ──────────────────────────────────────────────────────────────────
  await step(
    "seed region + platform ssh key + server + storage backend",
    async () => {
      const [region] = await db
        .insert(schema.regions)
        .values({
          id: createId(),
          name: SERVER_HOSTNAME,
          slug: `e2e-${createId().slice(0, 8)}`,
        })
        .returning();
      const [key] = await db
        .insert(schema.sshKeys)
        .values({
          id: createId(),
          name: `e2e-${createId().slice(0, 6)}`,
          encryptedPrivateKey: encryptPrivateKey(
            HOST_PRIVATE_KEY,
            env.APP_SECRET
          ),
          publicKey: readFileSync(`${HOST_KEY_PATH}.pub`, "utf8").trim(),
          fingerprint: createId(),
        })
        .returning();
      const [server] = await db
        .insert(schema.servers)
        .values({
          id: createId(),
          hostname: SERVER_HOSTNAME,
          publicIp: SSH_HOST,
          sshPort: SSH_PORT,
          regionId: region.id,
          sshKeyId: key.id,
          status: "provisioning",
          setupPhase: "bootstrap",
          setupStatus: "idle",
          bridgeSubnet: 1,
        })
        .returning();
      SERVER_ID = server.id;

      // Space with ample credit so billing never auto-sleeps the cube mid-test.
      const [space] = await db
        .insert(schema.spaces)
        .values({
          id: createId(),
          name: `e2e-${createId().slice(0, 8)}`,
          planId: "plan_business",
          creditBalance: "1000.0000",
        })
        .returning();
      SPACE_ID = space.id;

      await db.insert(schema.storageBackends).values({
        id: createId(),
        name: `e2e-${createId().slice(0, 6)}`,
        endpoint: reqEnv("TEST_S3_ENDPOINT"),
        region: reqEnv("TEST_S3_REGION"),
        bucket: reqEnv("TEST_S3_BUCKET"),
        accessKeyIdEnc: encryptValue(reqEnv("TEST_S3_ACCESS_KEY_ID")),
        secretAccessKeyEnc: encryptValue(reqEnv("TEST_S3_SECRET_ACCESS_KEY")),
        isActive: true,
      });
    }
  );

  // ─── SETUP PHASES (real handlers) ────────────────────────────────────────────
  const bootstrapCreds = encryptBootstrapCreds({
    initialPort: SSH_PORT,
    initialUser: SSH_USER,
    privateKey: HOST_PRIVATE_KEY,
  });

  await step(
    "phase: bootstrap (harden sshd→2822, push key, detect hw)",
    async () => {
      await handleServerBootstrap(
        jobs({ serverId: SERVER_ID, encryptedCreds: bootstrapCreds })
      );
      const s = await serverRow();
      assert(
        s.setupPhase === "install",
        `expected setupPhase=install, got ${s.setupPhase} (status=${s.setupStatus}, err=${s.setupError})`
      );
      assert(s.sshPort === 2822, `expected sshPort=2822, got ${s.sshPort}`);
      assert((s.totalCpus ?? 0) > 0, "hardware not detected");
    }
  );

  await step(
    "phase: install (FC/jailer/restic/caddy/rclone + hardening; CF skipped)",
    async () => {
      await handleServerInstall(jobs({ serverId: SERVER_ID }));
      const s = await serverRow();
      assert(
        s.setupPhase === "pull_images",
        `expected pull_images, got ${s.setupPhase} (err=${s.setupError})`
      );
    }
  );

  await step(
    "phase: pull_images (place host-built Krova images, advance)",
    async () => {
      // In this E2E the build-host IS the target host, so the real SFTP transfer
      // is replaced by direct placement of the artifacts the real builder
      // produced. Every OTHER phase runs faithfully.
      const s = await serverRow();
      const client = await createSshConnection(
        s.publicIp,
        s.sshPort,
        HOST_PRIVATE_KEY
      );
      try {
        await execCommand(client, "mkdir -p /var/lib/krova/images", 10_000);
        const cp = await execCommand(
          client,
          `cp -f ${HOST_IMAGES_DIR}/kernel/vmlinux /var/lib/krova/images/vmlinux && cp -f ${HOST_IMAGES_DIR}/${IMAGE_ID}/rootfs.ext4 /var/lib/krova/images/${IMAGE_ID}.ext4 && ls -la /var/lib/krova/images/`,
          120_000
        );
        assert(cp.exitCode === 0, `image placement failed: ${cp.stderr}`);
      } finally {
        client.end();
      }
      const { claimPhaseRunning } = await import("@/lib/server/setup-phase");
      await claimPhaseRunning(SERVER_ID, "pull_images");
      await completePhase(SERVER_ID, "pull_images");
      assert(
        (await serverRow()).setupPhase === "network",
        "pull_images did not advance to network"
      );
    }
  );

  await step("phase: network (br0 dual-stack + NAT + firewall)", async () => {
    await handleServerNetwork(jobs({ serverId: SERVER_ID }));
    const s = await serverRow();
    assert(
      s.setupPhase === "reboot",
      `expected reboot, got ${s.setupPhase} (err=${s.setupError})`
    );
  });

  await step(
    "phase: reboot (reboots host, waits for boot_id change)",
    async () => {
      await handleServerReboot(jobs({ serverId: SERVER_ID }));
      const s = await serverRow();
      assert(
        s.setupPhase === "verify",
        `expected verify, got ${s.setupPhase} (err=${s.setupError})`
      );
    }
  );

  await step(
    "phase: verify (readiness checks against post-reboot host)",
    async () => {
      await handleServerVerify(jobs({ serverId: SERVER_ID }));
      const s = await serverRow();
      assert(
        s.setupPhase === "ready",
        `expected ready, got ${s.setupPhase} (err=${s.setupError})`
      );
    }
  );

  await step("activate server", async () => {
    await db
      .update(schema.servers)
      .set({ status: "active" })
      .where(eq(schema.servers.id, SERVER_ID));
  });

  // ─── CUBE PROVISION ──────────────────────────────────────────────────────────
  // Ephemeral cube keypair so the host can SSH into the cube for in-guest tests.
  await step("stage ephemeral cube SSH key on host", async () => {
    const s = await serverRow();
    const client = await createSshConnection(
      s.publicIp,
      s.sshPort,
      HOST_PRIVATE_KEY
    );
    try {
      await execCommand(
        client,
        "ssh-keygen -t ed25519 -N '' -f /tmp/e2e-cube-key <<<y >/dev/null 2>&1; chmod 600 /tmp/e2e-cube-key; cat /tmp/e2e-cube-key.pub",
        15_000
      );
    } finally {
      client.end();
    }
  });

  let cubeId = "";
  let cubePubKey = "";
  await step("read ephemeral cube pubkey from host", async () => {
    const s = await serverRow();
    const client = await createSshConnection(
      s.publicIp,
      s.sshPort,
      HOST_PRIVATE_KEY
    );
    try {
      const r = await execCommand(client, "cat /tmp/e2e-cube-key.pub", 10_000);
      cubePubKey = r.stdout.trim();
      assert(cubePubKey.startsWith("ssh-"), "no ephemeral cube pubkey");
    } finally {
      client.end();
    }
  });

  await step("allocate + create cube row (real allocator)", async () => {
    const result = await allocateServerAndCreateCube({
      spaceId: SPACE_ID,
      name: "e2e-cube",
      vcpus: 1,
      ramMb: 1024,
      diskLimitGb: 10,
      imageId: IMAGE_ID,
    });
    cubeId = result.cube.id;
    assert(
      result.serverId === SERVER_ID,
      "allocated a different server than expected"
    );
  });

  await step(
    "provision cube → boots to running (real Krova rootfs)",
    async () => {
      await handleCubeProvision(
        jobs({
          cubeId,
          spaceId: SPACE_ID,
          serverId: SERVER_ID,
          vcpus: 1,
          ramMb: 1024,
          diskLimitGb: 10,
          imageId: IMAGE_ID,
          sshPublicKey: cubePubKey,
        })
      );
      const c = await cubeRow(cubeId);
      assert(c?.status === "running", `cube not running (status=${c?.status})`);
      assert(c?.internalIp, "cube has no internal IP");
    }
  );

  const cubeIp = (await cubeRow(cubeId))?.internalIp as string;

  // ─── IN-GUEST TESTS (over br0, ephemeral key) ────────────────────────────────
  await step("in-guest: SSH reachable + correct distro", async () => {
    const s = await serverRow();
    const client = await createSshConnection(
      s.publicIp,
      s.sshPort,
      HOST_PRIVATE_KEY
    );
    try {
      // sshd may take a few seconds post-boot; retry briefly.
      let lastErr = "";
      for (let i = 0; i < 12; i++) {
        try {
          const os = await inGuest(
            client,
            cubeIp,
            "cat /etc/os-release | grep -E '^PRETTY_NAME'",
            30_000
          );
          assert(/Ubuntu 24\.04/.test(os), `unexpected distro: ${os}`);
          return;
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
          await sleep(5000);
        }
      }
      throw new Error(`cube SSH never came up: ${lastErr}`);
    } finally {
      client.end();
    }
  });

  await step("in-guest: outbound network + DNS + apt install", async () => {
    const s = await serverRow();
    const client = await createSshConnection(
      s.publicIp,
      s.sshPort,
      HOST_PRIVATE_KEY
    );
    try {
      await inGuest(client, cubeIp, "ping -c1 -W5 1.1.1.1", 30_000);
      await inGuest(
        client,
        cubeIp,
        "getent hosts deb.debian.org || getent hosts archive.ubuntu.com",
        30_000
      );
      // Real apt install — proves working apt sources + DNS + outbound + dpkg.
      await inGuest(
        client,
        cubeIp,
        "DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq htop",
        300_000
      );
      const which = await inGuest(client, cubeIp, "command -v htop", 15_000);
      assert(which.includes("htop"), "htop not installed");
    } finally {
      client.end();
    }
  });

  await step(
    "in-guest: kernel carries container CONFIGs (nftables + cgroup mem)",
    async () => {
      const s = await serverRow();
      const client = await createSshConnection(
        s.publicIp,
        s.sshPort,
        HOST_PRIVATE_KEY
      );
      try {
        // iptables-nft works (NF_TABLES compiled in) + memory cgroup present (MEMCG).
        await inGuest(
          client,
          cubeIp,
          "iptables -L >/dev/null 2>&1 && echo nft-ok",
          20_000
        );
        const cg = await inGuest(
          client,
          cubeIp,
          "grep -c memory /proc/cgroups || true",
          15_000
        );
        assert(
          Number.parseInt(cg.trim() || "0", 10) >= 1,
          "memory cgroup controller missing in guest"
        );
      } finally {
        client.end();
      }
    }
  );

  // ─── LIFECYCLE (real handlers) ───────────────────────────────────────────────
  let snapshotId = "";
  await step("snapshot.create → restic backup to S3 (complete)", async () => {
    const [snap] = await db
      .insert(schema.cubeSnapshots)
      .values({
        id: createId(),
        cubeId,
        spaceId: SPACE_ID,
        name: "e2e-snap",
        kind: "manual",
        status: "pending",
      })
      .returning();
    snapshotId = snap.id;
    await handleSnapshotCreate(
      jobs({ snapshotId, cubeId, spaceId: SPACE_ID, serverId: SERVER_ID })
    );
    const [row] = await db
      .select()
      .from(schema.cubeSnapshots)
      .where(eq(schema.cubeSnapshots.id, snapshotId))
      .limit(1);
    assert(
      row?.status === "complete",
      `snapshot not complete (status=${row?.status})`
    );
    assert(row?.storagePath, "snapshot has no restic id");
  });

  await step("cube.sleep → sleeping", async () => {
    await handleCubeSleep(
      jobs({ cubeId, spaceId: SPACE_ID, serverId: SERVER_ID })
    );
    assert((await cubeRow(cubeId))?.status === "sleeping", "cube not sleeping");
  });

  await step("cube.wake → running", async () => {
    await handleCubeWake(
      jobs({ cubeId, spaceId: SPACE_ID, serverId: SERVER_ID })
    );
    assert(
      (await cubeRow(cubeId))?.status === "running",
      "cube not running after wake"
    );
  });

  await step(
    "cube.resize: grow RAM 1024→2048 (live) + verify in-guest",
    async () => {
      await handleCubeResize(
        jobs({
          cubeId,
          spaceId: SPACE_ID,
          serverId: SERVER_ID,
          newVcpus: 1,
          newRamMb: 2048,
          newDiskLimitGb: 10,
          isLive: true,
          actorId: "e2e",
          actorType: "admin",
        })
      );
      const c = await cubeRow(cubeId);
      assert(c?.ramMb === 2048, `cube ramMb not updated (got ${c?.ramMb})`);
      assert(c?.status === "running", "cube not running after resize");
      // verify the guest actually sees more RAM
      const s = await serverRow();
      const client = await createSshConnection(
        s.publicIp,
        s.sshPort,
        HOST_PRIVATE_KEY
      );
      try {
        // NOTE: avoid `$` in the in-guest command — inGuest passes it through
        // the host shell inside double quotes (JSON.stringify), which would
        // expand `$2` (Rule 39). Read the raw line + parse the kB in JS.
        const mem = await inGuest(
          client,
          cubeIp,
          "grep MemTotal /proc/meminfo",
          20_000
        );
        const kb = Number.parseInt(mem.replace(/[^0-9]/g, ""), 10);
        assert(
          kb > 1024 * 1024,
          `guest MemTotal did not grow past 1GiB: got "${mem.trim()}" (${kb} kB)`
        );
      } finally {
        client.end();
      }
    }
  );

  let backupId = "";
  await step(
    "backup.create → .cube to S3 (complete, cube preserved)",
    async () => {
      const cube = await cubeRow(cubeId);
      assert(cube, "cube row gone before backup");
      // Use the real helper that captures cubeConfig (cube_backups.cube_config is
      // notNull) — the same path the "Save as backup" flow uses. skipEnqueue so
      // we drive backup.create directly; deleteCubeAfter:false preserves the cube.
      const { createPreDeletionBackup } = await import(
        "@/lib/cubes/create-pre-deletion-backup"
      );
      const created = await createPreDeletionBackup({
        cube,
        createdBy: null,
        lifecycleMessage: "e2e save-as-backup",
        backupName: "e2e-backup",
        deleteCubeAfter: false,
        skipEnqueue: true,
      });
      backupId = created.backupId;
      await handleBackupCreate(
        jobs({
          backupId,
          cubeId,
          spaceId: SPACE_ID,
          serverId: SERVER_ID,
          deleteCubeAfter: false,
        })
      );
      const [row] = await db
        .select()
        .from(schema.cubeBackups)
        .where(eq(schema.cubeBackups.id, backupId))
        .limit(1);
      assert(
        row?.status === "complete",
        `backup not complete (status=${row?.status})`
      );
      assert(
        (await cubeRow(cubeId))?.status !== "deleted",
        "cube must NOT be deleted by save-as-backup"
      );
    }
  );

  await step("snapshot.restore → rootfs restored, cube running", async () => {
    const wasRunning = (await cubeRow(cubeId))?.status === "running";
    // Restore claims the cube as 'stopping' (the restore lock) — mirror the action.
    await db
      .update(schema.cubes)
      .set({ status: "stopping" })
      .where(eq(schema.cubes.id, cubeId));
    await handleSnapshotRestore(
      jobs({
        snapshotId,
        cubeId,
        spaceId: SPACE_ID,
        serverId: SERVER_ID,
        wasRunning,
      })
    );
    assert(
      (await cubeRow(cubeId))?.status === "running",
      "cube not running after restore"
    );
  });

  // The S3 round-trip that underlies cube-transfer's data movement: download
  // the .cube backup from S3, extract it, and boot a BRAND-NEW cube from it on
  // the same server. (A true cross-server transfer needs a 2nd host; this
  // exercises the identical backup→S3→download→new-cube data path.)
  let redeployedCubeId = "";
  await step(
    "backup.redeploy → NEW cube from .cube (S3 round-trip)",
    async () => {
      const result = await allocateServerAndCreateCube({
        spaceId: SPACE_ID,
        name: "e2e-redeployed",
        vcpus: 1,
        ramMb: 1024,
        diskLimitGb: 10,
        imageId: IMAGE_ID,
      });
      redeployedCubeId = result.cube.id;
      await handleBackupRedeploy(
        jobs({
          backupId,
          spaceId: SPACE_ID,
          newCubeId: redeployedCubeId,
          serverId: SERVER_ID,
          sshKeyMode: "replace",
          sshPublicKey: cubePubKey,
        })
      );
      const c = await cubeRow(redeployedCubeId);
      assert(
        c?.status === "running",
        `redeployed cube not running (status=${c?.status})`
      );
      assert(c?.internalIp, "redeployed cube has no internal IP");
    }
  );

  await step(
    "in-guest: redeployed cube is reachable + carries the data",
    async () => {
      const ip = (await cubeRow(redeployedCubeId))?.internalIp as string;
      const s = await serverRow();
      const client = await createSshConnection(
        s.publicIp,
        s.sshPort,
        HOST_PRIVATE_KEY
      );
      try {
        let lastErr = "";
        for (let i = 0; i < 12; i++) {
          try {
            const os = await inGuest(
              client,
              ip,
              "cat /etc/os-release | grep -E '^PRETTY_NAME'",
              30_000
            );
            assert(/Ubuntu 24\.04/.test(os), `unexpected distro: ${os}`);
            // htop was apt-installed into the ORIGINAL cube before the backup —
            // it must survive the .cube round-trip into the redeployed cube.
            const htop = await inGuest(
              client,
              ip,
              "command -v htop || true",
              15_000
            );
            assert(
              htop.includes("htop"),
              "redeployed cube lost the data written before backup (htop missing)"
            );
            return;
          } catch (e) {
            lastErr = e instanceof Error ? e.message : String(e);
            await sleep(5000);
          }
        }
        throw new Error(`redeployed cube SSH never came up: ${lastErr}`);
      } finally {
        client.end();
      }
    }
  );

  await step("cube.delete (both) → deleted + host dirs gone", async () => {
    const s = await serverRow();
    for (const id of [cubeId, redeployedCubeId]) {
      await handleCubeDelete(
        jobs({ cubeId: id, spaceId: SPACE_ID, serverId: SERVER_ID })
      );
      assert(
        (await cubeRow(id))?.status === "deleted",
        `cube ${id} row not marked deleted`
      );
      const client = await createSshConnection(
        s.publicIp,
        s.sshPort,
        HOST_PRIVATE_KEY
      );
      try {
        const ls = await execCommand(
          client,
          `ls -d /var/lib/krova/cubes/${id} 2>/dev/null && echo EXISTS || echo GONE`,
          10_000
        );
        assert(
          ls.stdout.includes("GONE"),
          `cube ${id} host directory not cleaned up`
        );
      } finally {
        client.end();
      }
    }
  });

  console.log(
    `\n================ E2E RESULT: ${passed} passed, ${failed} failed ================`
  );
}

main()
  .then(() => process.exit(failed > 0 ? 1 : 0))
  .catch((err) => {
    console.error("\n================ E2E ABORTED ================");
    console.error(err instanceof Error ? err.stack : err);
    if (failures.length) {
      console.error("Failures:\n" + failures.map((f) => `  - ${f}`).join("\n"));
    }
    process.exit(1);
  });
