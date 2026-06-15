"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircleIcon, CircleIcon } from "@phosphor-icons/react";
import { dismissGettingStarted } from "@/server/onboarding";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export interface ChecklistProgress {
  stepWorkspace: boolean;
  stepSpace: boolean;
  stepFirstTask: boolean;
  stepInvite: boolean;
  stepDueDate: boolean;
  stepBoardView: boolean;
}

interface GettingStartedChecklistProps {
  firstName: string;
  workspaceId: string;
  progress: ChecklistProgress;
}

export function GettingStartedChecklist({
  firstName,
  workspaceId,
  progress,
}: GettingStartedChecklistProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

  const items = [
    { label: "Create your workspace", done: progress.stepWorkspace },
    { label: "Create your first Space", done: progress.stepSpace },
    { label: "Create your first task", done: progress.stepFirstTask, hint: "Quick-create arrives with the Task module" },
    { label: "Invite a teammate", done: progress.stepInvite, hint: "Invites arrive with the Workspace module" },
    { label: "Set a due date on a task", done: progress.stepDueDate, hint: "Due dates arrive with the Task module" },
    { label: "Try the Board view", done: progress.stepBoardView, hint: "Board view arrives with the Views module" },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const allDone = doneCount === items.length;

  // On full completion: congratulate, then fade out after 3 seconds
  useEffect(() => {
    if (!allDone) return;
    const t = setTimeout(() => setHidden(true), 3000);
    return () => clearTimeout(t);
  }, [allDone]);

  function handleDismiss() {
    setHidden(true);
    startTransition(async () => {
      await dismissGettingStarted(workspaceId);
      router.refresh();
    });
  }

  if (hidden) return null;

  if (allDone) {
    return (
      <Card className="border-primary/30 bg-primary/5 transition-opacity duration-700">
        <CardContent className="py-6 text-center">
          <p className="font-medium">You&apos;re all set! 🎉 You&apos;ve covered the basics.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-5 pb-4 space-y-4">
        <div>
          <h2 className="font-semibold">👋 Welcome to Kanbanica, {firstName}!</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Here&apos;s how to get started:</p>
        </div>

        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.label} className="flex items-center gap-2.5 text-sm">
              {item.done ? (
                <CheckCircleIcon className="size-4.5 shrink-0 text-primary" weight="fill" />
              ) : (
                <CircleIcon className="size-4.5 shrink-0 text-muted-foreground/50" />
              )}
              <span className={cn(item.done && "text-muted-foreground line-through")}>
                {item.label}
              </span>
              {!item.done && item.hint && (
                <span className="ml-auto text-xs text-muted-foreground/70 hidden sm:inline">
                  {item.hint}
                </span>
              )}
            </li>
          ))}
        </ul>

        <div className="space-y-1.5">
          <Progress value={(doneCount / items.length) * 100} className="h-1.5" />
          <p className="text-xs text-muted-foreground tabular-nums">
            {doneCount} of {items.length} complete
          </p>
        </div>

        <div className="text-right">
          <button
            onClick={handleDismiss}
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
          >
            Dismiss checklist
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
