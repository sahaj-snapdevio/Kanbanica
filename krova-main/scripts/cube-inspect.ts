/**
 * cube-inspect — SSH into a server and report the live state of a Cube
 * directory at /var/lib/krova/cubes/<cubeId>/, optionally destroying it
 * after manual confirmation.
 *
 * Designed for the orphan-VM workflow: server.reconcile no longer
 * auto-destroys orphans — it emails the admin with the host path + this
 * command. The admin runs `pnpm cube:inspect <id>` to see what's actually
 * there, then `pnpm cube:inspect <id> --destroy` once they've confirmed.
 *
 * Usage:
 *   pnpm cube:inspect <cubeId>                       # inspect, server auto-resolved from DB
 *   pnpm cube:inspect <cubeId> --server <serverId>   # override (use when no DB row exists)
 *   pnpm cube:inspect <cubeId> --destroy             # destroy after a typed confirmation
 *   pnpm cube:inspect <cubeId> --destroy --yes       # skip the confirmation (CI / scripted)
 *   pnpm cube:inspect <cubeId> --restart             # revive a cube parked in `error`
 *   pnpm cube:inspect <cubeId> --restart --yes       # skip the y/N confirmation
 *
 * --restart flips an errored cube (rootfs intact, Firecracker dead) back to
 * `sleeping` and enqueues the standard CUBE_WAKE job, which does the fresh
 * startCube + billing clock + server reconcile + lifecycle log + webhooks.
 * It deliberately reuses the wake handler rather than relaunching inline, so
 * this path can never drift from the customer wake path.
 */

import { and, eq } from "drizzle-orm";
import { existsSync } from "fs";
import { createInterface } from "readline/promises";

if (existsSync(".env")) {
  process.loadEnvFile();
}

interface Args {
  cubeId: string;
  destroy: boolean;
  restart: boolean;
  serverIdOverride: string | null;
  skipConfirm: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0].startsWith("--")) {
    console.error(
      "Usage: pnpm cube:inspect <cubeId> [--server <serverId>] [--destroy | --restart] [--yes]"
    );
    process.exit(1);
  }
  const cubeId = argv[0];
  let serverIdOverride: string | null = null;
  let destroy = false;
  let restart = false;
  let skipConfirm = false;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--server") {
      serverIdOverride = argv[++i] ?? null;
      if (!serverIdOverride) {
        console.error("--server requires a value");
        process.exit(1);
      }
    } else if (arg === "--destroy") {
      destroy = true;
    } else if (arg === "--restart") {
      restart = true;
    } else if (arg === "--yes" || arg === "-y") {
      skipConfirm = true;
    } else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }
  }
  if (destroy && restart) {
    console.error("--destroy and --restart are mutually exclusive.");
    process.exit(1);
  }
  return { cubeId, serverIdOverride, destroy, restart, skipConfirm };
}

