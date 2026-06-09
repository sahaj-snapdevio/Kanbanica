/**
 * Restic CLI wrappers — every snapshot/restore/forget/prune/check
 * operation runs `restic` on a bare-metal host over SSH. The worker
 * never holds rootfs bytes; `restic` opens its S3 streams directly
 * from the host's uplink to iDrive.
 *
 * Credentials are passed as inline env vars on the bash command line
 * (`KEY=value ... restic ...`). bash applies them only to the
 * `restic` child process — they don't show in `ps`, aren't written
 * to disk, and don't survive the command.
 *
 * Every command passes `-o s3.bucket-lookup=path` because non-AWS
 * S3-compatible endpoints (iDrive E2, MinIO, Backblaze B2) require
 * path-style bucket addressing — see
 * https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html.
 *
 * Restic exit codes referenced (from
 * https://restic.readthedocs.io/en/stable/075_scripting.html):
 *   0   success
 *   10  repository doesn't exist
 *   11  failed to lock repository
 *   12  wrong password
 */

import type { Client } from "ssh2";
import { DISK_IO_STORAGE_TUNING_ENABLED } from "@/config/platform";
import { audit } from "@/lib/audit";
import { ioNicePrefix } from "@/lib/io-nice";
import { execCommand, shellEscape } from "@/lib/ssh";

import type {
  ResticLockInfo,
  ResticRepoConfig,
  ResticSnapshotInfo,
} from "@/lib/storage/restic/types";

const DEFAULT_TIMEOUT_MS = 1_800_000; // 30 min — multi-GB rootfs

/**
 * Build the inline env-var block. Each value is shell-escaped so a
 * stray quote or special character in (e.g.) the repo password
 * can't break out of the command. The repo URL itself is also
 * escaped because it contains `:` and `/`.
 */
function resticEnv(conn: ResticRepoConfig): string {
  return [
    `RESTIC_REPOSITORY=${shellEscape(conn.repoUrl)}`,
    `RESTIC_PASSWORD=${shellEscape(conn.repoPassword)}`,
    `AWS_ACCESS_KEY_ID=${shellEscape(conn.accessKeyId)}`,
    `AWS_SECRET_ACCESS_KEY=${shellEscape(conn.secretAccessKey)}`,
    // Restic spits an interactive prompt for "scan known hosts" the
    // first time it sees a backend. `RESTIC_PROGRESS_FPS=0` keeps it
    // non-interactive (no TTY) — combined with `RESTIC_CACHE_DIR`,
    // this gives us deterministic behaviour over SSH.
    "RESTIC_PROGRESS_FPS=0",
    "RESTIC_CACHE_DIR=/var/lib/krova/restic-cache",
  ].join(" ");
}

/** Path-style addressing flag — see module header. */
const PATH_STYLE_FLAG = "-o s3.bucket-lookup=path";

/**
 * Sanitize stderr before it bubbles up — make sure the repo
 * password or S3 secret never leaks into job logs / audit / errors.
 */
function sanitize(stderr: string, conn: ResticRepoConfig): string {
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return stderr
    .replace(new RegExp(escapeRegex(conn.repoPassword), "g"), "***")
    .replace(new RegExp(escapeRegex(conn.secretAccessKey), "g"), "***")
    .replace(new RegExp(escapeRegex(conn.accessKeyId), "g"), "***")
    .slice(0, 1000);
}

/**
 * `--retry-lock` value passed to every lock-taking restic command. restic
 * retries acquiring the repo lock for this long (instead of failing
 * immediately with exit 11) when the repo is briefly held by a genuinely-
 * running concurrent op. Kept well inside the smallest op timeout
 * (`resticForgetSnapshot`'s 10 min) so it never blows the SSH command budget.
 */
const RESTIC_RETRY_LOCK = "1m";

/**
 * Minimum age a held lock must have before we auto-remove it on an exit-11
 * failure. Set ABOVE the longest restic op timeout in this module
 * (backup/restore/dump/check = 30 min) plus margin, so by the time a lock is
 * this old, any legitimately-running op that created it would already have
 * been killed by its own SSH command timeout. A younger lock is treated as
 * possibly-live and is NEVER force-removed — we let pg-boss retry the whole
 * job instead. restic's own staleness threshold is 30 min; we are deliberately
 * stricter. See the 2026-05-30 cross-host stale-lock incident.
 */
