/**
 * Status-to-display helpers. Each status enum has exactly one runtime
 * source — the pgEnum declared in `db/schema/*` (or `CUBE_STATUS_VALUES`
 * in `db/schema/types.ts`) — and everything else (filter options, badge
 * variant, color tint class, label, description) is derived here so
 * adding a new value requires editing only the schema file plus this
 * module's per-enum table.
 *
 * Two flavours of helper:
 *   - `*StatusVariant()` returns a shadcn Badge `variant` for components
 *     using `<Badge variant={...}>` (Orbit admin tables).
 *   - `*_CLASSES` is a full Tailwind class string for the custom-styled
 *     pill badges (CubeStatusBadge, ResourceStatusBadge, TcpMappingCard,
 *     billing event chips).
 */

import type { VariantProps } from "class-variance-authority";
import type { badgeVariants } from "@/components/ui/badge";
import {
  type billingEventType,
  creditPurchaseStatus,
  cubeImportStatus,
  domainClaimStatus,
  domainStatus,
  serverSetupPhase,
  type serverStatus,
  snapshotStatus,
} from "@/db/schema";
import { CUBE_STATUS_VALUES, type CubeStatusValue } from "@/db/schema/types";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

/**
 * Capitalize the first letter and turn `_` into spaces so a raw pgEnum
 * value renders as a customer-facing label ("past_due" → "Past due").
 * Exported so badge cells can render `{capitalizeStatus(s.status)}`
 * instead of the raw lowercase enum string.
 */
