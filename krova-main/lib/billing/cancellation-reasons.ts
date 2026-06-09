/**
 * Polar's documented enum for `customer_cancellation_reason` on the
 * `SubscriptionCancel` update schema. Single source of truth — used by the
 * client cancel-dialog dropdown AND the server-action Zod validation AND the
 * Polar provider's pass-through to `subscriptions.update`.
 *
 * Per https://polar.sh/docs/api-reference/subscriptions/update
 */
export const CANCELLATION_REASON_VALUES = [
  "too_expensive",
  "missing_features",
  "switched_service",
  "unused",
  "customer_service",
  "low_quality",
  "too_complex",
  "other",
] as const;

export type CancellationReason = (typeof CANCELLATION_REASON_VALUES)[number];

/** Customer-facing labels for each reason. Stable copy — translating these
 *  later would require updating Polar dashboard analytics filters too. */
export const CANCELLATION_REASON_LABELS: Record<CancellationReason, string> = {
  too_expensive: "Too expensive",
  missing_features: "Missing features I need",
  switched_service: "Switched to another service",
  unused: "I'm not using it enough",
  customer_service: "Customer service issues",
  low_quality: "Quality issues",
  too_complex: "Too complex to use",
  other: "Other",
};

/** Form-friendly array for `<Select>` options. */
export const CANCELLATION_REASON_OPTIONS = CANCELLATION_REASON_VALUES.map(
  (value) => ({ value, label: CANCELLATION_REASON_LABELS[value] })
);
