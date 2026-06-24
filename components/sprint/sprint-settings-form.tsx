"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveSprintSettings, type SprintSettings } from "@/app/actions/sprint";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

interface SprintSettingsFormProps {
  workspaceId: string;
  spaceId: string;
  spaceName: string;
  initialSettings: {
    sprintStartDay: number | null;
    sprintDefaultDurationWeeks: number;
    sprintNameFormat: string;
    sprintDateFormat: string;
    sprintAutoMarkDone: boolean;
    sprintAutoCreateNext: boolean;
    sprintAutoMoveIncomplete: boolean;
    sprintAutoArchiveAfterN: number | null;
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SprintSettingsForm({
  workspaceId,
  spaceId,
  spaceName,
  initialSettings,
}: SprintSettingsFormProps) {
  const [pending, startTransition] = useTransition();

  const [startDay, setStartDay] = useState<number>(initialSettings.sprintStartDay ?? 1);
  const [durationWeeks, setDurationWeeks] = useState(initialSettings.sprintDefaultDurationWeeks);
  const [nameFormat, setNameFormat] = useState(initialSettings.sprintNameFormat);
  const [dateFormat, setDateFormat] = useState(initialSettings.sprintDateFormat);
  const [autoMarkDone, setAutoMarkDone] = useState(initialSettings.sprintAutoMarkDone);
  const [autoCreateNext, setAutoCreateNext] = useState(initialSettings.sprintAutoCreateNext);
  const [autoMoveIncomplete, setAutoMoveIncomplete] = useState(initialSettings.sprintAutoMoveIncomplete);
  const [archiveEnabled, setArchiveEnabled] = useState(initialSettings.sprintAutoArchiveAfterN !== null);
  const [autoArchiveAfterN, setAutoArchiveAfterN] = useState(initialSettings.sprintAutoArchiveAfterN ?? 3);

  const namePreview = previewName(nameFormat, 1, spaceName);
  const namePreview2 = previewName(nameFormat, 2, spaceName);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const settings: SprintSettings = {
        sprintStartDay: startDay,
        sprintDefaultDurationWeeks: durationWeeks,
        sprintNameFormat: nameFormat,
        sprintDateFormat: dateFormat,
        sprintAutoMarkDone: autoMarkDone,
        sprintAutoCreateNext: autoCreateNext,
        sprintAutoMoveIncomplete: autoCreateNext ? autoMoveIncomplete : false,
        sprintAutoArchiveAfterN: archiveEnabled ? autoArchiveAfterN : null,
      };
      const result = await saveSprintSettings(workspaceId, spaceId, settings);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Sprint settings saved.");
      }
    });
  }

  return (
    <form onSubmit={handleSave} className="space-y-8">
      {/* Schedule */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Schedule</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Control when and how long sprints run.</p>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <Label>Sprint starts on</Label>
            <Select value={String(startDay)} onValueChange={(v) => setStartDay(Number(v))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_NAMES.map((day, i) => (
                  <SelectItem key={i} value={String(i)}>{day}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Default duration</Label>
            <Select value={String(durationWeeks)} onValueChange={(v) => setDurationWeeks(Number(v))}>
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
      </section>

      <div className="h-px bg-border" />

      {/* Naming */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Naming</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Define how sprints are named and how dates display.</p>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <Label>Sprint name format</Label>
            <Select value={nameFormat} onValueChange={setNameFormat}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NAME_FORMATS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
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
      </section>

      <div className="h-px bg-border" />

      {/* Automations */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Automations</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Automate sprint lifecycle actions.</p>
        </div>

        <div className="space-y-0 divide-y divide-border rounded-md border border-border">
          {/* Auto-mark done */}
          <div className="flex items-start justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-medium">Auto-mark sprint as done</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Automatically close the sprint when its end date passes
              </p>
            </div>
            <Switch checked={autoMarkDone} onCheckedChange={setAutoMarkDone} />
          </div>

          {/* Auto-create next */}
          <div className="flex items-start justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-medium">Auto-create next sprint</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                When a sprint is completed, automatically create the next one
              </p>
            </div>
            <Switch
              checked={autoCreateNext}
              onCheckedChange={(v) => { setAutoCreateNext(v); if (!v) setAutoMoveIncomplete(false); }}
            />
          </div>

          {/* Move incomplete — sub-option */}
          {autoCreateNext && (
            <div className="flex items-start justify-between gap-4 py-3 pl-10 pr-4 bg-muted/30">
              <div>
                <p className="text-sm font-medium">Move incomplete tasks to next sprint</p>
                <p className="text-xs text-muted-foreground mt-0.5">Unfinished tasks carry over automatically</p>
              </div>
              <Switch checked={autoMoveIncomplete} onCheckedChange={setAutoMoveIncomplete} />
            </div>
          )}

          {/* Auto-archive */}
          <div className="flex items-start justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-medium">Auto-archive old sprints</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Keep the sidebar clean by archiving completed sprints
              </p>
            </div>
            <Switch
              checked={archiveEnabled}
              onCheckedChange={(v) => setArchiveEnabled(v)}
            />
          </div>

          {archiveEnabled && (
            <div className="flex items-center gap-3 py-3 pl-10 pr-4 bg-muted/30">
              <p className="text-sm text-muted-foreground shrink-0">Keep last</p>
              <Input
                type="number"
                min={1}
                max={20}
                value={autoArchiveAfterN}
                onChange={(e) => setAutoArchiveAfterN(Math.max(1, Math.min(20, Number(e.target.value))))}
                className="w-16 h-8 text-center"
              />
              <p className="text-sm text-muted-foreground shrink-0">sprints visible</p>
            </div>
          )}
        </div>
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
