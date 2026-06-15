"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowRightIcon, BuildingsIcon, StackIcon } from "@phosphor-icons/react";
import { createOnboardingWorkspace, createOnboardingSpace } from "@/server/onboarding";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const LOGO_EMOJIS = ["🚀", "🏢", "⭐", "🎯", "💼", "🔥", "🛠️", "📈", "🎨", "🌱"];

const SPACE_COLORS = [
  "#6366F1", // indigo
  "#3B82F6", // blue
  "#06B6D4", // cyan
  "#22C55E", // green
  "#EAB308", // yellow
  "#F97316", // orange
  "#EF4444", // red
  "#EC4899", // pink
  "#8B5CF6", // violet
];

interface OnboardingWizardProps {
  existingWorkspace: { id: string; name: string } | null;
}

export function OnboardingWizard({ existingWorkspace }: OnboardingWizardProps) {
  const [workspace, setWorkspace] = useState(existingWorkspace);
  const [pending, startTransition] = useTransition();

  // Step 1 state
  const [workspaceName, setWorkspaceName] = useState("");
  const [logoEmoji, setLogoEmoji] = useState<string | null>(null);

  // Step 2 state
  const [spaceName, setSpaceName] = useState("");
  const [spaceColor, setSpaceColor] = useState(SPACE_COLORS[0]);

  function handleCreateWorkspace(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createOnboardingWorkspace({ name: workspaceName, logoEmoji });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setWorkspace({ id: result.workspaceId, name: workspaceName.trim() });
    });
  }

  function handleCreateSpace(e: React.FormEvent) {
    e.preventDefault();
    if (!workspace) return;
    startTransition(async () => {
      // Redirects to the new List on success — only returns on error
      const result = await createOnboardingSpace({
        workspaceId: workspace.id,
        name: spaceName,
        color: spaceColor,
      });
      if (result && "error" in result) toast.error(result.error);
    });
  }

  // ── Step 1 — Create Workspace ────────────────────────────────────────────
  if (!workspace) {
    return (
      <Card>
        <CardHeader>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mb-2">
            <BuildingsIcon className="size-5 text-primary" weight="duotone" />
          </div>
          <CardTitle className="text-xl">Create your Workspace</CardTitle>
          <CardDescription>
            Your Workspace is your company or team&apos;s home. Everything your team works on
            lives here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateWorkspace} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input
                id="workspace-name"
                placeholder="e.g. Acme Inc"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                maxLength={100}
                autoFocus
                required
              />
            </div>

            <div className="space-y-2">
              <Label>
                Logo <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {LOGO_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-pressed={logoEmoji === emoji}
                    onClick={() => setLogoEmoji(logoEmoji === emoji ? null : emoji)}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition-colors hover:bg-accent",
                      logoEmoji === emoji && "border-primary bg-primary/10",
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            <Button type="submit" className="w-full gap-2" disabled={pending || !workspaceName.trim()}>
              {pending ? <Spinner className="size-4" /> : <ArrowRightIcon className="size-4" />}
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  // ── Step 2 — Create first Space ──────────────────────────────────────────
  return (
    <Card>
      <CardHeader>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mb-2">
          <StackIcon className="size-5 text-primary" weight="duotone" />
        </div>
        <CardTitle className="text-xl">Create your first Space</CardTitle>
        <CardDescription>
          A Space is where your team&apos;s work lives — like a department or project area. You
          can create more later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Hierarchy diagram (docs/development-plan.md Phase 4) */}
        <div className="rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
          <p className="font-medium text-muted-foreground mb-1.5">How Kanbanica is organized:</p>
          <p className="flex flex-wrap items-center gap-1 font-medium">
            Workspace <ArrowRightIcon className="size-3 text-muted-foreground" />
            Space <ArrowRightIcon className="size-3 text-muted-foreground" />
            List <ArrowRightIcon className="size-3 text-muted-foreground" />
            Task
          </p>
          <p className="flex flex-wrap items-center gap-1 text-muted-foreground mt-0.5">
            <span className="truncate max-w-28">{workspace.name}</span>
            <ArrowRightIcon className="size-3" />
            Engineering <ArrowRightIcon className="size-3" />
            Backlog <ArrowRightIcon className="size-3" />
            Fix login bug
          </p>
        </div>

        <form onSubmit={handleCreateSpace} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="space-name">Space name</Label>
            <Input
              id="space-name"
              placeholder="e.g. Engineering"
              value={spaceName}
              onChange={(e) => setSpaceName(e.target.value)}
              maxLength={100}
              autoFocus
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {SPACE_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Color ${color}`}
                  aria-pressed={spaceColor === color}
                  onClick={() => setSpaceColor(color)}
                  className={cn(
                    "h-7 w-7 rounded-full transition-transform hover:scale-110",
                    spaceColor === color && "ring-2 ring-offset-2 ring-ring scale-110",
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <Button type="submit" className="w-full gap-2" disabled={pending || !spaceName.trim()}>
            {pending ? <Spinner className="size-4" /> : <ArrowRightIcon className="size-4" />}
            Create Space &amp; get started
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
