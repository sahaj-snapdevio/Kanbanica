/**
 * Single source of truth for outbound webhook events.
 *
 * Lives here (not in `app/actions/outbound-webhooks.ts`) because that file is
 * a `"use server"` module — Next.js 16 strict-enforces that such files only
 * export async functions; a `const` export there throws at runtime (Rule 45).
 *
 * Adding a new event:
 *   1. Add an entry to WEBHOOK_EVENTS below with `value`, `label`, `description`, `category`.
 *   2. Add the matching payload shape comment so docs generation can pick it up.
 *   3. Fire it from the relevant handler via `dispatchWebhookEvent(spaceId, event, data)`.
 *
 * Renaming / removing an event is a breaking change for any customer subscribed
 * to it. Don't do it without an explicit deprecation plan.
 */

export type WebhookEventCategory =
  | "cube"
  | "snapshot"
  | "backup"
  | "domain"
  | "tcp_mapping"
  | "member"
  | "subscription";

export interface WebhookEventDefinition {
  category: WebhookEventCategory;
  description: string;
  label: string;
  value: string;
}

export const WEBHOOK_EVENTS = [
  // --- Cube lifecycle ----------------------------------------------------
  {
    value: "cube.created",
    label: "Cube created",
    description: "A new Cube row was created (before boot completes).",
    category: "cube",
  },
  {
    value: "cube.running",
    label: "Cube running",
    description:
      "Cube transitioned to running (boot complete, wake, restore, transfer, auto-relaunch, or state-sync reconciliation).",
    category: "cube",
  },
  {
    value: "cube.sleeping",
    label: "Cube sleeping",
    description:
      "Cube transitioned to sleeping (customer sleep, zero-balance auto-sleep, or unexpected pause detected by state-sync).",
    category: "cube",
  },
  {
    value: "cube.error",
    label: "Cube error",
    description:
      "Cube transitioned to error (boot failure, auto-relaunch rate limit, or unexpected shutdown after boot).",
    category: "cube",
  },
  {
    value: "cube.deleted",
    label: "Cube deleted",
    description: "Cube was fully deleted.",
    category: "cube",
  },
  {
    value: "cube.cold_restarted",
    label: "Cube cold-restarted",
    description:
      "Cube was cold-restarted (full power-cycle from the dashboard).",
    category: "cube",
  },
  {
    value: "cube.transfer.started",
    label: "Cube transfer started",
    description:
      "Admin-initiated cube transfer began moving the cube to a new server.",
    category: "cube",
  },
  {
    value: "cube.transfer.completed",
    label: "Cube transfer completed",
    description:
      "Cube transfer finished successfully on the destination server.",
    category: "cube",
  },
  {
    value: "cube.transfer.failed",
    label: "Cube transfer failed",
    description: "Cube transfer aborted before reaching the destination.",
    category: "cube",
  },
  {
    value: "cube.resize.started",
    label: "Cube resize started",
    description: "A cube resize operation began (vCPU / RAM / disk).",
    category: "cube",
  },
  {
    value: "cube.resize.completed",
    label: "Cube resize completed",
    description: "Cube resize finished and the new resources are live.",
    category: "cube",
  },
  {
    value: "cube.resize.failed",
    label: "Cube resize failed",
    description:
      "Cube resize failed and the cube was rolled back to its prior shape.",
    category: "cube",
  },

  // --- Snapshots ---------------------------------------------------------
  {
    value: "snapshot.created",
    label: "Snapshot created",
    description:
      "A snapshot finished uploading and is available for restore / clone / promote.",
    category: "snapshot",
  },
  {
    value: "snapshot.restored",
    label: "Snapshot restored",
    description: "Cube rootfs was overwritten from a snapshot.",
    category: "snapshot",
  },
  {
    value: "snapshot.deleted",
    label: "Snapshot deleted",
    description: "Snapshot was deleted (customer-initiated or auto-pruned).",
    category: "snapshot",
  },
  {
    value: "snapshot.pinned",
    label: "Snapshot pinned",
    description:
      "An auto snapshot was promoted to manual (consumes a manual slot, survives auto-prune).",
    category: "snapshot",
  },
  {
    value: "snapshot.promoted_to_backup",
    label: "Snapshot promoted to backup",
    description:
      "A snapshot was promoted to a portable .cube backup that can be redeployed.",
    category: "snapshot",
  },
  {
    value: "snapshot.exported",
    label: "Snapshot exported",
    description:
      "A snapshot export (.cube archive download link) is ready and the link was emailed.",
    category: "snapshot",
  },

  // --- Backups -----------------------------------------------------------
  {
    value: "backup.created",
    label: "Backup created",
    description:
      "A .cube backup finished uploading and is available for redeploy (pre-deletion or promote-from-snapshot).",
    category: "backup",
  },
  {
    value: "backup.deleted",
    label: "Backup deleted",
    description: "Backup .cube archive was deleted.",
    category: "backup",
  },
  {
    value: "backup.redeployed",
    label: "Backup redeployed",
    description: "Backup was redeployed into a new running Cube.",
    category: "backup",
  },

  // --- Domains -----------------------------------------------------------
  {
    value: "domain.added",
    label: "Custom domain added",
    description:
      "Customer added a custom domain — Cloudflare Custom Hostname registered.",
    category: "domain",
  },
  {
    value: "domain.active",
    label: "Custom domain active",
    description:
      "Cloudflare certified the custom domain and routing went live.",
    category: "domain",
  },
  {
    value: "domain.removed",
    label: "Custom domain removed",
    description: "Customer removed a custom domain — routing torn down.",
    category: "domain",
  },

  // --- TCP port mappings -------------------------------------------------
  {
    value: "tcp_mapping.added",
    label: "TCP port mapping added",
    description: "A new public TCP port was forwarded to a cube guest port.",
    category: "tcp_mapping",
  },
  {
    value: "tcp_mapping.removed",
    label: "TCP port mapping removed",
    description: "A TCP port mapping was deleted.",
    category: "tcp_mapping",
  },
  {
    value: "tcp_mapping.updated",
    label: "TCP port mapping updated",
    description:
      "A TCP port mapping was modified (whitelist, exposure, or SSH guest port).",
    category: "tcp_mapping",
  },

  // --- Members -----------------------------------------------------------
  {
    value: "member.invited",
    label: "Member invited",
    description: "A user was invited to the space.",
    category: "member",
  },
  {
    value: "member.joined",
    label: "Member joined",
    description: "An invite was accepted and the user joined the space.",
    category: "member",
  },
  {
    value: "member.removed",
    label: "Member removed",
    description: "A member was removed from the space (or left).",
    category: "member",
  },
  {
    value: "member.role_changed",
    label: "Member role changed",
    description: "A member's role or permissions changed.",
    category: "member",
  },

  // --- Subscriptions -----------------------------------------------------
  {
    value: "subscription.activated",
    label: "Subscription activated",
    description: "A paid plan subscription was activated for the space.",
    category: "subscription",
  },
  {
    value: "subscription.renewed",
    label: "Subscription renewed",
    description:
      "A subscription's billing period rolled over and the next period's plan credit was granted.",
    category: "subscription",
  },
  {
    value: "subscription.canceled",
    label: "Subscription canceled",
    description:
      "Subscription was fully canceled (period ended). The space was dropped to the default plan.",
    category: "subscription",
  },
  {
    value: "subscription.past_due",
    label: "Subscription past due",
    description:
      "Subscription went past due — the customer's renewal charge failed; service continues until cancellation.",
    category: "subscription",
  },
  {
    value: "subscription.resumed",
    label: "Subscription resumed",
    description:
      "A scheduled cancellation was undone (cancel_at_period_end flipped back to false).",
    category: "subscription",
  },
] as const satisfies readonly WebhookEventDefinition[];

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]["value"];

