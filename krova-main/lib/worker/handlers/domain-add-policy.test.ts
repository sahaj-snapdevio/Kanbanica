import assert from "node:assert/strict";
import { test } from "node:test";
import { domainAddFailureAction } from "@/lib/worker/handlers/domain-add-policy";

const LIMIT = 3; // QUEUE_OPTIONS[DOMAIN_ADD].retryLimit

test("keep-live: once active, any post-success failure is non-fatal", () => {
  // even on the final attempt, an active domain is never torn down
  assert.equal(
    domainAddFailureAction({
      becameActive: true,
      retryCount: 0,
      retryLimit: LIMIT,
    }),
    "keep-live"
  );
  assert.equal(
    domainAddFailureAction({
      becameActive: true,
      retryCount: LIMIT,
      retryLimit: LIMIT,
    }),
    "keep-live"
  );
});

test("retry: transient failure with attempts remaining keeps the mapping", () => {
  for (const rc of [0, 1, 2]) {
    assert.equal(
      domainAddFailureAction({
        becameActive: false,
        retryCount: rc,
        retryLimit: LIMIT,
      }),
      "retry",
      `retryCount ${rc} should retry`
    );
  }
});

test("cleanup: only the final attempt deletes the mapping", () => {
  assert.equal(
    domainAddFailureAction({
      becameActive: false,
      retryCount: LIMIT,
      retryLimit: LIMIT,
    }),
    "cleanup"
  );
  // defensive: a retrycount somehow past the limit still cleans up, never loops
  assert.equal(
    domainAddFailureAction({
      becameActive: false,
      retryCount: LIMIT + 1,
      retryLimit: LIMIT,
    }),
    "cleanup"
  );
});

test("a transient blip on attempt 1 never destroys the domain (the I1 regression)", () => {
  // This is the exact scenario that vanished customer domains: first attempt,
  // not yet active -> must be 'retry', never 'cleanup'.
  assert.equal(
    domainAddFailureAction({
      becameActive: false,
      retryCount: 0,
      retryLimit: LIMIT,
    }),
    "retry"
  );
});
