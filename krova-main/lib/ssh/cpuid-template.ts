/**
 * Firecracker custom CPU template — AVX-512 CPUID mask.
 *
 * WHY: Firecracker passes the host CPUID through to the guest, advertising
 * AVX-512 in CPUID leaf 0x7, but the microVM's XSAVE state does not back the
 * ZMM / opmask registers. Any AVX-512 instruction the guest then executes
 * faults with SIGILL (Geekbench 6, NumPy-with-AVX-512, etc. — the 2026-06-01
 * benchmark cube). Clearing the leaf-0x7 AVX-512 feature bits makes guest
 * software not detect AVX-512 at all, so it falls back to AVX2 and never
 * executes the unsupported instructions. AVX2/AES/SSE4/BMI stay untouched.
 *
 * TWO LEAVES, because there are two CPUID detection paths for AVX-512 and they
 * must AGREE — an inconsistent CPUID is itself a bug:
 *   1. Leaf 0x7 subleaf 0 — the AVX-512 *instruction feature* flags (AVX512F,
 *      DQ, BW, VL, …). Most software keys off these.
 *   2. Leaf 0xD subleaf 0 EAX — the XSAVE *state-component* bits for AVX-512
 *      (opmask=5, ZMM_Hi256=6, Hi16_ZMM=7), i.e. the XCR0 valid-bit mask.
 *      Aggressive CPU probers (Geekbench's `geekbench_avx2` worker) detect
 *      AVX-512 from the XSAVE/XCR0 side here, NOT leaf 0x7.
 * If we mask only leaf 0x7, leaf 0xD still advertises the AVX-512 save state →
 * the CPUID is inconsistent (leaf 7 "no AVX-512", leaf 0xD "AVX-512 state
 * present"). Geekbench reads leaf 0xD, takes an AVX-512 path, faults, and
 * corrupts its thread's vector state so even a plain AVX2 `vmovdqu %ymm` then
 * #UDs (observed on the benchmark cube: SIGILL in glibc
 * `__memcpy_avx_unaligned_erms`). Clearing the AVX-512 bits in BOTH leaves
 * makes the CPUID self-consistent: no detection path sees AVX-512, so nothing
 * tries it. (The guest kernel already excludes AVX-512 from XCR0 when leaf 7
 * lacks it — it enabled `0x21f`, not `0x2ff` — so removing the AVX-512 bits
 * from the leaf-0xD valid mask only makes the advertisement match what's
 * already enabled; AVX/AVX2 state is unaffected.)
 *
 * WHY A CUSTOM TEMPLATE (PUT /cpu-config) AND NOT A STATIC ONE (T2 / T2A):
 * Firecracker's static templates enforce an EXACT host family/model/stepping
 * allowlist at InstanceStart and return an error — refusing to boot — on any
 * non-allowlisted CPU (Cooper Lake, Sapphire/Emerald Rapids, off-stepping
 * Skylake, AMD non-Milan, …). That would brick cube boots on those hosts, and
 * the presence of AVX-512 on a host does NOT prove it is on the allowlist. A
 * CUSTOM template skips that gate entirely — verified in Firecracker v1.15.1
 * `src/vmm/src/cpu_config/x86_64/custom_cpu_template.rs`, whose `Custom(t)` arm
 * returns the template unchecked while the `Static` arm runs the vendor/model
 * check. So the SAME mask is vendor-agnostic and can never brick a boot:
 * clearing a bit the host doesn't have is a harmless no-op.
 *
 * VERIFIED AGAINST FIRECRACKER v1.15.1 (the pinned FIRECRACKER_VERSION):
 *  - Endpoint: `PUT /cpu-config`, pre-boot only, body = `CpuConfig` with a
 *    `cpuid_modifiers` array (swagger `CpuidLeafModifier` / `CpuidRegisterModifier`).
 *  - Apply (`cpu_config/x86_64/mod.rs`) locates the entry by (leaf, subleaf)
 *    ONLY, then `entry.flags = mod_leaf.flags` — it OVERWRITES the entry's
 *    KVM flags from the modifier. Leaf 0x7 must therefore carry
 *    `flags = SIGNIFICANT_INDEX (1)`, or the guest's leaf-7 subleaf indexing
 *    breaks. Setting flags=0 here would be a real bug.
 *  - Apply returns `CpuidFeatureNotSupported(leaf, subleaf)` (boot fails) if the
 *    (leaf, subleaf) is absent — so we ONLY touch subleaf 0 of leaf 0x7 and
 *    leaf 0xD, both of which exist on every modern x86 KVM guest with XSAVE
 *    (Intel and AMD alike; verified on a live Firecracker host). Leaf 0xD is
 *    also subleaf-significant, so it likewise carries `flags = SIGNIFICANT_INDEX`.
 *  - Bitmap: a 32-char string, bit 31 leftmost; `x` = keep host bit, `0` =
 *    force-clear, `1` = force-set.
 *
 * AVX-512 feature-bit positions are per Intel SDM Vol.2 CPUID leaf 0x7
 * subleaf 0, cross-checked against Firecracker's own T2 template
 * (`static_cpu_templates/t2.rs`), which masks the same AVX-512 bits. The
 * leaf-0xD XCR0 state bits are per Intel SDM Vol.1 §13.1.
 */

