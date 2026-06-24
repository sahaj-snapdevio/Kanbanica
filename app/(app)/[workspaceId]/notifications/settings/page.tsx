"use client";

import * as React from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { usePushSubscription } from "@/hooks/use-push-subscription";

const TRIGGER_LABELS: Record<string, string> = {
  task_assigned: "Task assigned to me",
  task_unassigned: "Task unassigned from me",
  task_status_changed: "Task status changed",
  task_priority_changed: "Task priority changed",
  task_due_date_changed: "Task due date changed",
  task_completed: "Task marked complete",
  task_moved: "Task moved",
  task_deleted: "Task deleted",
  comment_added: "New comment",
  comment_reply: "Reply to my comment",
  mention_comment: "Mentioned in comment",
  mention_description: "Mentioned in description",
  comment_resolved: "Comment resolved",
  due_date_reminder_1day: "Due date reminder (1 day)",
  due_date_today: "Due today",
  task_overdue: "Task overdue",
  workspace_invited: "Invited to workspace",
  invite_accepted: "Invite accepted",
  space_added: "Added to project",
  space_removed: "Removed from project",
  role_changed: "Role changed",
  space_permission_changed: "Project permission changed",
  sprint_started: "Sprint started",
  sprint_ending_soon: "Sprint ending soon",
  sprint_closed: "Sprint closed",
  sprint_auto_created: "Sprint auto-created",
};

interface NotifPref {
  emailEnabled: boolean;
  inAppEnabled: boolean;
  pushEnabled: boolean;
  triggerType: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function NotificationSettingsPage() {
  const { data: emailPrefData, mutate: mutateEmail } = useSWR(
    "/api/me/email-preferences",
    fetcher
  );
  const { data: notifPrefData, mutate: mutateNotif } = useSWR(
    "/api/me/notification-preferences",
    fetcher
  );

  const [deliveryMode, setDeliveryMode] = React.useState<string>("instant");
  const [digestTime, setDigestTime] = React.useState<string>("08:00");
  const [prefs, setPrefs] = React.useState<NotifPref[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [pushEnabling, setPushEnabling] = React.useState(false);
  const {
    supported: pushSupported,
    permission,
    subscribed,
    enable: enablePush,
    disable: disablePush,
  } = usePushSubscription();

  React.useEffect(() => {
    if (emailPrefData?.preference) {
      setDeliveryMode(emailPrefData.preference.deliveryMode ?? "instant");
      setDigestTime(emailPrefData.preference.digestTime ?? "08:00");
    }
  }, [emailPrefData]);

  React.useEffect(() => {
    if (notifPrefData?.preferences) {
      setPrefs(notifPrefData.preferences);
    }
  }, [notifPrefData]);

  async function saveEmailPrefs() {
    setSaving(true);
    try {
      await fetch("/api/me/email-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryMode, digestTime }),
      });
      await mutateEmail();
    } finally {
      setSaving(false);
    }
  }

  async function saveNotifPref(
    triggerType: string,
    field: keyof Omit<NotifPref, "triggerType">,
    value: boolean
  ) {
    const updated = prefs.map((p) =>
      p.triggerType === triggerType ? { ...p, [field]: value } : p
    );
    setPrefs(updated);

    await fetch("/api/me/notification-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preferences: [
          {
            triggerType,
            ...updated.find((p) => p.triggerType === triggerType),
          },
        ],
      }),
    });
    await mutateNotif();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <div>
        <h2 className="text-xl font-semibold">Notification Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Control how and when you receive notifications.
        </p>
      </div>

      {/* Browser push notifications */}
      {pushSupported && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-medium">Browser Notifications</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {permission === "denied"
                  ? "Notifications are blocked. Enable them in your browser settings."
                  : subscribed
                    ? "Push notifications are enabled for this browser."
                    : "Get notified in real time, even when the app is in the background."}
              </p>
            </div>
            {permission !== "denied" && (
              <Button
                disabled={pushEnabling}
                onClick={async () => {
                  setPushEnabling(true);
                  if (subscribed) {
                    await disablePush();
                  } else {
                    await enablePush();
                  }
                  setPushEnabling(false);
                }}
                size="sm"
                variant={subscribed ? "outline" : "default"}
              >
                {pushEnabling ? "…" : subscribed ? "Disable" : "Enable"}
              </Button>
            )}
          </div>
          {subscribed && (
            <p className="text-xs text-muted-foreground">
              Per-event push toggles are controlled in the table below.
            </p>
          )}
        </div>
      )}

      {/* Email delivery section */}
      <div className="space-y-4 rounded-lg border p-4">
        <h3 className="font-medium">Email Delivery</h3>
        <div className="flex items-center gap-4">
          <Label className="w-32 shrink-0" htmlFor="delivery-mode">
            Delivery mode
          </Label>
          <Select onValueChange={setDeliveryMode} value={deliveryMode}>
            <SelectTrigger className="w-40" id="delivery-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="instant">Instant</SelectItem>
              <SelectItem value="digest">Daily Digest</SelectItem>
              <SelectItem value="off">Off</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {deliveryMode === "digest" && (
          <div className="flex items-center gap-4">
            <Label className="w-32 shrink-0" htmlFor="digest-time">
              Digest time (UTC)
            </Label>
            <input
              className="rounded-md border bg-background px-3 py-1.5 text-sm"
              id="digest-time"
              onChange={(e) => setDigestTime(e.target.value)}
              type="time"
              value={digestTime}
            />
          </div>
        )}
        <Button disabled={saving} onClick={saveEmailPrefs} size="sm">
          {saving ? "Saving..." : "Save email preferences"}
        </Button>
      </div>

      {/* Per-trigger toggles */}
      <div className="space-y-4">
        <h3 className="font-medium">Notification Preferences</h3>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-2 text-left font-medium">Event</th>
                <th className="px-4 py-2 text-center font-medium">In-App</th>
                <th className="px-4 py-2 text-center font-medium">Email</th>
                <th className="px-4 py-2 text-center font-medium">Push</th>
              </tr>
            </thead>
            <tbody>
              {prefs.map((pref) => (
                <tr className="border-b last:border-0" key={pref.triggerType}>
                  <td className="px-4 py-2.5 text-sm">
                    {TRIGGER_LABELS[pref.triggerType] ?? pref.triggerType}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <Switch
                      checked={pref.inAppEnabled}
                      onCheckedChange={(v) =>
                        void saveNotifPref(pref.triggerType, "inAppEnabled", v)
                      }
                    />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <Switch
                      checked={pref.emailEnabled}
                      onCheckedChange={(v) =>
                        void saveNotifPref(pref.triggerType, "emailEnabled", v)
                      }
                    />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <Switch
                      checked={pref.pushEnabled}
                      onCheckedChange={(v) =>
                        void saveNotifPref(pref.triggerType, "pushEnabled", v)
                      }
                    />
                  </td>
                </tr>
              ))}
              {prefs.length === 0 && (
                <tr>
                  <td
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                    colSpan={4}
                  >
                    Loading preferences...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
