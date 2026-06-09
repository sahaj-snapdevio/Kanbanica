import assert from "node:assert/strict";
import { test } from "node:test";
import { cn, slugifyHostname, truncateId } from "@/lib/utils";

// ── slugifyHostname (RFC-1123 label) ─────────────────────────────────────────

test("slugifyHostname: lowercases and hyphen-collapses invalid runs", () => {
  assert.equal(slugifyHostname("My Cube", "abc12345"), "my-cube");
  assert.equal(slugifyHostname("Foo___Bar  Baz", "abc12345"), "foo-bar-baz");
  assert.equal(slugifyHostname("API.Server.01", "abc12345"), "api-server-01");
});

test("slugifyHostname: strips leading/trailing hyphens", () => {
  assert.equal(slugifyHostname("--edge--", "abc12345"), "edge");
  assert.equal(slugifyHostname("  spaced  ", "abc12345"), "spaced");
});

test("slugifyHostname: all-invalid input falls back to cube-<id prefix>", () => {
  assert.equal(slugifyHostname("🚀🚀🚀", "abcdefgh90"), "cube-abcdefgh");
  assert.equal(slugifyHostname("!!!", "abcdefgh90"), "cube-abcdefgh");
  assert.equal(slugifyHostname("", "abcdefgh90"), "cube-abcdefgh");
});

test("slugifyHostname: caps at 63 chars and never ends in a hyphen", () => {
  const long = "a".repeat(100);
  const out = slugifyHostname(long, "abc12345");
  assert.equal(out.length, 63);
  assert.ok(!out.endsWith("-"));

  // A name whose 63rd char lands on a hyphen run must have it trimmed.
  const trailing = `${"a".repeat(62)} tail`;
  const out2 = slugifyHostname(trailing, "abc12345");
  assert.ok(!out2.endsWith("-"));
  assert.ok(out2.length <= 63);
});

test("slugifyHostname: produced label is always a valid RFC-1123 label", () => {
  const re = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  for (const name of [
    "My Cube",
    "🚀",
    "--x--",
    "A".repeat(80),
    "web_server.1",
  ]) {
    assert.match(
      slugifyHostname(name, "abcdefgh"),
      re,
      `bad label for "${name}"`
    );
  }
});

// ── truncateId ───────────────────────────────────────────────────────────────

test("truncateId: null/undefined → em-dash, short unchanged, long → prefix…suffix", () => {
  assert.equal(truncateId(null), "—");
  assert.equal(truncateId(undefined), "—");
  assert.equal(truncateId("short"), "short");
  assert.equal(truncateId("12345678901234"), "12345678901234"); // exactly 14
  assert.equal(truncateId("cus_0123456789abcdef"), "cus_0123…cdef");
});

// ── cn (tailwind class merge) ────────────────────────────────────────────────

test("cn: merges and lets later tailwind classes win", () => {
  assert.equal(cn("p-2", "p-4"), "p-4");
  // a runtime-falsy conditional class is dropped (clsx semantics)
  const showHidden = "" as string;
  assert.equal(
    cn("text-sm", showHidden && "hidden", "font-bold"),
    "text-sm font-bold"
  );
});