async function main(): Promise<void> {
  const args = parseArgs();

  const [{ db }, schema, sshMod, firecrackerMod] = await Promise.all([
    import("@/lib/db"),
    import("@/db/schema"),
    import("@/lib/ssh"),
    import("@/lib/ssh/firecracker"),
  ]);
  const { connectToServer, execCommand } = sshMod;
  const { tapName } = firecrackerMod;
  const { jailRoot } = await import("@/lib/ssh/jailer");

  // 1. Resolve server. Prefer DB row's serverId (works for known-deleted
  //    cubes too); fall back to --server override for true unknowns.
  const dbCube = await db.query.cubes.findFirst({
    where: eq(schema.cubes.id, args.cubeId),
  });
  const serverId = args.serverIdOverride ?? dbCube?.serverId;
  if (!serverId) {
    console.error(
      `Cube ${args.cubeId} not found in DB and no --server <id> override given.`
    );
    console.error(
      "Pass --server <serverId> using the value from the notification email."
    );
    process.exit(1);
  }

  const server = await db.query.servers.findFirst({
    where: eq(schema.servers.id, serverId),
  });
  if (!server) {
    console.error(`Server ${serverId} not found in DB.`);
    process.exit(1);
  }

  console.log("");
  console.log(`══ Cube ${args.cubeId} ══`);
  console.log(`Server:        ${server.hostname} (${server.id})`);
  console.log(`Server IP:     ${server.publicIp}:${server.sshPort}`);
  if (dbCube) {
    console.log(`DB status:     ${dbCube.status}`);
    console.log(`DB name:       ${dbCube.name}`);
    console.log(`DB space:      ${dbCube.spaceId}`);
    console.log(
      `DB resources:  ${dbCube.vcpus} vCPU, ${dbCube.ramMb}MB RAM, ${dbCube.diskLimitGb}GB disk`
    );
    if (dbCube.internalIp) {
      console.log(`DB internalIp: ${dbCube.internalIp}`);
    }
  } else {
    console.log("DB status:     (no row — fully unknown to the platform)");
  }

  // 2. Connect to the host and gather forensic info.
  const { client } = await connectToServer(serverId);
  const cubeDir = `/var/lib/krova/cubes/${args.cubeId}`;

  try {
    const existsResult = await execCommand(
      client,
      `[ -d ${cubeDir} ] && echo present || echo absent`,
      5000
    );
    const cubeDirPresent = existsResult.stdout.trim() === "present";

    console.log("");
    console.log(`══ Host state on ${server.hostname} ══`);
    console.log(`Path:          ${cubeDir}`);
    console.log(`Directory:     ${cubeDirPresent ? "present" : "absent"}`);

    if (!cubeDirPresent) {
      console.log("");
      console.log("Nothing to inspect on the host — directory does not exist.");
      if (args.destroy) {
        console.log("Skipping --destroy (nothing to remove).");
      }
      if (args.restart) {
        console.log(
          "Cannot --restart — the rootfs directory is gone. Redeploy from a backup instead."
        );
      }
      return;
    }

    const lsResult = await execCommand(
      client,
      `ls -lah ${cubeDir} 2>/dev/null || true`,
      10_000
    );
    const duResult = await execCommand(
      client,
      `du -sh ${cubeDir} 2>/dev/null | cut -f1`,
      30_000
    );
    const ipResult = await execCommand(
      client,
      `cat ${cubeDir}/ip.txt 2>/dev/null || true`,
      5000
    );
    // The mode is unknown for an orphan, so probe BOTH the jailed chroot pid
    // and the legacy bare pid (the bare path is byte-identical to the
    // historical `${cubeDir}/firecracker.pid`).
    const pidResult = await execCommand(
      client,
      `PID=$(cat ${jailRoot(args.cubeId)}/firecracker.pid 2>/dev/null || cat ${cubeDir}/firecracker.pid 2>/dev/null) && [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null && echo "running:$PID" || echo "stopped"`,
      5000
    );

    const ip = ipResult.stdout.trim();
    const processState = pidResult.stdout.trim();
    const diskSize = duResult.stdout.trim() || "?";

    console.log(`Disk size:     ${diskSize}`);
    console.log(`Process:       ${processState}`);
    if (ip) {
      console.log(`Internal IP:   ${ip}`);
    }
    console.log("");
    console.log("Contents:");
    console.log(
      lsResult.stdout
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n")
    );

    // 3. Allocated ports on this server scoped to this cube
    const ports = await db
      .select({
        id: schema.allocatedPorts.id,
        port: schema.allocatedPorts.port,
        purpose: schema.allocatedPorts.purpose,
      })
      .from(schema.allocatedPorts)
      .where(
        and(
          eq(schema.allocatedPorts.cubeId, args.cubeId),
          eq(schema.allocatedPorts.serverId, serverId)
        )
      );

    if (ports.length > 0) {
      console.log("");
      console.log("Allocated ports on this server:");
      for (const p of ports) {
        console.log(`  ${p.port} (${p.purpose})`);
      }
    }

    // 4. If --restart was passed, revive a cube parked in `error`: flip it
    //    back to `sleeping` and enqueue the standard CUBE_WAKE job. We reuse
    //    the wake handler (fresh startCube + billing clock + server reconcile
    //    + lifecycle log + webhooks) rather than relaunching inline, so this
    //    admin path can never drift from the customer wake path (Rule 14).
    if (args.restart) {
      if (!dbCube) {
        console.log("");
        console.log(
          "Cannot --restart: no DB row for this cube — there is nothing to revive. Redeploy from a backup instead."
        );
        return;
      }
      if (dbCube.status !== "error") {
        console.log("");
        console.log(
          `Cannot --restart: cube status is "${dbCube.status}", not "error". --restart only revives cubes parked in the error state.`
        );
        if (dbCube.status === "sleeping") {
          console.log(
            'It is sleeping — press "Wake" in the dashboard instead.'
          );
        } else if (dbCube.status === "running") {
          console.log("It is already running.");
        }
        return;
      }
      if (processState.startsWith("running:")) {
        console.log("");
        console.log(
          `Refusing to --restart: Firecracker is still alive (${processState}). Investigate first, or --destroy.`
        );
        return;
      }
      if (!dbCube.internalIp || dbCube.vcpus <= 0 || dbCube.ramMb <= 0) {
        console.log("");
        console.log(
          `Cannot --restart: cube is missing boot config (ip=${dbCube.internalIp}, vcpus=${dbCube.vcpus}, ram=${dbCube.ramMb}).`
        );
        return;
      }

      if (!args.skipConfirm) {
        console.log("");
        console.log(
          `About to revive cube "${dbCube.name}" (${args.cubeId}): flip error → sleeping and enqueue a wake job. Customer state is preserved.`
        );
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const typed = await rl.question("Proceed? [y/N]: ");
        rl.close();
        if (typed.trim().toLowerCase() !== "y") {
          console.log("Aborted — nothing changed.");
          return;
        }
      }

      // Rule 52: a `sleeping` cube must have lastBilledAt = null (an errored
      // cube already does, but we set it explicitly as defense in depth). The
      // wake handler claims the row atomically on status='sleeping', does the
      // fresh startCube, and (re)starts the billing clock.
      await db
        .update(schema.cubes)
        .set({ status: "sleeping", lastBilledAt: null, updatedAt: new Date() })
        .where(eq(schema.cubes.id, args.cubeId));

      const { enqueueJob } = await import("@/lib/worker/enqueue");
      const { JOB_NAMES } = await import("@/lib/worker/job-types");
      const jobId = await enqueueJob(JOB_NAMES.CUBE_WAKE, {
        cubeId: args.cubeId,
        spaceId: dbCube.spaceId,
        serverId,
      });

      await db.insert(schema.lifecycleLogs).values({
        entityType: "cube",
        entityId: args.cubeId,
        message: "Cube revived from error via cube:inspect --restart",
      });

      const { audit } = await import("@/lib/audit");
      audit({
        action: "cube.restart_from_error",
        category: "cube",
        actorType: "admin",
        entityType: "cube",
        entityId: args.cubeId,
        spaceId: dbCube.spaceId,
        description: `Cube "${dbCube.name}" revived from error (error → sleeping → wake) via cube:inspect`,
        metadata: { cubeId: args.cubeId, serverId, jobId },
        source: "system",
      });

      console.log("");
      console.log(
        jobId
          ? `Revived — status flipped to sleeping, wake job ${jobId} enqueued. The worker will relaunch it; watch the dashboard for "running".`
          : "Status flipped to sleeping, but the wake job de-duplicated (one already queued). The worker will relaunch it shortly."
      );
      return;
    }

    // 5. If --destroy was passed, confirm and destroy.
    if (!args.destroy) {
      console.log("");
      console.log(
        "Pass --restart to revive a cube parked in `error`, or --destroy to remove the directory, kill the process, and free ports."
      );
      return;
    }

    if (!args.skipConfirm) {
      console.log("");
      console.log(
        "⚠  About to PERMANENTLY DESTROY this cube directory and free its ports."
      );
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const typed = await rl.question(
        `Type the cube id (${args.cubeId}) to confirm: `
      );
      rl.close();
      if (typed.trim() !== args.cubeId) {
        console.log("Confirmation did not match — aborting, nothing changed.");
        return;
      }
    }

    console.log("");
    console.log("Destroying…");

    // Kill Firecracker. Mode is unknown for an orphan, so probe BOTH the
    // jailed chroot pid and the legacy bare pid (the bare path is
    // byte-identical to the historical `${cubeDir}/firecracker.pid`).
    await execCommand(
      client,
      `PID=$(cat ${jailRoot(args.cubeId)}/firecracker.pid 2>/dev/null || cat ${cubeDir}/firecracker.pid 2>/dev/null) && [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null || true`,
      10_000
    ).catch(() => {});

    // Remove TAP device if we know the IP
    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
      const tap = tapName(ip);
      await execCommand(
        client,
        `ip link del ${tap} 2>/dev/null || true`,
        5000
      ).catch(() => {});
    }

    // Remove the cube directory
    const rmResult = await execCommand(client, `rm -rf ${cubeDir}`, 60_000);
    if (rmResult.exitCode !== 0) {
      console.error(`rm -rf failed: ${rmResult.stderr}`);
      process.exit(1);
    }

    // Tear down the jailer chroot too, if this was a jailed cube. The chroot
    // holds only hardlinks to the canonical rootfs/kernel (no bind-mount per
    // lib/ssh/jailer.ts), so removing it is inode-safe — the canonical inode
    // already lived under `${cubeDir}` which we just removed. For a bare cube
    // the chroot does not exist, so this is a harmless no-op.
    const jailDir = jailRoot(args.cubeId);
    await execCommand(client, `rm -rf ${jailDir}`, 60_000).catch(() => {});

    // Free allocated_ports rows for this (cube, server) pair only —
    // scoping to serverId mirrors server.reconcile's safety against
    // wiping a destination server's freshly-allocated ports if a transfer
    // is in flight.
    if (ports.length > 0) {
      await db
        .delete(schema.allocatedPorts)
        .where(
          and(
            eq(schema.allocatedPorts.cubeId, args.cubeId),
            eq(schema.allocatedPorts.serverId, serverId)
          )
        );
    }

    const { audit } = await import("@/lib/audit");
    audit({
      action: "server.orphan_vm_manually_destroyed",
      category: "server",
      actorType: "admin",
      entityType: "server",
      entityId: serverId,
      description: `Orphan cube "${args.cubeId}" manually destroyed on ${server.hostname} via cube:inspect`,
      metadata: {
        cubeId: args.cubeId,
        serverId,
        serverHostname: server.hostname,
        portsFreed: ports.length,
      },
      source: "system",
    });

    console.log(
      `Done — directory removed, process killed, ${ports.length} port(s) freed.`
    );
  } finally {
    client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });
