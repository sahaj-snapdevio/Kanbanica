/**
 * Host cgroup-v2 `cpu.weight` for a cube, proportional to its vCPUs so CPU time
 * under contention is shared in proportion to what each cube paid for (audit C2,
 * L1 — see docs/superpowers/specs/2026-06-03-oversold-cpu-fairness-numa-design.md).
 *
 * cgroup-v2 `cpu.weight` is in [1, 10000], default 100. We map 1 vCPU → 100, so
 * an 8-vCPU cube gets 8× the CPU share of a 1-vCPU cube WHEN the host is
 * contended. It is **work-conserving**: idle cubes' cycles are still redistributed
 * to busy ones, so overselling is fully preserved — this only arbitrates the
 * share under contention, it imposes no hard cap (no `cpu.max`).
 *
 * Gated by `CPU_CGROUP_ENABLED` at the launch site; this pure helper is always safe
 * to call.
 */
export function cubeCpuWeight(vcpus: number): number {
  // A non-finite vcpus (NaN) slips through the Math.min/max clamp below and would
  // emit the literal arg `cpu.weight=NaN`, which the jailer rejects → a flag-ON
  // boot brick. Unreachable today (cubes.vcpus is `real NOT NULL` and a required
  // typed param on every launch path), but the floor must catch it so this helper
  // is genuinely "always safe to call" — fall back to the default weight (1 vCPU).
  if (!Number.isFinite(vcpus)) {
    return 100;
  }
  return Math.min(10_000, Math.max(1, Math.round(vcpus * 100)));
}