/**
 * Tuple of just the event values, in the shape `z.enum()` requires
 * (`[string, ...string[]]`). Derived once at module load.
 */
export const WEBHOOK_EVENT_VALUES = WEBHOOK_EVENTS.map((e) => e.value) as [
  WebhookEvent,
  ...WebhookEvent[],
];

const eventByValue = new Map<string, WebhookEventDefinition>(
  WEBHOOK_EVENTS.map((e) => [e.value, e])
);

export function isValidWebhookEvent(value: string): value is WebhookEvent {
  return eventByValue.has(value);
}

export function getWebhookEventDefinition(
  value: string
): WebhookEventDefinition | undefined {
  return eventByValue.get(value);
}

export const WEBHOOK_EVENT_CATEGORIES: ReadonlyArray<{
  category: WebhookEventCategory;
  label: string;
}> = [
  { category: "cube", label: "Cube lifecycle" },
  { category: "snapshot", label: "Snapshots" },
  { category: "backup", label: "Backups" },
  { category: "domain", label: "Custom domains" },
  { category: "tcp_mapping", label: "TCP port mappings" },
  { category: "member", label: "Team members" },
  { category: "subscription", label: "Subscriptions" },
];

export function groupedWebhookEvents(): ReadonlyArray<{
  category: WebhookEventCategory;
  label: string;
  events: ReadonlyArray<WebhookEventDefinition>;
}> {
  return WEBHOOK_EVENT_CATEGORIES.map(({ category, label }) => ({
    category,
    label,
    events: WEBHOOK_EVENTS.filter((e) => e.category === category),
  }));
}
