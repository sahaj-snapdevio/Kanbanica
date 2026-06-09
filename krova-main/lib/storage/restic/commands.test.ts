import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleResticCommand } from "@/lib/storage/restic/commands";

// The exact env shape resticEnv() produces (VAR=val, space-joined).
const ENV =
  "RESTIC_REPOSITORY=s3:https://h/repo RESTIC_PASSWORD=p AWS_ACCESS_KEY_ID=k AWS_SECRET_ACCESS_KEY=s RESTIC_PROGRESS_FPS=0 RESTIC_CACHE_DIR=/c";
const PREFIX = "ionice -c2 -n7 nice -n10 ";

test("REGRESSION (2026-06-06): env assignments LEAD, before the ionice/nice prefix", () => {
  // The bug: `${ionice}${env} restic` → `nice <VAR=val> restic`, so `nice` execs
  // the env assignment (exit 127, 'No such file or directory') and every snapshot
  // fails. This test FAILS on that ordering and passes only on `${env} ${ionice}restic`.
  const cmd = assembleResticCommand({
    env: ENV,
    ionicePrefix: PREFIX,
    resticArgs: "backup /var/lib/krova/cubes/x/rootfs.ext4",
  });
  const iRepo = cmd.indexOf("RESTIC_REPOSITORY=");
  const iIonice = cmd.indexOf("ionice");
  const iNice = cmd.indexOf("nice -n10");
  const iRestic = cmd.indexOf("restic ");
  assert.ok(
    iRepo >= 0 && iIonice >= 0 && iNice >= 0 && iRestic >= 0,
    "all segments present"
  );
  assert.ok(iRepo < iIonice, "RESTIC_REPOSITORY must come BEFORE ionice");
  assert.ok(iRepo < iNice, "RESTIC_REPOSITORY must come BEFORE nice");
  assert.ok(iNice < iRestic, "the nice prefix must immediately precede restic");
  // The exact bug shape: NO env assignment may appear AFTER `nice`.
  assert.equal(
    cmd.indexOf("RESTIC_REPOSITORY=", iNice),
    -1,
    "no env assignment after nice"
  );
});

test("flag-off (no prefix) → plain env-led restic, no ionice/nice", () => {
  const cmd = assembleResticCommand({
    env: ENV,
    ionicePrefix: "",
    resticArgs: "snapshots",
  });
  assert.match(cmd, /^RESTIC_REPOSITORY=/);
  assert.match(cmd, / restic .* snapshots$/);
  assert.doesNotMatch(cmd, /ionice|nice -n/);
});

test("cwd prefixes `cd … &&` AHEAD of the env (still env-led for the actual command)", () => {
  const cmd = assembleResticCommand({
    env: ENV,
    ionicePrefix: PREFIX,
    resticArgs: "unlock",
    cwd: "/tmp/work",
  });
  assert.match(cmd, /^cd .*work.* && RESTIC_REPOSITORY=/);
  // env still precedes the prefix after the cd
  assert.ok(
    cmd.indexOf("RESTIC_REPOSITORY=") < cmd.indexOf("ionice"),
    "env before prefix even with a cwd"
  );
});

test("always carries --retry-lock + the path-style flag", () => {
  const cmd = assembleResticCommand({
    env: ENV,
    ionicePrefix: "",
    resticArgs: "backup /x",
  });
  assert.match(cmd, /--retry-lock/);
});
