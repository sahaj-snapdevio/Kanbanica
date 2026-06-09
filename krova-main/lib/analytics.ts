"use client";

import googleTagManager from "@analytics/google-tag-manager";
import Analytics, { type AnalyticsInstance } from "analytics";

let _instance: AnalyticsInstance | null = null;

export function getOrCreateAnalytics(
  containerId: string | undefined
): AnalyticsInstance | null {
  if (_instance) {
    return _instance;
  }
  if (!containerId || typeof window === "undefined") {
    return null;
  }
  _instance = Analytics({
    app: "krova",
    plugins: [googleTagManager({ containerId })],
  });
  return _instance;
}

export function getAnalytics(): AnalyticsInstance | null {
  return _instance;
}

export function track(event: string, payload?: Record<string, unknown>): void {
  void _instance?.track(event, payload);
}

export function identify(
  userId: string,
  traits?: Record<string, unknown>
): void {
  void _instance?.identify(userId, traits);
}

export function page(payload?: Record<string, unknown>): void {
  void _instance?.page(payload);
}
