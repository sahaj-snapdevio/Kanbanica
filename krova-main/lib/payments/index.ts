/**
 * The active payment provider. Today there is one (Polar); swapping the
 * gateway means adding another `PaymentProvider` implementation and changing
 * only this selector.
 */
import { polarProvider } from "@/lib/payments/polar/provider";
import type { PaymentProvider } from "@/lib/payments/types";

export function getPaymentProvider(): PaymentProvider {
  return polarProvider;
}

export type {
  ChangeSubscriptionResult,
  CheckoutResult,
  MeterReportResult,
  MeterUsageEvent,
  NormalizedPaymentEvent,
  NormalizedTopupEvent,
  PaymentProvider,
  SubscriptionCheckoutInput,
  SubscriptionState,
  TopupCheckoutInput,
  TopupCheckoutResult,
} from "@/lib/payments/types";
