"use client";

import { useState, useEffect } from "react";
import { CheckCircleIcon, ClockIcon, WarningIcon } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  closeSprint,
  getSprints,
  getSprintWithTasks,
  markAllSprintTasksDone,
} from "@/app/actions/sprint";

// ─── Types ────────────────────────────────────────────────────────────────────

type IncompleteStrategy = "move_to_backlog" | "move_to_next_sprint" | "leave_as_is";

interface PlannedSprint {
  id: string;
  name: string;
}

interface CloseSprintModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  spaceId: string;
  listId: string;
  sprintId: string;
  sprintName: string;
  onClosed: () => void;
}

type Step = 1 | 2;

// ─── Component ────────────────────────────────────────────────────────────────

export function CloseSprintModal({
  open,
  onOpenChange,
  workspaceId,
  spaceId,
  listId,
  sprintId,
  sprintName,
  onClosed,
}: CloseSprintModalProps) {
  const [totalTasks, setTotalTasks] = useState(0);
  const [closedTasks, setClosedTasks] = useState(0);
  const [loadingData, setLoadingData] = useState(false);

  const [step, setStep] = useState<Step>(1);
  const [strategy, setStrategy] = useState<IncompleteStrategy>("move_to_backlog");
  const [plannedSprints, setPlannedSprints] = useState<PlannedSprint[]>([]);
  const [targetSprintId, setTargetSprintId] = useState("");
  const [loadingPlanned, setLoadingPlanned] = useState(false);

  const [markingDone, setMarkingDone] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const incompleteTasks = totalTasks - closedTasks;

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setStrategy("move_to_backlog");
    setTargetSprintId("");
    setError(null);
    void loadSprintData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sprintId]);

  useEffect(() => {
    if (step === 2 && strategy === "move_to_next_sprint") {
      void loadPlannedSprints();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, strategy]);

  async function loadSprintData() {
    setLoadingData(true);
    try {
      const result = await getSprintWithTasks(workspaceId, spaceId, sprintId);
      if ("error" in result) return;
      const total = result.tasks.length;
      const closed = result.tasks.filter((t) => t.statusType === "CLOSED").length;
      setTotalTasks(total);
      setClosedTasks(closed);
    } catch {
      // non-fatal, show zeros
    } finally {
      setLoadingData(false);
    }
  }

  async function loadPlannedSprints() {
    setLoadingPlanned(true);
    try {
      const result = await getSprints(workspaceId, spaceId, listId);
      if ("error" in result) return;
      const planned = result.sprints
        .filter((s) => s.status === "PLANNED")
        .map((s) => ({ id: s.id, name: s.name }));
      setPlannedSprints(planned);
      if (planned.length > 0 && !targetSprintId) {
        setTargetSprintId(planned[0].id);
      }
    } catch {
      // non-fatal
    } finally {
      setLoadingPlanned(false);
    }
  }

  async function handleMarkAllDone() {
    setMarkingDone(true);
    setError(null);
    try {
      const result = await markAllSprintTasksDone(
        workspaceId,
        spaceId,
        listId,
        sprintId,
      );
      if ("error" in result) {
        setError(result.error);
        return;
      }
      await loadSprintData();
    } catch {
      setError("Failed to mark tasks as done. Please try again.");
    } finally {
      setMarkingDone(false);
    }
  }

  function handleContinue() {
    if (incompleteTasks === 0) {
      void handleClose("move_to_backlog");
    } else {
      setStep(2);
    }
  }

  async function handleClose(overrideStrategy?: IncompleteStrategy) {
    const finalStrategy = overrideStrategy ?? strategy;
    const finalTarget =
      finalStrategy === "move_to_next_sprint" ? targetSprintId : undefined;

    if (finalStrategy === "move_to_next_sprint" && !finalTarget) {
      setError("Please select a planned sprint to move tasks into.");
      return;
    }

    setClosing(true);
    setError(null);
    try {
      const result = await closeSprint(
        workspaceId,
        spaceId,
        listId,
        sprintId,
        finalStrategy,
        finalTarget,
      );
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onClosed();
      onOpenChange(false);
    } catch {
      setError("Failed to close sprint. Please try again.");
    } finally {
      setClosing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-115">
        <DialogHeader>
          <DialogTitle className="text-base">
            Close Sprint —{" "}
            <span className="text-muted-foreground font-normal">{sprintName}</span>
          </DialogTitle>
        </DialogHeader>

        {/* ── Step 1: Summary ─────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-5 py-1">
            {loadingData ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <>
                {/* Task summary */}
                <div className="rounded-lg border bg-card p-4 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <CheckCircleIcon
                      className="size-4 text-green-500 shrink-0"
                      weight="fill"
                    />
                    <span className="text-sm">
                      <span className="font-semibold">{closedTasks}</span>{" "}
                      {closedTasks === 1 ? "task" : "tasks"} completed
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <ClockIcon
                      className="size-4 text-amber-500 shrink-0"
                      weight="fill"
                    />
                    <span className="text-sm">
                      <span className="font-semibold">{incompleteTasks}</span>{" "}
                      {incompleteTasks === 1 ? "task" : "tasks"} still incomplete
                    </span>
                  </div>
                </div>

                {/* Mark all done shortcut */}
                {incompleteTasks > 0 && (
                  <div className="rounded-md bg-muted/50 p-3 space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Want to wrap up cleanly? Mark all incomplete tasks as done
                      before closing.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleMarkAllDone}
                      disabled={markingDone}
                      className="w-full"
                    >
                      {markingDone
                        ? "Marking…"
                        : `Mark all ${incompleteTasks} incomplete ${incompleteTasks === 1 ? "task" : "tasks"} as Done`}
                    </Button>
                  </div>
                )}

                {error && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}
              </>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loadingData || markingDone}
              >
                Cancel
              </Button>
              <Button
                onClick={handleContinue}
                disabled={loadingData || markingDone}
              >
                {incompleteTasks === 0 ? "Close Sprint" : "Continue"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── Step 2: Incomplete task strategy ────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-5 py-1">
            <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2.5">
              <WarningIcon
                className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                weight="fill"
              />
              <p className="text-sm text-amber-800 dark:text-amber-300">
                <span className="font-semibold">{incompleteTasks}</span>{" "}
                incomplete{" "}
                {incompleteTasks === 1 ? "task remains" : "tasks remain"}. Choose
                what to do with them.
              </p>
            </div>

            <div className="space-y-2">
              <Label>What should happen to incomplete tasks?</Label>
              <RadioGroup
                value={strategy}
                onValueChange={(v) => {
                  setStrategy(v as IncompleteStrategy);
                  setError(null);
                }}
                className="space-y-2 mt-2"
              >
                {/* Move to Backlog */}
                <label
                  htmlFor="strat-backlog"
                  className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-accent/50 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem
                    value="move_to_backlog"
                    id="strat-backlog"
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">Move to Backlog</p>
                    <p className="text-xs text-muted-foreground">
                      Tasks are removed from the sprint and returned to the list
                      backlog
                    </p>
                  </div>
                </label>

                {/* Move to Next Sprint */}
                <label
                  htmlFor="strat-next"
                  className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-accent/50 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem
                    value="move_to_next_sprint"
                    id="strat-next"
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Move to Next Sprint</p>
                    <p className="text-xs text-muted-foreground">
                      Tasks are carried over to a planned sprint
                    </p>
                    {strategy === "move_to_next_sprint" && (
                      <div className="mt-2">
                        {loadingPlanned ? (
                          <div className="h-8 w-full rounded-md bg-muted animate-pulse" />
                        ) : plannedSprints.length === 0 ? (
                          <p className="text-xs text-destructive">
                            No planned sprint available — create one first
                          </p>
                        ) : (
                          <Select
                            value={targetSprintId}
                            onValueChange={setTargetSprintId}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Select a sprint…" />
                            </SelectTrigger>
                            <SelectContent>
                              {plannedSprints.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    )}
                  </div>
                </label>

                {/* Leave as-is */}
                <label
                  htmlFor="strat-leave"
                  className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-accent/50 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem
                    value="leave_as_is"
                    id="strat-leave"
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">Leave as-is</p>
                    <p className="text-xs text-muted-foreground">
                      Tasks remain in the closed sprint for reference in sprint
                      history
                    </p>
                  </div>
                </label>
              </RadioGroup>
            </div>

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                disabled={closing}
              >
                Back
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleClose()}
                disabled={
                  closing ||
                  (strategy === "move_to_next_sprint" &&
                    (plannedSprints.length === 0 || !targetSprintId))
                }
              >
                {closing ? "Closing…" : "Close Sprint"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
