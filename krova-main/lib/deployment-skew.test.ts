import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isDeploymentSkewError,
  recoverFromDeploymentSkew,
} from "@/lib/deployment-skew";

const FRAGMENTS = [
  "Failed to find Server Action",
  "ChunkLoadError",
  "Loading chunk",
  "Loading CSS chunk",
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
];

test("isDeploymentSkewError: matches every known fragment as a string", () => {
  for (const f of FRAGMENTS) {
    assert.equal(
      isDeploymentSkewError(`prefix ${f} suffix`),
      true,
      `fragment not matched: ${f}`
    );
  }
});

test("isDeploymentSkewError: matches when carried on an Error or {message}", () => {
  assert.equal(
    isDeploymentSkewError(new Error("Failed to find Server Action abc123")),
    true
  );
  assert.equal(
    isDeploymentSkewError({ message: "ChunkLoadError: boom" }),
    true
  );
});

test("isDeploymentSkewError: unrelated / empty / non-error inputs are false", () => {
  assert.equal(
    isDeploymentSkewError(new Error("TypeError: x is undefined")),
    false
  );
  assert.equal(isDeploymentSkewError("some other failure"), false);
  assert.equal(isDeploymentSkewError(null), false);
  assert.equal(isDeploymentSkewError(undefined), false);
  assert.equal(isDeploymentSkewError(42), false);
  assert.equal(isDeploymentSkewError(""), false);
  assert.equal(isDeploymentSkewError({}), false);
});

test("recoverFromDeploymentSkew: no-ops server-side (no window)", () => {
  // Under node:test there is no `window`, so the guard returns false rather
  // than attempting a reload — the safe server-side behavior.
  assert.equal(typeof globalThis.window, "undefined");
  assert.equal(recoverFromDeploymentSkew(), false);
});