const RESTIC_STALE_LOCK_MIN_AGE_MS = 45 * 60 * 1000;

/**
 * Parse a Go duration string (restic's `28h27m35.13s` form) to milliseconds.
 * Returns null when nothing parseable is found — callers MUST treat null as
 * "cannot prove staleness" and refuse to auto-unlock.
 */
function parseGoDurationMs(token: string): number | null {
  const unitMs: Record<string, number> = {
    ns: 1e-6,
    us: 1e-3,
    µs: 1e-3,
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
  };
  // Multi-char units (ns/us/µs/ms) MUST precede single-char (m/s) in the
  // alternation so "500ms" parses as ms, not m + s.
  const re = /(\d+(?:\.\d+)?)(ns|µs|us|ms|h|m|s)/g;
  let total = 0;
  let matched = false;
  let m: RegExpExecArray | null = re.exec(token);
  while (m !== null) {
    matched = true;
    total += Number.parseFloat(m[1]) * unitMs[m[2]];
    m = re.exec(token);
  }
  return matched ? total : null;
}

/**
 * Extract the held-lock age (ms) from restic's exit-11 stderr, which reads
 * e.g. "repository is already locked by PID 8306 on mango ... lock was created
 * at 2026-05-29 00:07:19 (28h27m35.13s ago)". We parse the restic-computed
 * "(<dur> ago)" rather than the timestamp to dodge timezone ambiguity. Returns
 * null when not found.
 */
function parseResticLockAgeMs(stderr: string): number | null {
  const m = stderr.match(/\(([^)]*?)\s+ago\)/);
  if (!m) {
    return null;
  }
  return parseGoDurationMs(m[1]);
}

/**
 * Run a lock-taking restic command over SSH with SAFE stale-lock recovery.
 *
 * `resticArgs` is everything AFTER `restic <global flags>` (the path-style
 * flag + `--retry-lock` are prepended here). On exit 11 (failed to lock) we
 * only act when the held lock is PROVABLY stale by age
 * (>= `RESTIC_STALE_LOCK_MIN_AGE_MS`): we run a plain `restic unlock` — which
 * removes ONLY locks restic itself deems stale, NEVER `--remove-all` — then
 * retry the command exactly once. A younger/unparseable lock is returned
 * as-is so the caller throws and pg-boss retries later, never clobbering a
 * live op. See the 2026-05-30 cross-host stale-lock incident.
 *
 * Returns the raw exec result; the caller interprets exit codes (so each
 * wrapper keeps its own success / "already gone" semantics). `opts.cwd`
 * prepends a `cd <dir> &&` (used by `resticBackup`'s relative-path capture).
 */
/**
 * execCommand for a restic command line that carries inline creds. On a THROW
 * — notably execCommand's timeout error, which embeds the FULL command line
 * including `RESTIC_PASSWORD=…` + `AWS_SECRET_ACCESS_KEY=…` + `AWS_ACCESS_KEY_ID=…`
 * — sanitize the message before it propagates into job/lifecycle/audit logs.
 * (The non-throw exit-code path is already sanitized by callers via sanitize().)
 * The 2026-05-29 incident: a snapshot backup timeout logged the raw `restic
 * backup …` command, leaking the per-cube repo password + the shared S3 keys
 * into lifecycle_logs. Every cred-carrying restic exec in this file routes here.
 */
async function execResticSafe(
  client: Client,
  cmd: string,
  timeoutMs: number,
  conn: ResticRepoConfig
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    return await execCommand(client, cmd, timeoutMs);
  } catch (err) {
    throw new Error(
      sanitize(err instanceof Error ? err.message : String(err), conn)
    );
  }
}

