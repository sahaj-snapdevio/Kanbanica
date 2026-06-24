"use client";

import { useState, useEffect } from "react";
import { GearIcon, LightningIcon } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { getSprintSettings, saveSprintSettings, type SprintSettings } from "@/app/actions/sprint";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SprintSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  spaceId: string;
  spaceName?: string;
  /** Called after settings are saved — proceed to create-sprint if desired */
  onSaved: (settings: SprintSettings) => void;
  /** If true, shows "First time setup" heading */
  isFirstTime?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const NAME_FORMATS = [
  { value: "Sprint {n}", label: "Sprint {n}" },
  { value: "Week {n}", label: "Week {n}" },
  { value: "Iteration {n}", label: "Iteration {n}" },
  { value: "{project} Sprint {n}", label: "{project} Sprint {n}" },
];

const DATE_FORMATS = [
  { value: "MM/DD", label: "MM/DD", example: "06/22" },
  { value: "DD/MM", label: "DD/MM", example: "22/06" },
  { value: "MM/DD/YY", label: "MM/DD/YY", example: "06/22/25" },
  { value: "DD/MM/YY", label: "DD/MM/YY", example: "22/06/25" },
  { value: "YYYY/MM/DD", label: "YYYY/MM/DD", example: "2025/06/22" },
];