export function capitalizeStatus(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

// Backwards-compat alias used by the existing buildFilterOptions helper.
const capitalize = capitalizeStatus;

function buildFilterOptions<T extends string>(
  values: readonly T[]
): { value: "all" | T; label: string }[] {
  return [
    { value: "all", label: "All statuses" },
    ...values.map((v) => ({ value: v, label: capitalize(v) })),
  ];
}

// ─── Cube status ───────────────────────────────────────────────────────────
// Source of truth: `CUBE_STATUS_VALUES` in `db/schema/types.ts`.
export const CUBE_STATUS_CONFIG: Record<
  CubeStatusValue,
  { label: string; className: string }
> = {
  pending: {
    label: "Pending",
    className: "bg-muted text-muted-foreground",
  },
  booting: {
    label: "Booting",
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 animate-pulse",
  },
  running: {
    label: "Running",
    className: "bg-green-500/10 text-green-600 dark:text-green-400",
  },
  sleeping: {
    label: "Sleeping",
    className: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  },
  stopping: {
    label: "Stopping",
    className: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  error: {
    label: "Error",
    className: "bg-red-500/10 text-red-600 dark:text-red-400",
  },
  deleted: {
    label: "Deleted",
    className: "bg-muted text-muted-foreground line-through",
  },
};

/**
 * Active (in-flight) cross-server transfer states. A cube mid-transfer keeps
 * `cubes.status='running'/'sleeping'` (the transfer lives in the SEPARATE
 * `cubeTransferState` column), so a plain status badge misleadingly shows
 * "Running". When `transferState` is one of these, surface a distinct
 * "Transferring" badge instead. `idle` / `completed` / `failed` are NOT active
 * — show the real cube status. Values mirror the `cubeTransferState` pgEnum in
 * db/schema/cubes.ts.
 */
const ACTIVE_TRANSFER_STATES = new Set([
  "snapshotting",
  "restoring",
  "finalizing",
  "cancelling",
]);

/** True when the cube is mid cross-server transfer (the badge should show
 *  "Transferring" rather than its underlying running/sleeping status). */
export function isActiveTransferState(
  transferState: string | null | undefined
): boolean {
  return transferState != null && ACTIVE_TRANSFER_STATES.has(transferState);
}

/**
 * Display config for the DERIVED "Transferring" badge. Not a real cube-status
 * enum value — computed from `cubes.transferState` (see `isActiveTransferState`).
 */
export const TRANSFERRING_BADGE = {
  label: "Transferring",
  className:
    "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 animate-pulse",
} as const;

export const CUBE_STATUS_FILTER_OPTIONS =
  buildFilterOptions(CUBE_STATUS_VALUES);

// ─── Snapshot ──────────────────────────────────────────────────────────────
export type SnapshotStatus = (typeof snapshotStatus.enumValues)[number];
export const SNAPSHOT_STATUS_OPTIONS = buildFilterOptions(
  snapshotStatus.enumValues
);
export function snapshotStatusVariant(s: SnapshotStatus): BadgeVariant {
  if (s === "complete") {
    return "default";
  }
  if (s === "failed") {
    return "destructive";
  }
  return "secondary";
}

// ─── Backup ────────────────────────────────────────────────────────────────
// Source of truth: BackupItem status literal in `components/backup-list.tsx`
// (no pgEnum — the column is plain text on `cube_backups.status`).
export type BackupStatus = "pending" | "creating" | "complete" | "failed";
export function backupStatusVariant(s: BackupStatus): BadgeVariant {
  if (s === "complete") {
    return "default";
  }
  if (s === "failed") {
    return "destructive";
  }
  return "secondary";
}

// ─── Invite ────────────────────────────────────────────────────────────────
// The members-page "effective invite status" already maps `pending` past
// expiry to `expired` — see `effectiveInviteStatus()` in members-page.tsx.
export type InviteStatus = "pending" | "expired" | "accepted" | "revoked";
export function inviteStatusVariant(s: InviteStatus): BadgeVariant {
  if (s === "pending") {
    return "default";
  }
  if (s === "revoked") {
    return "destructive";
  }
  // accepted (slate/neutral) + expired (amber-ish) both fit `secondary`.
  return "secondary";
}

// ─── Credit purchase ───────────────────────────────────────────────────────
export type CreditPurchaseStatus =
  (typeof creditPurchaseStatus.enumValues)[number];
export const CREDIT_PURCHASE_STATUS_OPTIONS = buildFilterOptions(
  creditPurchaseStatus.enumValues
);
export function creditPurchaseStatusVariant(
  s: CreditPurchaseStatus
): BadgeVariant {
  if (s === "paid") {
    return "default";
  }
  if (s === "pending") {
    return "secondary";
  }
  if (s === "failed" || s === "orphaned") {
    return "destructive";
  }
  return "outline"; // refunded, partially_refunded
}

// ─── Cube import ───────────────────────────────────────────────────────────
// `cube_imports.status` lifecycle: uploading → finalizing → provisioning →
// {complete, failed, expired}. The reaper marks abandoned/stuck rows
// `expired`/`failed` so the customer UI can surface a terminal state.
export type CubeImportStatus = (typeof cubeImportStatus.enumValues)[number];
export const CUBE_IMPORT_STATUS_OPTIONS = buildFilterOptions(
  cubeImportStatus.enumValues
);
export function cubeImportStatusVariant(s: CubeImportStatus): BadgeVariant {
  if (s === "complete") {
    return "default";
  }
  if (s === "uploading" || s === "finalizing" || s === "provisioning") {
    return "secondary";
  }
  if (s === "failed" || s === "expired") {
    return "destructive";
  }
  return "outline";
}

// ─── Domain routing ────────────────────────────────────────────────────────
export type DomainStatus = (typeof domainStatus.enumValues)[number];
export const DOMAIN_STATUS_OPTIONS = buildFilterOptions(
  domainStatus.enumValues
);
export function domainStatusVariant(s: DomainStatus): BadgeVariant {
  if (s === "active") {
    return "default";
  }
  if (s === "stopping") {
    return "outline";
  }
  return "secondary";
}

// ─── Space domain claim status ─────────────────────────────────────────────
export type DomainClaimStatus = (typeof domainClaimStatus.enumValues)[number];
export const DOMAIN_CLAIM_STATUS_OPTIONS = buildFilterOptions(
  domainClaimStatus.enumValues
);
export function domainClaimStatusVariant(s: DomainClaimStatus): BadgeVariant {
  if (s === "verified") {
    return "default";
  }
  if (s === "failed") {
    return "destructive";
  }
  return "secondary";
}

// ─── Cloudflare hostname status ────────────────────────────────────────────
// Cloudflare's status is a free-form string from the API — not a Postgres
// enum. Mapped here as the platform's single source of truth.
export function cloudflareStatusVariant(status: string | null): BadgeVariant {
  if (!status) {
    return "outline";
  }
  if (status === "active") {
    return "default";
  }
  if (status === "pending" || status === "pending_validation") {
    return "secondary";
  }
  if (status.includes("failed")) {
    return "destructive";
  }
  return "outline";
}

// ─── Subscription status ───────────────────────────────────────────────────
// `spaces.subscription_status` is a free-form text column mirroring Polar's
// status (NOT a pgEnum).
export const SUBSCRIPTION_STATUS_VALUES = [
  "active",
  "past_due",
  "unpaid",
  "canceled",
  "trialing",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS_VALUES)[number];
/**
 * Filter chips for the Orbit subscriptions table. `past_due` is a
 * meta-filter that also includes `unpaid` — both are "needs attention".
 */
export const SUBSCRIPTION_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "past_due", label: "Past due" },
  { value: "canceled", label: "Canceled" },
  { value: "trialing", label: "Trialing" },
] as const;
export function subscriptionStatusVariant(status: string | null): BadgeVariant {
  if (!status) {
    return "outline";
  }
  if (status === "active") {
    return "default";
  }
  if (status === "past_due" || status === "unpaid") {
    return "destructive";
  }
  if (status === "trialing") {
    return "secondary";
  }
  return "outline";
}