/**
 * Assemble the host-side restic shell command. EXPORTED + pure so the LOAD-BEARING
 * ordering is locked by a unit test (lib/storage/restic/commands.test.ts).
 *
 * ORDER IS LOAD-BEARING: the `VAR=val` env assignments (`env`) MUST come BEFORE the
 * ionice/nice prefix. The shell only applies `VAR=val` as environment when they
 * LEAD the command; placed after `nice` they become `nice`'s arguments, so `nice`
 * tries to EXECUTE `RESTIC_REPOSITORY=...` as a program (exit 127, "No such file or
 * directory") and EVERY snapshot/backup fails — the 2026-06-06 production incident.
 * With `env` first the shell exports them and they inherit through ionice→nice→
 * restic. Flag-off (`ionicePrefix=""`) is byte-identical to the historical
 * `${env} restic` form.
 */
export function assembleResticCommand(args: {
  env: string;
  /** "" when storage tuning is off, else "ionice -c2 -n7 nice -n10 ". */
  ionicePrefix: string;
  resticArgs: string;
  cwd?: string;
}): string {
  const prefix = args.cwd ? `cd ${shellEscape(args.cwd)} && ` : "";
  return `${prefix}${args.env} ${args.ionicePrefix}restic ${PATH_STYLE_FLAG} --retry-lock ${RESTIC_RETRY_LOCK} ${args.resticArgs}`;
}

async function runResticWithLockRecovery(
  client: Client,
  conn: ResticRepoConfig,
  resticArgs: string,
  timeoutMs: number,
  opts: { cwd?: string } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = resticEnv(conn);
  // De-prioritize ALL host-side restic I/O + CPU under contention so background
  // snapshot/backup/prune/check sweeps never starve a live cube on the shared
  // SATA-RAID1 array (disk overhaul F). ionice -c2 (best-effort) only yields under
  // contention; idle throughput is unchanged. Gated → flag-off = byte-identical.
  const cmd = assembleResticCommand({
    env,
    ionicePrefix: ioNicePrefix(),
    resticArgs,
    cwd: opts.cwd,
  });

  const first = await execResticSafe(client, cmd, timeoutMs, conn);
  if (first.exitCode !== 11) {
    return first;
  }

  // exit 11 = failed to lock. Only auto-recover a PROVABLY-stale lock.
  const ageMs = parseResticLockAgeMs(first.stderr);
  if (ageMs === null || ageMs < RESTIC_STALE_LOCK_MIN_AGE_MS) {
    // Can't prove the lock is stale (or it may belong to a live op) — do NOT
    // remove it. Surface the failure; the job's retry will pick it up once the
    // holder finishes (or the lock ages into the recoverable window).
    return first;
  }

  // Defense-in-depth (audit M5): age alone is a proxy for "dead". If the lock
  // was created on THIS host and its PID is still ALIVE, the holder is a
  // genuinely-running op (e.g. a refresh-stalled-but-alive backup, or a
  // host-clock jump) — removing it would let two writers into the repo and
  // corrupt it. Parse the holder from restic's exit-11 stderr ("…by PID <pid>
  // on <host>…"); if it's same-host + alive, REFUSE. Cross-host locks can't be
  // PID-checked (the PID is meaningless here) — those rely on the age gate.
  const holder = first.stderr.match(/by PID (\d+) on (\S+)/);
  if (holder) {
    const lockPid = holder[1];
    const lockHost = holder[2].replace(/[.,;]+$/, "");
    const hostNameRes = await execCommand(client, "hostname", 10_000);
    const here = hostNameRes.stdout.trim();
    const sameHost =
      here.length > 0 &&
      (here === lockHost ||
        lockHost.startsWith(`${here}.`) ||
        here.startsWith(`${lockHost}.`));
    if (sameHost) {
      const alive = await execCommand(
        client,
        `kill -0 ${lockPid} 2>/dev/null && echo alive || echo dead`,
        10_000
      );
      if (alive.stdout.trim() === "alive") {
        console.warn(
          `[restic] exit 11: lock held by a LIVE process (pid ${lockPid}) on this host (${lockHost}) — NOT unlocking despite age ~${Math.round(ageMs / 60_000)}m (would corrupt a concurrent op). Surfacing failure.`
        );
        return first;
      }
    }
  }

  const repoTail = conn.repoUrl.replace(/^.*\/(snapshot-repos\/.*)$/, "$1");
  console.warn(
    `[restic] exit 11 on a stale lock (age ~${Math.round(ageMs / 60_000)}m) for ${repoTail}; running 'restic unlock' (stale-only, never --remove-all) and retrying once`
  );

  const unlock = await execResticSafe(
    client,
    `${env} restic ${PATH_STYLE_FLAG} unlock`,
    120_000,
    conn
  );
  if (unlock.exitCode !== 0) {
    console.error(
      `[restic] stale-lock unlock failed (exit ${unlock.exitCode}): ${sanitize(unlock.stderr, conn)} — leaving the original failure to the caller`
    );
    return first;
  }

  // Forensic trail (Rule 9). Fire-and-forget; audit() never throws.
  const cubeId = conn.repoUrl.match(/\/snapshot-repos\/([^/]+)$/)?.[1] ?? null;
  void audit({
    action: "restic.stale_lock_recovered",
    category: "platform",
    actorType: "system",
    entityType: "cube",
    entityId: cubeId,
    description: `Removed a stale restic repository lock (age ~${Math.round(ageMs / 60_000)} min) before retrying a restic operation`,
    metadata: { repoUrl: conn.repoUrl, lockAgeMs: ageMs, resticArgs },
    source: "worker",
  });

  return await execResticSafe(client, cmd, timeoutMs, conn);
}

