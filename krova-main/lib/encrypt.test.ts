import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptValue, encryptValue, hmacSign, Secret } from "@/lib/encrypt";

const KEY = "a-test-key-of-sufficient-length-1234567890";

test("encryptValue/decryptValue: round-trips with an explicit key", () => {
  const plain = "super-secret-ssh-private-key\nline2";
  const ct = encryptValue(plain, KEY);
  assert.notEqual(ct, plain, "ciphertext is not the plaintext");
  assert.equal(decryptValue(ct, KEY), plain);
});

test("encryptValue: same plaintext yields different ciphertext (random salt+IV)", () => {
  const a = encryptValue("same", KEY);
  const b = encryptValue("same", KEY);
  assert.notEqual(a, b, "nondeterministic — fresh salt + IV each call");
  assert.equal(decryptValue(a, KEY), "same");
  assert.equal(decryptValue(b, KEY), "same");
});

test("decryptValue: wrong key fails the GCM auth tag (throws)", () => {
  const ct = encryptValue("secret", KEY);
  assert.throws(() =>
    decryptValue(ct, "a-different-key-also-long-1234567890xx")
  );
});

test("decryptValue: rejects a too-short blob and a bad version byte", () => {
  assert.throws(() => decryptValue("AAAA", KEY), /too short/i);
  // valid-length blob but version byte 0x00 (encode 64 zero bytes)
  const badVersion = Buffer.alloc(64, 0).toString("base64");
  assert.throws(() => decryptValue(badVersion, KEY), /version/i);
});

test("hmacSign: deterministic, hex, and key-dependent", () => {
  const a = hmacSign("server-123", KEY);
  const b = hmacSign("server-123", KEY);
  assert.equal(a, b, "deterministic for the same (value,key)");
  assert.match(a, /^[a-f0-9]{64}$/, "sha256 hex digest");
  assert.notEqual(
    a,
    hmacSign("server-123", "other-key-of-good-length-1234567890"),
    "different key → different digest"
  );
});

test("Secret: never leaks through toString / JSON / template strings", () => {
  const s = new Secret("hunter2");
  assert.equal(s.unwrap(), "hunter2", "unwrap reveals the real value");
  assert.equal(s.toString(), "[REDACTED]");
  assert.equal(`${s}`, "[REDACTED]");
  assert.equal(JSON.stringify({ password: s }), '{"password":"[REDACTED]"}');
  assert.ok(!JSON.stringify({ password: s }).includes("hunter2"));
});
