/**
 * Cookie-consent + Google Consent Mode v2 wiring for Google Tag Manager.
 *
 * Google's Consent Mode v2 requires the default consent state to be set BEFORE
 * the GTM container loads (load order is mandatory). That default lives as an
 * inline `beforeInteractive` script in app/layout.tsx and defaults every signal
 * to `denied`, reading any prior choice from localStorage so returning visitors
 * are honored without a flash.
 *
 * This module is the client-side counterpart used by the banner: it persists
 * the visitor's choice, pushes the Consent Mode `update` into the same
 * `window.dataLayer` GTM reads, and exposes a tiny external store so the banner
 * (and a "Cookie settings" re-open control) stay in sync via
 * `useSyncExternalStore` — no setState-in-effect.
 *
 * Verified against Google Consent Mode v2
 * (developers.google.com/tag-platform/security/guides/consent): signals are
 * `ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`.
 */

export const CONSENT_STORAGE_KEY = "krova-cookie-consent";

/** Re-open the banner from anywhere (e.g. a footer "Cookie settings" link). */
export const OPEN_CONSENT_EVENT = "krova:open-consent";

export type ConsentValue = "granted" | "denied";

/** The four Google Consent Mode v2 signals we manage. */
export interface ConsentState {
  ad_personalization: ConsentValue;
  ad_storage: ConsentValue;
  ad_user_data: ConsentValue;
  analytics_storage: ConsentValue;
}

export const CONSENT_GRANTED: ConsentState = {
  ad_storage: "granted",
  ad_user_data: "granted",
  ad_personalization: "granted",
  analytics_storage: "granted",
};

export const CONSENT_DENIED: ConsentState = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
};

export function readStoredConsent(): ConsentState | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    if (
      parsed.analytics_storage === "granted" ||
      parsed.analytics_storage === "denied"
    ) {
      return {
        ad_storage: parsed.ad_storage === "granted" ? "granted" : "denied",
        ad_user_data: parsed.ad_user_data === "granted" ? "granted" : "denied",
        ad_personalization:
          parsed.ad_personalization === "granted" ? "granted" : "denied",
        analytics_storage: parsed.analytics_storage,
      };
    }
  } catch {
    // Malformed storage — treat as "no choice yet".
  }
  return null;
}

// ── External store for banner visibility (useSyncExternalStore) ──────────
let forceOpen = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function handleOpenEvent() {
  forceOpen = true;
  emit();
}

export function subscribeConsent(onChange: () => void): () => void {
  listeners.add(onChange);
  if (typeof window !== "undefined") {
    window.addEventListener(OPEN_CONSENT_EVENT, handleOpenEvent);
  }
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") {
      window.removeEventListener(OPEN_CONSENT_EVENT, handleOpenEvent);
    }
  };
}

/** Banner is visible when forced open OR when no choice has been stored yet. */
export function consentSnapshot(): boolean {
  return forceOpen || readStoredConsent() === null;
}

/** SSR snapshot — always hidden so the banner is client-only (no hydration flash). */
export function consentServerSnapshot(): boolean {
  return false;
}

/** Persist the choice and push the Consent Mode `update` into dataLayer. */
export function saveConsent(state: ConsentState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode etc.) — still push the update below.
  }
  // `window.gtag` is defined by the beforeInteractive consent-default script,
  // which only renders when GTM is configured — the same condition under which
  // this banner renders, so it is present whenever a choice can be made.
  const w = window as unknown as {
    gtag?: (command: "consent", action: "update", params: ConsentState) => void;
  };
  w.gtag?.("consent", "update", state);
  forceOpen = false;
  emit();
}

/** Imperatively open the banner (used by the "Cookie settings" control). */
export function openConsentBanner(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OPEN_CONSENT_EVENT));
  }
}