/**
 * KVM_CPUID_FLAG_SIGNIFICANT_INDEX — set on leaves whose result depends on the
 * subleaf (ECX) index. Both leaf 0x7 and leaf 0xD are subleaf-significant. The
 * Firecracker apply OVERWRITES the entry's flags from the modifier, so each
 * modifier MUST carry this or the guest's subleaf indexing for that leaf breaks.
 */
const KVM_CPUID_FLAG_SIGNIFICANT_INDEX = 1;

/**
 * AVX-512 *instruction-feature* bits in CPUID leaf 0x7, subleaf 0, grouped by
 * register. Every listed bit is an AVX-512 (sub)feature — none is a neighbouring
 * non-AVX-512 feature (AVX2 is EBX bit 5; GFNI/VAES/VPCLMULQDQ are ECX 8/9/10 —
 * all deliberately left as passthrough).
 */
const AVX512_FEATURE_BITS = {
  // EBX: F(16) DQ(17) IFMA(21) PF(26) ER(27) CD(28) BW(30) VL(31)
  ebx: [16, 17, 21, 26, 27, 28, 30, 31],
  // ECX: VBMI(1) VBMI2(6) VNNI(11) BITALG(12) VPOPCNTDQ(14)
  ecx: [1, 6, 11, 12, 14],
  // EDX: 4VNNIW(2) 4FMAPS(3) VP2INTERSECT(8) FP16(23)
  edx: [2, 3, 8, 23],
} as const;

/**
 * AVX-512 *XSAVE state-component* bits in CPUID leaf 0xD, subleaf 0, EAX (the
 * low 32 bits of the XCR0 valid-bit mask): opmask(5), ZMM_Hi256(6), Hi16_ZMM(7).
 * Clearing these removes AVX-512 from the XSAVE/XCR0 detection path so it agrees
 * with the leaf-0x7 mask. AVX state (bit 2), SSE (1), x87 (0), MPX (3,4) and
 * PKRU (9) are left as passthrough, so AVX/AVX2 are unaffected.
 */
const AVX512_XSAVE_STATE_BITS = [5, 6, 7];

export interface CpuidRegisterModifier {
  bitmap: string;
  register: string;
}

export interface CpuidLeafModifier {
  flags: number;
  leaf: string;
  modifiers: CpuidRegisterModifier[];
  subleaf: string;
}

/**
 * Build a Firecracker 32-character CPUID register bitmap. Bit 31 is the
 * leftmost character, bit 0 the rightmost. `x` = passthrough (keep the host's
 * bit), `0` = force-clear. (We never force-set, so `1` is unused here.)
 */
export function buildClearBitmap(clearBits: number[]): string {
  const clear = new Set(clearBits);
  let out = "";
  for (let bit = 31; bit >= 0; bit--) {
    out += clear.has(bit) ? "0" : "x";
  }
  return out;
}

/**
 * The `cpuid_modifiers` payload for `PUT /cpu-config` that masks AVX-512 in
 * BOTH detection paths — leaf 0x7 subleaf 0 (instruction features) and leaf 0xD
 * subleaf 0 EAX (XSAVE state components). Vendor-agnostic — identical body for
 * every host; clearing an already-absent bit is a no-op.
 */
export function avx512MaskCpuidModifiers(): CpuidLeafModifier[] {
  return [
    {
      leaf: "0x7",
      subleaf: "0x0",
      flags: KVM_CPUID_FLAG_SIGNIFICANT_INDEX,
      modifiers: [
        {
          register: "ebx",
          bitmap: buildClearBitmap([...AVX512_FEATURE_BITS.ebx]),
        },
        {
          register: "ecx",
          bitmap: buildClearBitmap([...AVX512_FEATURE_BITS.ecx]),
        },
        {
          register: "edx",
          bitmap: buildClearBitmap([...AVX512_FEATURE_BITS.edx]),
        },
      ],
    },
    {
      leaf: "0xd",
      subleaf: "0x0",
      flags: KVM_CPUID_FLAG_SIGNIFICANT_INDEX,
      modifiers: [
        {
          register: "eax",
          bitmap: buildClearBitmap([...AVX512_XSAVE_STATE_BITS]),
        },
      ],
    },
  ];
}
