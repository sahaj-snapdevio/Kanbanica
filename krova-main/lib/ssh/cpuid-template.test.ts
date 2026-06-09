import assert from "node:assert/strict";
import { test } from "node:test";
import {
  avx512MaskCpuidModifiers,
  buildClearBitmap,
} from "@/lib/ssh/cpuid-template";

test("buildClearBitmap: empty list is all passthrough", () => {
  assert.equal(buildClearBitmap([]), "x".repeat(32));
});

test("buildClearBitmap: always exactly 32 chars", () => {
  assert.equal(buildClearBitmap([]).length, 32);
  assert.equal(buildClearBitmap([0, 15, 31]).length, 32);
});

test("buildClearBitmap: bit 0 is the rightmost char", () => {
  assert.equal(buildClearBitmap([0]), `${"x".repeat(31)}0`);
});

test("buildClearBitmap: bit 31 is the leftmost char", () => {
  assert.equal(buildClearBitmap([31]), `0${"x".repeat(31)}`);
});

test("buildClearBitmap: bit N lands at index (31 - N) from the left", () => {
  const bm = buildClearBitmap([16]);
  assert.equal(bm[31 - 16], "0");
  // exactly one bit cleared
  assert.equal(bm.split("").filter((c) => c === "0").length, 1);
});

test("buildClearBitmap: only 'x' and '0' appear (never force-set)", () => {
  assert.match(buildClearBitmap([1, 2, 3]), /^[x0]{32}$/);
});

test("avx512MaskCpuidModifiers: two leaves — 0x7/0x0 (features) + 0xd/0x0 (xsave state)", () => {
  const mods = avx512MaskCpuidModifiers();
  assert.equal(mods.length, 2);
  assert.equal(mods[0].leaf, "0x7");
  assert.equal(mods[0].subleaf, "0x0");
  assert.equal(mods[1].leaf, "0xd");
  assert.equal(mods[1].subleaf, "0x0");
});

test("avx512MaskCpuidModifiers: flags MUST be 1 (KVM SIGNIFICANT_INDEX) on both leaves", () => {
  // Firecracker apply OVERWRITES entry.flags from the modifier; leaf 0x7 AND
  // leaf 0xd are subleaf-significant, so flags=0 would corrupt their subleaf
  // indexing in the guest.
  for (const leaf of avx512MaskCpuidModifiers()) {
    assert.equal(leaf.flags, 1);
  }
});

test("avx512MaskCpuidModifiers: leaf 0xd clears XSAVE state bits 5/6/7, keeps AVX state (2)", () => {
  const leafD = avx512MaskCpuidModifiers().find((l) => l.leaf === "0xd");
  assert.ok(leafD);
  const eax = leafD.modifiers.find((m) => m.register === "eax");
  assert.ok(eax);
  assert.equal(eax.bitmap.length, 32);
  // AVX-512 XSAVE state: opmask(5), ZMM_Hi256(6), Hi16_ZMM(7) — must be cleared.
  for (const bit of [5, 6, 7]) {
    assert.equal(eax.bitmap[31 - bit], "0", `xsave bit ${bit} must be cleared`);
  }
  // x87(0), SSE(1), AVX(2), MPX(3,4), PKRU(9) — must stay passthrough so
  // AVX/AVX2 XSAVE state is unaffected.
  for (const bit of [0, 1, 2, 3, 4, 9]) {
    assert.equal(eax.bitmap[31 - bit], "x", `xsave bit ${bit} must be kept`);
  }
});

test("avx512MaskCpuidModifiers: modifies ebx, ecx, edx (32-char bitmaps)", () => {
  const leaf = avx512MaskCpuidModifiers()[0];
  assert.deepEqual(
    leaf.modifiers.map((m) => m.register),
    ["ebx", "ecx", "edx"]
  );
  for (const m of leaf.modifiers) {
    assert.equal(m.bitmap.length, 32);
    assert.match(m.bitmap, /^[x0]{32}$/);
  }
});

test("avx512MaskCpuidModifiers: clears AVX512F (EBX bit 16)", () => {
  const ebx = avx512MaskCpuidModifiers()[0].modifiers.find(
    (m) => m.register === "ebx"
  );
  assert.ok(ebx);
  assert.equal(ebx.bitmap[31 - 16], "0");
});

test("avx512MaskCpuidModifiers: keeps AVX2 (EBX bit 5) as passthrough", () => {
  // Regression guard: AVX2 is leaf 7 subleaf 0 EBX bit 5 and must NOT be masked.
  const ebx = avx512MaskCpuidModifiers()[0].modifiers.find(
    (m) => m.register === "ebx"
  );
  assert.ok(ebx);
  assert.equal(ebx.bitmap[31 - 5], "x");
});

test("avx512MaskCpuidModifiers: keeps VAES/GFNI/VPCLMULQDQ (ECX 8/9/10)", () => {
  // These have AVX (non-512) encodings and must stay available.
  const ecx = avx512MaskCpuidModifiers()[0].modifiers.find(
    (m) => m.register === "ecx"
  );
  assert.ok(ecx);
  for (const bit of [8, 9, 10]) {
    assert.equal(ecx.bitmap[31 - bit], "x");
  }
});

test("avx512MaskCpuidModifiers: clears every documented AVX-512 bit", () => {
  const leaf = avx512MaskCpuidModifiers()[0];
  const byReg = Object.fromEntries(
    leaf.modifiers.map((m) => [m.register, m.bitmap])
  );
  const expected = {
    ebx: [16, 17, 21, 26, 27, 28, 30, 31],
    ecx: [1, 6, 11, 12, 14],
    edx: [2, 3, 8, 23],
  };
  for (const [reg, bits] of Object.entries(expected)) {
    for (const bit of bits) {
      assert.equal(
        byReg[reg][31 - bit],
        "0",
        `${reg} bit ${bit} must be cleared`
      );
    }
  }
});
