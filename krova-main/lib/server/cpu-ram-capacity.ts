/**
 * Single source of truth for the per-server CPU/RAM overcommit cap (Rule 14).
 *
 * Disk has its own module (lib/server/disk-capacity.ts); this is the CPU+RAM
 * analog. EVERY placement/resize/transfer cap decision routes through here:
 * the worker (allocate.ts, cube-resize/validate.ts, cube-transfer.ts) AND the
 * three Orbit transfer API routes (app/api/orbit/cubes/[cubeId]/{transfer,
 * transfer-check,transfer-targets}). Never re-derive `totalCpus *
 * maxCpuOvercommit` inline again — a future overcommit-semantics change must
 * land in ONE place (review A1, resolved 2026-06-04).
 *
 * `maxCpuOvercommit` / `maxRamOvercommit` are stored as numeric strings by
 * drizzle, so they are parsed defensively here.
 */

type CapServer = {
  maxCpuOvercommit: string | number;
  maxRamOvercommit: string | number;
  totalCpus: number;
  totalRamMb: number;
};

type UsageServer = CapServer & {
  allocatedCpus: number;
  allocatedRamMb: number;
};

/** The absolute CPU/RAM ceilings for a server (totals × overcommit ratios). */
export function serverCpuRamCapacity(s: CapServer): {
  maxCpu: number;
  maxRam: number;
} {
  return {
    maxCpu: s.totalCpus * Number.parseFloat(String(s.maxCpuOvercommit)),
    maxRam: s.totalRamMb * Number.parseFloat(String(s.maxRamOvercommit)),
  };
}

/** True iff adding `addVcpus` / `addRamMb` keeps the server within BOTH caps. */
export function serverHasCpuRamRoom(
  s: UsageServer,
  addVcpus: number,
  addRamMb: number
): boolean {
  const { maxCpu, maxRam } = serverCpuRamCapacity(s);
  return (
    s.allocatedCpus + addVcpus <= maxCpu &&
    s.allocatedRamMb + addRamMb <= maxRam
  );
}
