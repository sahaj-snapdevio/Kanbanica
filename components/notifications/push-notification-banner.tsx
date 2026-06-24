"use client";

import { BellIcon, XIcon } from "@phosphor-icons/react";
import * as React from "react";
import { usePushSubscription } from "@/hooks/use-push-subscription";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "push_banner_dismissed";

export function PushNotificationBanner({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { supported, permission, subscribed, enable } = usePushSubscription();
  const [dismissed, setDismissed] = React.useState(true); // start hidden to avoid flash
  const [enabling, setEnabling] = React.useState(false);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const alreadyDismissed = localStorage.getItem(STORAGE_KEY) === "1";
    setDismissed(alreadyDismissed);
  }, []);

  React.useEffect(() => {
    // Show banner only if: supported, permission not decided yet, not dismissed, not subscribed
    if (supported && permission === "default" && !dismissed && !subscribed) {
      // Small delay so it doesn't flash immediately on mount
      const t = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(t);
    }
    setVisible(false);
  }, [supported, permission, dismissed, subscribed]);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1");
    setDismissed(true);
    setVisible(false);
  }

  async function handleEnable() {
    setEnabling(true);
    const ok = await enable();
    setEnabling(false);
    if (ok) {
      dismiss();
    }
  }

  if (!visible) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b bg-primary/5 px-4 py-2.5 text-sm transition-all"
      )}
    >
      <BellIcon className="size-4 shrink-0 text-primary" weight="fill" />
      <p className="flex-1 text-foreground">
        Stay updated in real time —{" "}
        <span className="text-muted-foreground">
          enable browser notifications to get alerts even when the app is in the
          background.
        </span>
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <button
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
          disabled={enabling}
          onClick={handleEnable}
        >
          {enabling ? "Enabling…" : "Enable"}
        </button>
        <button
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={dismiss}
        >
          Not now
        </button>
        <button
          aria-label="Dismiss"
          className="ml-1 flex size-6 items-center justify-center rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          onClick={dismiss}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
