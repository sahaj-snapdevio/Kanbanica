/**
 * Single source of truth for a server's EFFECTIVE disk capacity — the real
 * GB available for cube reservations after subtracting measured non-cube
 * overhead (OS, swap file, kernel/rootfs images, restic cache, /tmp staging,
 * logs).
 *
 * Krova sells disk 1:1 with the host and NEVER oversells (Rule 53). Cube
 * reservations are always the full `diskLimitGb` — a sparse rootfs using less
 * than its limit is irrelevant, because the customer can fill it to the limit
 * at any moment. To guarantee "reservations + real overhead never overflow the
 * disk", the allocator caps total reservations at:
 *
 *     effective capacity = totalDiskGb − overheadDiskGb
 *
 * `overheadDiskGb` is measured hourly by the `server.measure-disk` cron
 * (`df_used − du(/var/lib/krova/cubes)`). It defaults to 0, so before the first
 * measurement the math collapses to the historical `totalDiskGb` ceiling —
 * zero behavior change on a freshly-deployed or never-measured server.
 *
 * EVERY disk-capacity decision (cube allocation, cross-server transfer) MUST
 * route through here — never compare against `totalDiskGb` directly (Rule 14).
 */

/** The subset of `servers` columns the disk-capacity math needs. */
export interface ServerDiskFields {
  allocatedDiskGb: number;
  overheadDiskGb: number;
  totalDiskGb: number;
}

/**
 * Real GB available for cube reservations on this server, after subtracting
 * measured non-cube overhead. Clamped at 0 (a host whose overhead already
 * exceeds its partition — e.g. mid-measurement race — reports no room rather
 * than a negative).
 */
export function effectiveDiskCapacityGb(server: ServerDiskFields): number {
  return Math.max(0, server.totalDiskGb - server.overheadDiskGb);
}

/** GB still free for new reservations: effective capacity − already reserved. */
export function availableDiskGb(server: ServerDiskFields): number {
  return Math.max(0, effectiveDiskCapacityGb(server) - server.allocatedDiskGb);
}

/**
 * Does this server have room to reserve `diskLimitGb` more disk without
 * pushing total reservations past the effective (overhead-adjusted) capacity?
 */
export function serverHasDiskRoom(
  server: ServerDiskFields,
  diskLimitGb: number
): boolean {
  return (
    server.allocatedDiskGb + diskLimitGb <= effectiveDiskCapacityGb(server)
  );
}
