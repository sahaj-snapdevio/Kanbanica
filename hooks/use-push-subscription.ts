"use client";

import * as React from "react";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function registerAndSubscribe(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !VAPID_PUBLIC_KEY) {
    return false;
  }

  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const existing = await reg.pushManager.getSubscription();
    if (existing) return true;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });

    const json = sub.toJSON();
    if (!json.keys?.p256dh || !json.keys?.auth) return false;

    await fetch("/api/me/push-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        userAgent: navigator.userAgent,
      }),
    });

    return true;
  } catch {
    return false;
  }
}

export function usePushSubscription() {
  const [permission, setPermission] = React.useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = React.useState(false);
  const [supported, setSupported] = React.useState(false);

  React.useEffect(() => {
    const ok =
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      !!VAPID_PUBLIC_KEY;
    setSupported(ok);
    if (!ok) return;

    setPermission(Notification.permission);

    if (Notification.permission === "granted") {
      void registerAndSubscribe().then(setSubscribed);
    }
  }, []);

  async function enable(): Promise<boolean> {
    if (!supported) return false;
    if (Notification.permission === "denied") return false;

    let perm: NotificationPermission = Notification.permission;
    if (perm !== "granted") {
      perm = await Notification.requestPermission();
      setPermission(perm);
    }

    if (perm !== "granted") return false;

    const ok = await registerAndSubscribe();
    setSubscribed(ok);
    return ok;
  }

  async function disable(): Promise<void> {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch(`/api/me/push-subscriptions?endpoint=${encodeURIComponent(sub.endpoint)}`, {
        method: "DELETE",
      });
      await sub.unsubscribe();
    }
    setSubscribed(false);
  }

  return { supported, permission, subscribed, enable, disable };
}