/**
 * Ensure the cube's repo exists on S3.
 *
 * Restic exits 0 on `init` of a fresh location, but exits non-zero
 * with "config file already exists" once initialized. We probe with
 * `restic snapshots --json --no-lock` first: exit 0 → repo exists,
 * exit 10 → repo doesn't exist → run init. This avoids the
 * stderr-parsing fragility of the "did this look like 'already
 * initialized'?" heuristic.
 *
 * Idempotent. Safe to call before every backup.
 */
export async function ensureResticRepo(
  client: Client,
  conn: ResticRepoConfig
): Promise<void> {
  const env = resticEnv(conn);
  const probe = await execResticSafe(
    client,
    `${env} restic ${PATH_STYLE_FLAG} snapshots --json --no-lock`,
    60_000,
    conn
  );
  if (probe.exitCode === 0) {
    return; // already initialized
  }

  // Exit code 10 = repository doesn't exist. Any other non-zero is a
  // real error (auth failure, network, permissions) — don't try to
  // init blindly, surface the error.
  if (probe.exitCode !== 10) {
    throw new Error(
      `restic snapshots probe failed (exit ${probe.exitCode}): ${sanitize(probe.stderr, conn)}`
    );
  }

  const init = await execResticSafe(
    client,
    `${env} restic ${PATH_STYLE_FLAG} init`,
    120_000,
    conn
  );
  if (init.exitCode !== 0) {
    throw new Error(
      `restic init failed (exit ${init.exitCode}): ${sanitize(init.stderr, conn)}`
    );
  }
}

/**
 * Result of a successful `restic backup` invocation — the fields
 * we care about from the JSON `summary` message (last line of
 * stdout when `--json` is set). See
 * https://restic.readthedocs.io/en/stable/075_scripting.html
 *
 * `dataAddedPacked` is the restic summary's `data_added_packed` — the
 * dedup'd bytes ACTUALLY written to the repo AFTER compression, i.e. the
 * real on-S3 footprint this snapshot adds. restic 0.18.x uses repo format
 * v2 with compression on by default, so `data_added` (the *uncompressed*
 * dedup'd delta) overstates real storage; we use the packed value. Falls
 * back to `data_added` when `data_added_packed` is absent (older restic).
 * Typically a small fraction of `totalBytesProcessed` after the first backup
 * of a given cube. Stored on `cube_snapshots.sizeBytes`, which is shown to
 * the customer and feeds `storage_backends` free-space accounting — snapshots
 * are NOT billed by size (only backups are billed per-GB-month).
 */
export interface ResticBackupResult {
  dataAddedPacked: number;
  snapshotId: string;
  totalBytesProcessed: number;
}

