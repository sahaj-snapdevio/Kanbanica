/**
 * Cube resize validation.
 *
 * Pure function — no DB calls, no I/O. Caller passes the cube row, the
 * server row (already loaded from DB), and the requested new values.
 * Returns either a green-light validation with computed deltas + live/cold
 * classification, or a structured error.
 *
 * Capacity headroom math mirrors `lib/server/allocate.ts`:
 *   - CPU: (allocated + delta) <= total * maxCpuOvercommit
 *   - RAM: (allocated + delta) <= total * maxRamOvercommit
 *   - Disk: (allocated + delta) <= EFFECTIVE capacity (totalDiskGb −
 *     measured non-cube overhead; no overcommit on disk — Rule 53)
 * Overcommit columns are Postgres `numeric` so Drizzle returns them as
 * strings — `parseFloat(String(...))` is the established pattern.
 *
 * Live vs cold classification:
 *   - Any CPU change → cold (vCPU count is locked at boot for the
 *     Firecracker microVM; can't be hotplugged).
 *   - CPU unchanged AND (RAM grow OR disk grow) → live (handled via
 *     virtio-mem RAM hotplug + disk image grow + filesystem resize, no
 *     reboot needed).
 *
 * Caller is responsible for: loading the cube + server, persisting the
 * resize, deciding the post-validation orchestration, and writing audit
 * / lifecycle logs.
 */

import { CPU_OPTIONS, DISK_OPTIONS, RAM_OPTIONS } from "@/config/platform";
import type { cubes, servers } from "@/db/schema";
import { describeRange, isValidRangeValue } from "@/lib/cube-options";
import { serverCpuRamCapacity } from "@/lib/server/cpu-ram-capacity";
import { effectiveDiskCapacityGb } from "@/lib/server/disk-capacity";

/** Fields of `cubes` row needed to validate a resize. */
type CubeForResize = Pick<
  typeof cubes.$inferSelect,
  "vcpus" | "ramMb" | "diskLimitGb" | "hasVirtioMem"
>;

/** Fields of `servers` row needed to validate a resize. */
type ServerForResize = Pick<
  typeof servers.$inferSelect,
  | "totalCpus"
  | "totalRamMb"
  | "totalDiskGb"
  | "overheadDiskGb"
  | "allocatedCpus"
  | "allocatedRamMb"
  | "allocatedDiskGb"
  | "maxCpuOvercommit"
  | "maxRamOvercommit"
>;

/** Requested new resource values for a cube. */
export interface ResizeRequest {
  diskLimitGb: number;
  ramMb: number;
  vcpus: number;
}

/** Result of validating a resize request. */
export type ResizeValidation =
  | {
      ok: true;
      /** True when resize can be performed live (no cold restart). */
      isLive: boolean;
      /** Deltas relative to current cube values; non-negative for grow. */
      delta: { cpu: number; ram: number; disk: number };
    }
  | { ok: false; error: string };

export function validateResize(opts: {
  cube: CubeForResize;
  server: ServerForResize;
  req: ResizeRequest;
}): ResizeValidation {
  const { cube, server, req } = opts;

  // 1. Range/step against platform options. (No vCPU-parity restriction:
  //    Firecracker's "1 or even" rule applies ONLY with SMT enabled, and Krova
  //    never sets smt — verified on real Firecracker v1.15.1 that an odd
  //    vcpu_count boots fine. See the host smoke harness.)
  if (!isValidRangeValue(req.vcpus, CPU_OPTIONS)) {
    return {
      ok: false,
      error: `Invalid vCPUs: must be ${describeRange(CPU_OPTIONS)}`,
    };
  }
  if (!isValidRangeValue(req.ramMb, RAM_OPTIONS)) {
    return {
      ok: false,
      error: `Invalid RAM: must be ${describeRange(RAM_OPTIONS)} MB`,
    };
  }
  if (!isValidRangeValue(req.diskLimitGb, DISK_OPTIONS)) {
    return {
      ok: false,
      error: `Invalid disk: must be ${describeRange(DISK_OPTIONS)} GB`,
    };
  }

  // Compute deltas (request − current).
  const cpuDelta = req.vcpus - cube.vcpus;
  const ramDelta = req.ramMb - cube.ramMb;
  const diskDelta = req.diskLimitGb - cube.diskLimitGb;

  // 2. Shrink blocked across CPU, RAM, disk.
  if (cpuDelta < 0 || ramDelta < 0 || diskDelta < 0) {
    return {
      ok: false,
      error: "Shrinking cube resources is not supported.",
    };
  }

  // 3. No-op (all three fields unchanged).
  if (cpuDelta === 0 && ramDelta === 0 && diskDelta === 0) {
    return {
      ok: false,
      error: "No changes requested.",
    };
  }

  // 4. virtio-mem capability gate — ONLY blocks LIVE RAM grow.
  // A cold resize re-runs startCube, which itself declares virtio-mem
  // on every boot regardless of the cube's prior `hasVirtioMem` value
  // (the boot floor + total size are baked into Firecracker's machine
  // config at every InstanceStart). So a cold CPU-only or disk-only
  // resize on a pre-virtio-mem cube IS supported. Only the live RAM
  // grow path actually needs virtio-mem (it PATCHes /hotplug/memory at
  // runtime). See audit M12 (2026-05-24).
  const requiresLiveVirtioMem = ramDelta > 0 && cpuDelta === 0;
  if (requiresLiveVirtioMem && !cube.hasVirtioMem) {
    return {
      ok: false,
      error:
        "Live RAM grow requires virtio-mem. This cube was provisioned before " +
        "live-resize support — power-cycle it (Cold Restart) to enable, or " +
        "change CPU/disk in the same resize to take the cold path.",
    };
  }

  // 5. Capacity headroom on the same server.
  const { maxCpu, maxRam } = serverCpuRamCapacity(server);
  // Effective (overhead-adjusted) capacity — never the raw partition size, so
  // a disk grow can't push reservations past real disk (Rule 53, Rule 14).
  const maxDisk = effectiveDiskCapacityGb(server);

  if (server.allocatedCpus + cpuDelta > maxCpu) {
    return {
      ok: false,
      error: "Server does not have enough CPU capacity for this resize.",
    };
  }
  if (server.allocatedRamMb + ramDelta > maxRam) {
    return {
      ok: false,
      error: "Server does not have enough RAM capacity for this resize.",
    };
  }
  if (server.allocatedDiskGb + diskDelta > maxDisk) {
    return {
      ok: false,
      error: "Server does not have enough disk capacity for this resize.",
    };
  }

  // 6. Live vs cold classification.
  // Any CPU change → cold (vCPU count is locked at boot in Firecracker).
  // Otherwise, RAM/disk grow only → live.
  const isLive = cpuDelta === 0 && (ramDelta > 0 || diskDelta > 0);

  return {
    ok: true,
    isLive,
    delta: { cpu: cpuDelta, ram: ramDelta, disk: diskDelta },
  };
}
