/**
 * Pure disk-topology helpers (no I/O). The host detection shells out elsewhere
 * (server-bootstrap / install:disk-topology) using `DISK_TOPOLOGY_PROBE`; this
 * module only parses the raw probe output, so it is fully unit-testable with
 * zero deps. The parsed topology drives every hardware-ADAPTIVE choice in the
 * disk-I/O overhaul: SATA-SSD chooses mq-deadline + base QoS caps; NVMe chooses
 * none + larger caps; the per-device `numaNode` feeds NUMA-local backing placement.
 *
 * The probe is read-only and UNGATED (topology is harmless metadata, recorded
 * regardless of any flag — mirrors the NUMA probe, Rule 35).
 */

export type DiskTopology = {
  /** Kernel device name (sda, nvme0n1, vda). */
  device: string;
  /** true = spinning rust; false = SSD or NVMe (queue/rotational == 0). */
  rotational: boolean;
  /** true if the device is NVMe (transport or name). Drives adaptive tuning. */
  nvme: boolean;
  /** lsblk TRAN (sata, nvme, virtio, ...), or null if unknown. */
  tran: string | null;
  /** Active I/O scheduler for the device, or null. Informational only. */
  scheduler: string | null;
  /** Device NUMA node from sysfs (-1 = unknown or no affinity). NEVER written back. */
  numaNode: number;
}[];

/**
 * Host probe: one TSV line per PHYSICAL whole-disk —
 * name, rotational, tran, raw-scheduler, numa_node. Filtered to sd, nvme and vd
 * devices (skips loop, sr, dm, md, ram). Read-only (`lsblk` + `cat /sys/block`).
 * Operator-run on the host (Rule 60); shared by the bootstrap handler and the
 * retrofit script so new and existing hosts converge on identical detection
 * (Rule 14). The bracketed active scheduler is parsed in TS, not the shell.
 */
export const DISK_TOPOLOGY_PROBE =
  "lsblk -dn -o NAME,ROTA,TRAN 2>/dev/null | while read -r n r t _; do " +
  'case "$n" in sd[a-z]*|nvme[0-9]*n[0-9]*|vd[a-z]*) ;; *) continue ;; esac; ' +
  's=$(cat /sys/block/"$n"/queue/scheduler 2>/dev/null | tr "\\n" " "); ' +
  'm=$(cat /sys/block/"$n"/device/numa_node 2>/dev/null); ' +
  // Plain `$var` (no `${...}` braces) — the parser is tolerant of empty fields,
  // so shell defaults are unnecessary, and braces would read as a JS template.
  'printf "%s\\t%s\\t%s\\t%s\\t%s\\n" "$n" "$r" "$t" "$s" "$m"; ' +
  "done";

const PHYSICAL_DISK = /^(sd[a-z]+|nvme\d+n\d+|vd[a-z]+)$/;

/** Extract the active scheduler from a raw `queue/scheduler` value like
 *  "none [mq-deadline]" → "mq-deadline"; falls back to the trimmed raw value. */
function activeScheduler(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }
  const bracket = raw.match(/\[([^\]]+)\]/);
  const value = (bracket ? bracket[1] : raw).trim();
  return value.length > 0 ? value : null;
}

/**
 * Parse the probe output into a device-sorted topology. Tolerant by design
 * (mirrors `parseNumaCpulists`): empty input or odd layouts (no physical disks,
 * short lines) yield `[]`, never throws — a parse failure must NOT abort bootstrap.
 */
export function parseDiskTopology(out: string): DiskTopology {
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [device, rota, tran, scheduler, numa] = line.split("\t");
      const numaNode = Number.parseInt(numa ?? "", 10);
      return {
        device: device ?? "",
        rotational: rota === "1",
        nvme: tran === "nvme" || (device ?? "").startsWith("nvme"),
        tran: tran ? tran : null,
        scheduler: activeScheduler(scheduler),
        numaNode: Number.isFinite(numaNode) ? numaNode : -1,
      };
    })
    .filter((d) => PHYSICAL_DISK.test(d.device))
    .sort((a, b) => a.device.localeCompare(b.device));
}

/**
 * Whether a host should be treated as NVMe-class for adaptive QoS sizing: any
 * non-virtio NVMe device present. SATA-only, virtio-only or undetected yields
 * false (base caps). Coarse on purpose — the caps are generous; the
 * correctness-critical per-cube `io.max` device is resolved precisely at runtime
 * (cubeDiskDeviceCommand).
 */
export function hostIsNvmeClass(
  topology: DiskTopology | null | undefined
): boolean {
  return (topology ?? []).some((d) => d.nvme);
}