/**
 * Back up a single file into the cube's restic repo. Returns the
 * new snapshot's id + dedup stats parsed from the `--json` summary
 * message.
 *
 * The `tag` is attached to the snapshot for cross-reference with our
 * `cube_snapshots.id` row (distinct from restic's own snapshot id
 * which we ALSO capture in `storagePath`).
 *
 * Why we `cd` into `workingDir` and pass a RELATIVE `relativePath`
 * rather than just the absolute path: restic records files under
 * exactly the path they were given. With an absolute path, restic
 * stores e.g. `/var/lib/krova/cubes/X/rootfs.ext4` and a later
 * `restic restore --target=/var/lib/krova/cubes/X/` writes the file
 * at `/var/lib/krova/cubes/X/var/lib/krova/cubes/X/rootfs.ext4`
 * (target + absolute = nested mess). Using a relative path keeps
 * the snapshot self-contained: backup `rootfs.ext4` from
 * `/var/lib/krova/cubes/X` → restore with `--target=/var/lib/krova/cubes/X`
 * writes `/var/lib/krova/cubes/X/rootfs.ext4`. Clean round-trip.
 */
export async function resticBackup(
  client: Client,
  conn: ResticRepoConfig,
  workingDir: string,
  relativePath: string,
  tag: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ResticBackupResult> {
  const result = await runResticWithLockRecovery(
    client,
    conn,
    `backup ${shellEscape(relativePath)} --tag ${shellEscape(tag)} --json${
      DISK_IO_STORAGE_TUNING_ENABLED ? " --no-scan" : ""
    }`,
    timeoutMs,
    { cwd: workingDir }
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `restic backup failed (exit ${result.exitCode}): ${sanitize(result.stderr, conn)}`
    );
  }

  // `--json` emits one JSON object per line (status, summary, …).
  // The final line is the `summary` message — that's the one with
  // the new snapshot id. Iterate stdout in reverse to find it.
  const lines = result.stdout.trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as {
        message_type?: string;
        snapshot_id?: string;
        data_added?: number;
        data_added_packed?: number;
        total_bytes_processed?: number;
      };
      if (parsed.message_type === "summary" && parsed.snapshot_id) {
        return {
          snapshotId: parsed.snapshot_id,
          // Prefer the compressed (real on-repo / on-S3) bytes; fall back to
          // the uncompressed delta on older restic that doesn't emit it.
          dataAddedPacked: parsed.data_added_packed ?? parsed.data_added ?? 0,
          totalBytesProcessed: parsed.total_bytes_processed ?? 0,
        };
      }
    } catch {
      // Not JSON or not parseable — skip to the next line. The loop's
      // own `for` increment advances us.
    }
  }
  throw new Error(
    `restic backup completed but no JSON summary line emitted — stdout: ${result.stdout.slice(-500)}`
  );
}

/**
 * Restore the given snapshot id into `targetDir` on the host.
 * Restic recreates the original file paths under `--target`, so for
 * a snapshot of `rootfs.ext4` taken with cwd=/var/lib/krova/cubes/X,
 * restic restore --target /var/lib/krova/cubes/X writes the file at
 * the same location.
 *
 * If the snapshot id no longer exists in the repo, restic exits
 * non-zero — we surface that as an explicit error rather than retry.
 */
export async function resticRestore(
  client: Client,
  conn: ResticRepoConfig,
  snapshotId: string,
  targetDir: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<void> {
  const result = await runResticWithLockRecovery(
    client,
    conn,
    `restore ${shellEscape(snapshotId)} --target ${shellEscape(targetDir)}${
      DISK_IO_STORAGE_TUNING_ENABLED ? " --sparse" : ""
    }`,
    timeoutMs
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `restic restore failed (exit ${result.exitCode}): ${sanitize(result.stderr, conn)}`
    );
  }
}

/**
 * `restic dump <snapshotId> <relativePath>` writes the requested file's
 * contents to stdout. We redirect that stream into `targetFile` on the
 * host so the caller gets a single materialized file.
 *
 * Used by snapshot-export, snapshot-promote-to-backup, and cube-from-
 * snapshot — all of which need to re-materialize the rootfs without
 * incurring a full `restic restore` of an entire directory tree.
 *
 * The `targetFile` argument is shell-escaped before redirection, but
 * the caller still owns directory creation + cleanup on failure.
 */