function previewName(format: string, n: number, projectName: string): string {
  return format.replace("{n}", String(n)).replace("{project}", projectName || "Project");
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SprintSettingsModal({
  open,
  onOpenChange,
  workspaceId,
  spaceId,
  spaceName = "Project",
  onSaved,
  isFirstTime = false,
}: SprintSettingsModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Settings state
  const [startDay, setStartDay] = useState<number>(1); // Monday default
  const [durationWeeks, setDurationWeeks] = useState<number>(2);
  const [nameFormat, setNameFormat] = useState<string>("Sprint {n}");
  const [dateFormat, setDateFormat] = useState<string>("MM/DD");
  const [autoMarkDone, setAutoMarkDone] = useState(false);
  const [autoCreateNext, setAutoCreateNext] = useState(false);
  const [autoMoveIncomplete, setAutoMoveIncomplete] = useState(false);
  const [autoArchiveAfterN, setAutoArchiveAfterN] = useState<number | null>(null);
  const [archiveEnabled, setArchiveEnabled] = useState(false);

  // Load existing settings
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    getSprintSettings(workspaceId, spaceId).then((result) => {
      setLoading(false);
      if ("error" in result) return;
      setStartDay(result.sprintStartDay ?? 1);
      setDurationWeeks(result.sprintDefaultDurationWeeks);
      setNameFormat(result.sprintNameFormat);
      setDateFormat(result.sprintDateFormat);
      setAutoMarkDone(result.sprintAutoMarkDone);
      setAutoCreateNext(result.sprintAutoCreateNext);
      setAutoMoveIncomplete(result.sprintAutoMoveIncomplete);
      const n = result.sprintAutoArchiveAfterN;
      setArchiveEnabled(n !== null);
      setAutoArchiveAfterN(n ?? 3);
    });
  }, [open, workspaceId, spaceId]);

  async function handleSave() {
    setSaving(true);
    setError(null);

    const settings: SprintSettings = {
      sprintStartDay: startDay,
      sprintDefaultDurationWeeks: durationWeeks,
      sprintNameFormat: nameFormat,
      sprintDateFormat: dateFormat,
      sprintAutoMarkDone: autoMarkDone,
      sprintAutoCreateNext: autoCreateNext,
      sprintAutoMoveIncomplete: autoCreateNext ? autoMoveIncomplete : false,
      sprintAutoArchiveAfterN: archiveEnabled ? (autoArchiveAfterN ?? 3) : null,
    };

    const result = await saveSprintSettings(workspaceId, spaceId, settings);
    setSaving(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    onSaved(settings);
    onOpenChange(false);
  }

  const namePreview = previewName(nameFormat, 1, spaceName);
  const namePreview2 = previewName(nameFormat, 2, spaceName);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GearIcon className="size-4 text-primary" weight="fill" />
            {isFirstTime ? "Sprint Setup" : "Sprint Settings"}
          </DialogTitle>
          {isFirstTime && (
            <p className="text-sm text-muted-foreground mt-1">
              Configure how sprints work in <span className="font-medium text-foreground">{spaceName}</span>.
              You can change these later in project settings.
            </p>
          )}
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-6 py-1">
            {/* Sprint cadence */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Schedule</h3>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <Label>Sprint starts on</Label>
                  <Select
                    value={String(startDay)}
                    onValueChange={(v) => setStartDay(Number(v))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAY_NAMES.map((day, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {day}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Default duration</Label>
                  <Select
                    value={String(durationWeeks)}
                    onValueChange={(v) => setDurationWeeks(Number(v))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 week</SelectItem>
                      <SelectItem value="2">2 weeks</SelectItem>
                      <SelectItem value="3">3 weeks</SelectItem>
                      <SelectItem value="4">4 weeks</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Naming */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Naming</h3>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <Label>Sprint name format</Label>
                  <Select value={nameFormat} onValueChange={setNameFormat}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NAME_FORMATS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Date format</Label>
                  <Select value={dateFormat} onValueChange={setDateFormat}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_FORMATS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          <span>{f.label}</span>
                          <span className="ml-2 text-muted-foreground text-xs">{f.example}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Name preview:{" "}
                <span className="font-medium text-foreground">{namePreview}</span>
                {", "}
                <span className="font-medium text-foreground">{namePreview2}</span>
                {", …"}
              </p>
            </div>

            {/* Automations */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Automations</h3>

              <div className="space-y-3 rounded-md border border-border p-3">
                {/* Auto-mark done */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Auto-mark sprint as done</p>
                    <p className="text-xs text-muted-foreground">
                      Automatically close the sprint when its end date passes
                    </p>
                  </div>
                  <Switch checked={autoMarkDone} onCheckedChange={setAutoMarkDone} />
                </div>

                <div className="h-px bg-border" />

                {/* Auto-create next */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Auto-create next sprint</p>
                    <p className="text-xs text-muted-foreground">
                      When a sprint is completed, automatically create the next one
                    </p>
                  </div>
                  <Switch
                    checked={autoCreateNext}
                    onCheckedChange={(v) => {
                      setAutoCreateNext(v);
                      if (!v) setAutoMoveIncomplete(false);
                    }}
                  />
                </div>

                {/* Auto-move incomplete */}
                {autoCreateNext && (
                  <div className="ml-4 flex items-start justify-between gap-3 border-l-2 border-border pl-4">
                    <div>
                      <p className="text-sm font-medium">Move incomplete tasks to next sprint</p>
                      <p className="text-xs text-muted-foreground">
                        Unfinished tasks carry over automatically
                      </p>
                    </div>
                    <Switch checked={autoMoveIncomplete} onCheckedChange={setAutoMoveIncomplete} />
                  </div>
                )}

                <div className="h-px bg-border" />

                {/* Auto-archive */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Auto-archive old sprints</p>
                    <p className="text-xs text-muted-foreground">
                      Keep the sidebar clean by archiving completed sprints
                    </p>
                  </div>
                  <Switch
                    checked={archiveEnabled}
                    onCheckedChange={(v) => {
                      setArchiveEnabled(v);
                      if (v && autoArchiveAfterN === null) setAutoArchiveAfterN(3);
                    }}
                  />
                </div>

                {archiveEnabled && (
                  <div className="ml-4 flex items-center gap-2 border-l-2 border-border pl-4">
                    <p className="text-sm text-muted-foreground shrink-0">Keep last</p>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={autoArchiveAfterN ?? 3}
                      onChange={(e) => setAutoArchiveAfterN(Math.max(1, Math.min(20, Number(e.target.value))))}
                      className="w-16 h-8 text-center"
                    />
                    <p className="text-sm text-muted-foreground shrink-0">sprints visible</p>
                  </div>
                )}
              </div>
            </div>

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {!isFirstTime && (
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving…" : isFirstTime ? "Save & Continue" : "Save Settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
