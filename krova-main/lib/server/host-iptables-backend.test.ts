import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyHostIptablesBackend } from "@/lib/server/host-iptables-backend";

test("classifyHostIptablesBackend: Ubuntu legacy default + legacy available → ok", () => {
  // The intended state after applyHostNetworking flips the alternative.
  const r = classifyHostIptablesBackend("iptables v1.8.10 (legacy)", true);
  assert.equal(r.status, "ok");
  assert.equal(r.detail, "iptables v1.8.10 (legacy)");
});

test("classifyHostIptablesBackend: Ubuntu nft default + legacy available → fail (rules won't persist)", () => {
  // The real bug class: legacy rules not captured by netfilter-persistent.
  const r = classifyHostIptablesBackend("iptables v1.8.10 (nf_tables)", true);
  assert.equal(r.status, "fail");
  assert.ok(/legacy/i.test(r.detail));
  assert.ok(/Network phase/i.test(r.detail));
});

test("classifyHostIptablesBackend: RHEL nft default + no legacy alternative → ok", () => {
  // No iptables-legacy on RHEL/AlmaLinux — nft is the only backend and is what
  // resolveBins/getIptables fall back to, so the persisted rules match.
  const r = classifyHostIptablesBackend("iptables v1.8.9 (nf_tables)", false);
  assert.equal(r.status, "ok");
  assert.equal(r.detail, "iptables v1.8.9 (nf_tables)");
});

test("classifyHostIptablesBackend: legacy default even without a detected alternative → ok", () => {
  // Defensive: if the version string itself says legacy, the host is on legacy.
  const r = classifyHostIptablesBackend("iptables v1.8.10 (legacy)", false);
  assert.equal(r.status, "ok");
});

test("classifyHostIptablesBackend: empty version → fail (could not detect)", () => {
  const r = classifyHostIptablesBackend("   ", true);
  assert.equal(r.status, "fail");
  assert.equal(r.detail, "Could not detect");
});

test("classifyHostIptablesBackend: unrecognized backend string → warn", () => {
  const r = classifyHostIptablesBackend(
    "iptables v9.9.9 (something-new)",
    true
  );
  assert.equal(r.status, "warn");
  assert.ok(/Unrecognized/i.test(r.detail));
});
