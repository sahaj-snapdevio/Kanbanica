import assert from "node:assert/strict";
import { test } from "node:test";
import type { JobWithMetadata } from "pg-boss";
import type { audit } from "@/lib/audit";
import { withDeadLetterMonitoring } from "@/lib/worker/monitor";

// Regression guard for the pg-boss v12 metadata bug (2026-05-31 worker audit):
// the wrapper used to read lowercase `job.retrycount`/`job.retrylimit`, which
// do not exist on pg-boss v12's Job/JobWithMetadata (camelCase only), so the
// reads were always `undefined ?? 0` and `0 >= 0` flagged EVERY first-attempt
// failure as a "permanent failure". The fix reads camelCase off JobWithMetadata
// (delivered via `includeMetadata: true` in boss.ts). These tests pin the gate.

type AuditEntry = Parameters<typeof audit>[0];

/** A fake JobWithMetadata carrying only the fields the wrapper reads. */
function fakeJob(retryCount: number, retryLimit: number): JobWithMetadata {
  return {
    id: `job-${retryCount}-${retryLimit}`,
    name: "test.queue",
    data: { hello: "world" },
    retryCount,
    retryLimit,
  } as unknown as JobWithMetadata;
}

function spyAudit() {
  const calls: AuditEntry[] = [];
  const fn = ((entry: AuditEntry) => {
    calls.push(entry);
  }) as typeof audit;
  return { calls, fn };
}

const throwingHandler = async () => {
  throw new Error("boom");
};
const okHandler = async () => {
  // succeeds
};

test("dead-letter: a NON-final failure (retryCount < retryLimit) does NOT audit", async () => {
  const { calls, fn } = spyAudit();
  const wrapped = withDeadLetterMonitoring("test.queue", throwingHandler, fn);

  // First attempt of a retryLimit-3 queue: 0 < 3 → pg-boss will retry, NOT permanent.
  await assert.rejects(() => wrapped([fakeJob(0, 3)]), /boom/);
  assert.equal(
    calls.length,
    0,
    "must not audit a retryable first-attempt blip"
  );
});

test("dead-letter: the FINAL failure (retryCount === retryLimit) audits exactly once", async () => {
  const { calls, fn } = spyAudit();
  const wrapped = withDeadLetterMonitoring("test.queue", throwingHandler, fn);

  await assert.rejects(() => wrapped([fakeJob(3, 3)]), /boom/);
  assert.equal(calls.length, 1, "final attempt must audit");
  assert.equal(calls[0]?.action, "worker.job_permanently_failed");
});

test("dead-letter: a retryLimit:0 queue treats its first failure as final", async () => {
  const { calls, fn } = spyAudit();
  const wrapped = withDeadLetterMonitoring(
    "server.bootstrap",
    throwingHandler,
    fn
  );

  // retryLimit:0 queues (server setup phases) have no retries — 0 >= 0 → permanent.
  await assert.rejects(() => wrapped([fakeJob(0, 0)]), /boom/);
  assert.equal(calls.length, 1, "a no-retry queue's only attempt is final");
});

test("dead-letter: a successful handler never audits and never throws", async () => {
  const { calls, fn } = spyAudit();
  const wrapped = withDeadLetterMonitoring("test.queue", okHandler, fn);

  await wrapped([fakeJob(0, 3)]);
  assert.equal(calls.length, 0);
});

test("dead-letter: a mixed batch audits only the final-attempt jobs", async () => {
  const { calls, fn } = spyAudit();
  const wrapped = withDeadLetterMonitoring("test.queue", throwingHandler, fn);

  await assert.rejects(
    () => wrapped([fakeJob(0, 3), fakeJob(3, 3), fakeJob(1, 3), fakeJob(2, 2)]),
    /boom/
  );
  // Only the two final-attempt jobs (3/3 and 2/2) audit.
  assert.equal(calls.length, 2);
});