// ─── Server status ─────────────────────────────────────────────────────────
export type ServerStatus = (typeof serverStatus.enumValues)[number];
export const SERVER_STATUS_CLASSES: Record<ServerStatus, string> = {
  active: "bg-green-500/10 text-green-600 dark:text-green-400",
  inactive: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
  draining: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  offline: "bg-red-500/10 text-red-600 dark:text-red-400",
  provisioning: "bg-blue-500/10 text-blue-600 dark:text-blue-400 animate-pulse",
};

// ─── Server setup phase ────────────────────────────────────────────────────
export type SetupPhase = (typeof serverSetupPhase.enumValues)[number];
export type RestorablePhase = Exclude<SetupPhase, "ready">;
export const SETUP_PHASE_CONFIG: Record<
  SetupPhase,
  { label: string; description?: string }
> = {
  bootstrap: {
    label: "Bootstrap & Harden SSH",
    description:
      "Connect with initial credentials, push platform key, harden sshd to port 2822, disable password auth.",
  },
  install: {
    label: "Install Stack",
    description:
      "Install Firecracker, Caddy, vhost_vsock module, krova-vsock-exec helper, set hostname (FQDN), create the Krova directory layout.",
  },
  pull_images: {
    label: "Pull Images",
    description:
      "SFTP kernel + rootfs images from the Dokploy host into /var/lib/krova/images/, verify sha256, decompress.",
  },
  network: {
    label: "Network Setup",
    description:
      "Configure the br0 bridge, IP forwarding, iptables NAT + forward rules, persist across reboots.",
  },
  reboot: {
    label: "Reboot",
    description:
      "Reboot the host once so boot-time settings (kvm nx_huge_pages, KSM-off, bridge/iptables/Caddy persistence) take effect, then wait for it to return — proving the config survives a real boot. Refuses to run if the server has any cube.",
  },
  verify: {
    label: "Verify",
    description:
      "Run readiness checks against the post-reboot host (Firecracker, /dev/kvm, br0, Caddy, vhost_vsock, krova-vsock-exec, kernel + rootfs images, IP forwarding, KSM-off, disk space). On success the server becomes ready — you then activate it manually.",
  },
  ready: { label: "Ready" },
};
/** Phases in order, excluding the terminal "ready". Derived from the pgEnum. */
export const SETUP_PHASE_ORDER = serverSetupPhase.enumValues.filter(
  (p): p is RestorablePhase => p !== "ready"
);

// ─── Billing event type ────────────────────────────────────────────────────
export type BillingEventType = (typeof billingEventType.enumValues)[number];
export const BILLING_EVENT_TYPE_CLASSES: Record<BillingEventType, string> = {
  hourly_charge: "bg-red-500/10 text-red-600 dark:text-red-400",
  prorated_charge: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  credit_grant: "bg-green-500/10 text-green-600 dark:text-green-400",
  credit_topup: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  backup_storage_charge:
    "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  sleep_storage_charge: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  credit_refund: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  plan_credit: "bg-green-500/10 text-green-600 dark:text-green-400",
  overage_charge: "bg-red-500/10 text-red-600 dark:text-red-400",
};

// ─── Generic resource status (cross-entity) ────────────────────────────────
// Used by ResourceStatusBadge + TcpMappingCard for status strings that
// cross multiple entity types (snapshots, backups, tcp mappings, etc.).
// Adding a new generic status value: add a row here, both consumers
// pick it up automatically.
export const RESOURCE_STATUS_CLASSES: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  creating: "bg-blue-500/10 text-blue-600 dark:text-blue-400 animate-pulse",
  active: "bg-green-500/10 text-green-600 dark:text-green-400",
  complete: "bg-green-500/10 text-green-600 dark:text-green-400",
  restoring: "bg-blue-500/10 text-blue-600 dark:text-blue-400 animate-pulse",
  stopping: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  removing: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  disabled: "bg-muted text-muted-foreground",
  failed: "bg-red-500/10 text-red-600 dark:text-red-400",
  error: "bg-red-500/10 text-red-600 dark:text-red-400",
};
