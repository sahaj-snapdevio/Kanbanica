import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSafeWebhookUrl } from "@/lib/webhook-ssrf";

// SSRF guard for outbound-webhook targets. IP-literal hosts skip DNS, so these
// are deterministic + network-free.

test("blocks RFC1918 / loopback / link-local / CGNAT v4 ranges", async () => {
  const blocked = [
    "http://127.0.0.1/hook",
    "https://10.0.0.5/hook",
    "https://169.254.169.254/latest/meta-data", // cloud metadata endpoint
    "https://172.16.0.1/",
    "https://192.168.1.1/",
    "https://100.64.0.1/", // carrier-grade NAT
    "https://0.0.0.0/",
  ];
  for (const url of blocked) {
    const r = await assertSafeWebhookUrl(url);
    assert.equal(r.ok, false, `${url} must be blocked`);
  }
});

test("blocks the cube IPv4 range 198.18.0.0/15 (no webhook → cube internal IP)", async () => {
  const r = await assertSafeWebhookUrl("https://198.18.5.10/hook");
  assert.equal(
    r.ok,
    false,
    "the cube bridge range must be unreachable via webhooks"
  );
});

test("blocks IPv6 loopback / ULA / link-local / v4-mapped", async () => {
  for (const url of [
    "http://[::1]/hook",
    "https://[fd00:c0be:5::a]/hook", // cube ULA
    "https://[fe80::1]/hook",
    "https://[::ffff:127.0.0.1]/hook", // v4-mapped loopback (dotted)
    // v4-mapped forms that `new URL()` normalizes to hex — these previously
    // BYPASSED the guard (a real SSRF: metadata endpoint reachable):
    "https://[::ffff:169.254.169.254]/latest/meta-data", // → ::ffff:a9fe:a9fe
    "https://[::ffff:10.0.0.1]/hook", // → ::ffff:a00:1
  ]) {
    const r = await assertSafeWebhookUrl(url);
    assert.equal(r.ok, false, `${url} must be blocked`);
  }
});

test("allows routable public IPs", async () => {
  for (const url of [
    "https://8.8.8.8/hook",
    "https://1.1.1.1/hook",
    "https://[2606:4700:4700::1111]/hook",
  ]) {
    const r = await assertSafeWebhookUrl(url);
    assert.equal(r.ok, true, `${url} should be allowed`);
  }
});

test("rejects non-http(s) protocols and malformed URLs", async () => {
  assert.equal((await assertSafeWebhookUrl("ftp://8.8.8.8/")).ok, false);
  assert.equal((await assertSafeWebhookUrl("file:///etc/passwd")).ok, false);
  assert.equal((await assertSafeWebhookUrl("not a url")).ok, false);
  const malformed = await assertSafeWebhookUrl("not a url");
  assert.match(malformed.reason ?? "", /valid URL/i);
});