export async function resticDump(
  client: Client,
  conn: ResticRepoConfig,
  snapshotId: string,
  relativePath: string,
  targetFile: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<void> {
  const result = await runResticWithLockRecovery(
    client,
    conn,
    `dump ${shellEscape(snapshotId)} ${shellEscape(relativePath)} > ${shellEscape(targetFile)}`,
    timeoutMs
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `restic dump failed (exit ${result.exitCode}): ${sanitize(result.stderr, conn)}`
    );
  }
}

/**
 * Remove a snapshot from the repo AND reclaim its unique chunks via
 * `--prune`. For a single snapshot delete this is the simplest one-
 * shot operation; for bulk deletes the dedicated `resticPrune` is
 * cheaper because it bundles chunk-reclaim across multiple forgets.
 *
 * If the snapshot id is already gone, restic exits non-zero. We
 * tolerate that case (treat as success) so a delete retry after a
 * partial completion is idempotent.
 */
export async function resticForgetSnapshot(
  client: Client,
  conn: ResticRepoConfig,
  snapshotId: string,
  timeoutMs = 600_000 // 10 min — prune does data-shuffling
): Promise<void> {
  const result = await runResticWithLockRecovery(
    client,
    conn,
    `forget ${shellEscape(snapshotId)} --prune`,
    timeoutMs
  );
  if (result.exitCode === 0) {
    return;
  }

  // Restic prints "no matching snapshots found" to stderr when the id
  // is already gone. We treat that as success (idempotent delete).
  const stderr = result.stderr.toLowerCase();
  if (stderr.includes("no matching snapshots found")) {
    return;
  }

  throw new Error(
    `restic forget --prune failed (exit ${result.exitCode}): ${sanitize(result.stderr, conn)}`
  );
}

/**
 * Run a standalone `restic prune` to reclaim orphan chunks. Used by
 * the weekly cron — avoids paying the per-delete prune cost on every
 * snapshot delete by batching it on a schedule.
 *
 * Note: `prune` acquires an exclusive repo lock — no backups can run
 * for that cube while prune is in flight. Worst case: a snapshot
 * scheduled during prune waits ~30s for the lock. Acceptable.
 */
export async function resticPrune(
  client: Client,
  conn: ResticRepoConfig,
  timeoutMs = 1_200_000 // 20 min
): Promise<void> {
  const result = await runResticWithLockRecovery(
    client,
    conn,
    "prune",
    timeoutMs
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `restic prune failed (exit ${result.exitCode}): ${sanitize(result.stderr, conn)}`
    );
  }
}

/**
 * Verify repository integrity. Run on a schedule (weekly) and after
 * any suspected corruption (e.g. a backup that emitted suspicious
 * errors). Returns true on a clean check.
 *
 * `--read-data-subset=2%` checks 2% of the actual pack data each
 * run — a full read of every chunk would take hours on a large
 * repo. Over 50 weeks the entire repo is verified.
 */
export async function resticCheck(
  client: Client,
  conn: ResticRepoConfig,
  timeoutMs = 1_800_000 // 30 min
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const result = await runResticWithLockRecovery(
    client,
    conn,
    "check --read-data-subset=2%",
    timeoutMs
  );
  if (result.exitCode === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: sanitize(result.stderr || result.stdout, conn),
  };
}

/**
 * List every snapshot in the repo. Used by the audit script + the
 * Orbit admin views. Returns an empty array when the repo doesn't
 * exist yet (exit 10) — useful for "has this cube ever been
 * snapshotted?" checks without throwing.
 */
export async function resticListSnapshots(
  client: Client,
  conn: ResticRepoConfig
): Promise<ResticSnapshotInfo[]> {
  const env = resticEnv(conn);
  const result = await execResticSafe(
    client,
    `${env} restic ${PATH_STYLE_FLAG} snapshots --json --no-lock`,
    60_000,
    conn
  );
  if (result.exitCode === 10) {
    // Repo doesn't exist yet
    return [];
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `restic snapshots failed (exit ${result.exitCode}): ${sanitize(result.stderr, conn)}`
    );
  }
  try {
    return JSON.parse(result.stdout) as ResticSnapshotInfo[];
  } catch (err) {
    throw new Error(
      `restic snapshots --json returned unparseable output: ${err instanceof Error ? err.message : err}`
    );
  }
}

