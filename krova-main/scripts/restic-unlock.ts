/**
 * restic:unlock — clear a stale restic repository lock for a single cube.
 *
 * Why this exists: a restic process that dies mid-operation (host OOM/SIGTERM,
 * a host going down mid-snapshot, or a cube transferred off a host that was
 * killed mid-op) leaves an EXCLUSIVE lock in the cube's per-cube S3 restic
 * repo. Because the repo lives in S3, the lock survives the dead host — every
 * subsequent `restic forget`/`backup`/`prune`/`check` for that cube then fails
 * with exit 11 "repository is already locked", stranding snapshot delete +
 * auto-prune + restic-check for that cube. (The 2026-05-30 incident: a 28h-old
 * lock from a dead PID on a host the cube no longer lived on.)
 *
 * The worker now auto-recovers PROVABLY-stale locks (see
 * `runResticWithLockRecovery` in lib/storage/restic/commands.ts), but this
 * script is the operator escape hatch for clearing a lock by hand, and for the
 * one case automation deliberately refuses: a lock younger than the stale-age
 * threshold that the operator KNOWS is dead.
 *
 * Default `restic unlock` removes ONLY locks restic itself judges stale
 * (> 30 min old, OR same-host + dead PID) — safe to run even if an op might be
 * in flight. restic checks lock AGE before hostname, so a > 30-min lock is
 * cleared even when it was created on a DIFFERENT host than where this runs
 * (the cross-host case) — verified against restic 0.18.1. Use `--remove-all`
 * ONLY when you've confirmed (dry-run + no in-flight job) the lock is dead;
 * it removes EVERY lock including a live op's and can corrupt the repo.
 *
 * Usage:
 *   pnpm restic:unlock <cubeId>                         # dry-run — list locks, do nothing
 *   pnpm restic:unlock <cubeId> --apply                 # restic unlock (stale-only, SAFE)
 *   pnpm restic:unlock <cubeId> --apply --remove-all --yes   # remove ALL locks (DANGEROUS)
 *   pnpm restic:unlock <cubeId> --backend <backendId>   # pin the backend explicitly
 */

import { existsSync } from "fs";
import { createInterface } from "readline/promises";

if (existsSync(".env")) {
  process.loadEnvFile();
}

interface Args {
  apply: boolean;
  backendId: string | null;
  cubeId: string;
  removeAll: boolean;
  yes: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0].startsWith("--")) {
    console.error(
      "Usage: pnpm restic:unlock <cubeId> [--apply] [--remove-all] [--yes] [--backend <id>]"
    );
    process.exit(1);
  }
  const cubeId = argv[0];
  let apply = false;
  let removeAll = false;
  let yes = false;
  let backendId: string | null = null;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--remove-all") {
      removeAll = true;
    } else if (arg === "--yes" || arg === "-y") {
      yes = true;
    } else if (arg === "--backend") {
      backendId = argv[++i] ?? null;
      if (!backendId) {
        console.error("--backend requires a backend id");
        process.exit(1);
      }
    } else {
      console.error(`Unknown flag: ${arg}`);
      console.error(
        "Usage: pnpm restic:unlock <cubeId> [--apply] [--remove-all] [--yes] [--backend <id>]"
      );
      process.exit(1);
    }
  }

  if (removeAll && !apply) {
    console.error("--remove-all has no effect without --apply.");
    process.exit(1);
  }
  return { apply, backendId, cubeId, removeAll, yes };
}

function describeLockAge(iso: string | undefined): string {
  if (!iso) {
    return "unknown age";
  }
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return "unknown age";
  }
  const mins = Math.round(ms / 60_000);
  if (mins < 60) {
    return `${mins}m old`;
  }
  return `${Math.floor(mins / 60)}h${mins % 60}m old`;
}

async function main(): Promise<void> {
  const args = parseArgs();

  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/lib/db");
  const { cubes } = await import("@/db/schema");
  const { audit } = await import("@/lib/audit");
  const { connectToServer, isServerReachable } = await import("@/lib/ssh");
  const { loadResticRepoConfig, resticListLocks, resticCatLock, resticUnlock } =
    await import("@/lib/storage/restic");

  const cube = await db.query.cubes.findFirst({
    where: eq(cubes.id, args.cubeId),
    columns: { id: true, name: true, spaceId: true, serverId: true },
  });
  if (!cube) {
    console.error(`Cube ${args.cubeId} not found.`);
    process.exit(1);
  }
  if (!cube.serverId) {
    console.error(
      `Cube ${args.cubeId} has no server assigned — nothing to do.`
    );
    process.exit(1);
  }

  // Rule 58 preflight — fail fast on a down host before any side effect.
  const reachable = await isServerReachable(cube.serverId);
  if (!reachable) {
    console.error(
      `Cube's host (server ${cube.serverId}) is not reachable on its SSH port — aborting.`
    );
    process.exit(1);
  }

  const { config: repoConfig } = await loadResticRepoConfig(
    args.cubeId,
    args.backendId ?? undefined
  );

  const { client } = await connectToServer(cube.serverId);
  let locksBefore: string[] = [];
  try {
    locksBefore = await resticListLocks(client, repoConfig);

    console.log("");
    console.log(`Cube:        ${cube.name} (${cube.id})`);
    console.log(`Server:      ${cube.serverId}`);
    console.log(`Repo:        ${repoConfig.repoUrl}`);
    console.log(`Locks found: ${locksBefore.length}`);

    for (const id of locksBefore) {
      try {
        const info = await resticCatLock(client, repoConfig, id);
        console.log(
          `  - ${id.slice(0, 12)}  ${info.exclusive ? "exclusive" : "shared   "}  ` +
            `host=${info.hostname ?? "?"}  pid=${info.pid ?? "?"}  ${describeLockAge(info.time)}`
        );
      } catch {
        console.log(`  - ${id.slice(0, 12)}  (could not read lock metadata)`);
      }
    }

    if (locksBefore.length === 0) {
      console.log("\nNo locks present — nothing to do.");
      return;
    }

    if (!args.apply) {
      console.log(
        "\nDry-run — pass --apply to run `restic unlock` (removes only stale locks)."
      );
      console.log(
        "Add --remove-all --yes ONLY if you've confirmed the lock is dead and no op is running (removes ALL locks)."
      );
      return;
    }

    if (args.removeAll && !args.yes) {
      console.log(
        "\n⚠️  --remove-all removes EVERY lock, including a live operation's — this can corrupt the repo if a backup/prune is running."
      );
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const typed = await rl.question("Proceed with --remove-all? [y/N]: ");
      rl.close();
      if (typed.trim().toLowerCase() !== "y") {
        console.log("Aborted — nothing changed.");
        return;
      }
    }

    await resticUnlock(client, repoConfig, { removeAll: args.removeAll });

    const locksAfter = await resticListLocks(client, repoConfig);
    console.log(
      `\nDone — ran restic unlock${args.removeAll ? " --remove-all" : ""}. Locks: ${locksBefore.length} → ${locksAfter.length}.`
    );

    await audit({
      action: "restic.unlock",
      category: "cube",
      actorType: "admin",
      entityType: "cube",
      entityId: cube.id,
      spaceId: cube.spaceId,
      description: `Operator cleared restic repository lock(s) via restic:unlock${args.removeAll ? " --remove-all" : ""} (${locksBefore.length} → ${locksAfter.length})`,
      metadata: {
        serverId: cube.serverId,
        removeAll: args.removeAll,
        locksBefore: locksBefore.length,
        locksAfter: locksAfter.length,
      },
      source: "system",
    });
  } finally {
    client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("restic:unlock failed:", err);
    process.exit(1);
  });