/**
 * List the ids of every lock currently present in the repo. Uses `--no-lock`
 * so it never blocks on (or contends with) an existing lock — read-only,
 * safe even when the repo is locked. Returns [] when the repo doesn't exist
 * yet (exit 10). Used by the `restic:unlock` operator script's dry-run.
 */
export async function resticListLocks(
  client: Client,
  conn: ResticRepoConfig
): Promise<string[]> {
  const env = resticEnv(conn);
  const result = await execResticSafe(
    client,
    `${env} restic ${PATH_STYLE_FLAG} list locks --no-lock`,
    60_000,
    conn
  );
  if (result.exitCode === 10) {
    return [];
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `restic list locks failed (exit ${result.exitCode}): ${sanitize(result.stderr, conn)}`
    );
  }
  return result.stdout
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Read a single lock object's metadata (host / PID / created-at / exclusive)
 * via `restic cat lock <id>`. Best-effort — used by the `restic:unlock`
 * operator script's dry-run to show the operator WHO holds the lock before
 * they remove it. Throws on failure; the caller degrades to id-only display.
 */
export async function resticCatLock(
  client: Client,
  conn: ResticRepoConfig,
  lockId: string
): Promise<ResticLockInfo> {
  const env = resticEnv(conn);
  const result = await execResticSafe(
    client,
    `${env} restic ${PATH_STYLE_FLAG} cat lock ${shellEscape(lockId)}`,
    60_000,
    conn
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `restic cat lock failed (exit ${result.exitCode}): ${sanitize(result.stderr, conn)}`
    );
  }
  const parsed = JSON.parse(result.stdout) as {
    time?: string;
    exclusive?: boolean;
    hostname?: string;
    username?: string;
    pid?: number;
  };
  return { id: lockId, ...parsed };
}

/**
 * Remove repository locks. DEFAULT (`removeAll=false`) removes ONLY locks
 * restic itself judges stale (> 30 min old, OR same-host + dead PID) — safe
 * to call while other ops may be running. `removeAll: true` runs
 * `restic unlock --remove-all` which removes EVERY lock including live ones —
 * DANGEROUS (a concurrent writer could then enter the repo and corrupt it),
 * only for an operator who has confirmed no concurrent op is running. NEVER
 * call with `removeAll` from automated code paths.
 */
export async function resticUnlock(
  client: Client,
  conn: ResticRepoConfig,
  opts: { removeAll?: boolean } = {},
  timeoutMs = 120_000
): Promise<void> {
  const env = resticEnv(conn);
  const flag = opts.removeAll ? " --remove-all" : "";
  const result = await execResticSafe(
    client,
    `${env} restic ${PATH_STYLE_FLAG} unlock${flag}`,
    timeoutMs,
    conn
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `restic unlock${flag} failed (exit ${result.exitCode}): ${sanitize(result.stderr, conn)}`
    );
  }
}

/**
 * `restic forget <retentionArgs> --prune` with stale-lock recovery — the
 * retention-bucket forget used by the daily auto-prune cron. `retentionArgs`
 * is the already-shell-safe string from `buildResticForgetArgs`
 * (`--tag <autoId> …` scoping the policy to the auto snapshots, plus
 * `--keep-last/daily/weekly`). Throws on non-zero exit.
 */
export async function resticForgetWithRetention(
  client: Client,
  conn: ResticRepoConfig,
  retentionArgs: string,
  timeoutMs = 1_200_000
): Promise<void> {
  const result = await runResticWithLockRecovery(
    client,
    conn,
    `forget ${retentionArgs} --prune`,
    timeoutMs
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `restic forget (retention) --prune failed (exit ${result.exitCode}): ${sanitize(result.stderr, conn)}`
    );
  }
}
