"use client";

import { useState, useTransition } from "react";
import {
  ArrowRightIcon,
  BuildingsIcon,
  StackIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import {
  createOnboardingWorkspace,
  createOnboardingSpace,
  saveUserName,
} from "@/app/actions/onboarding";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const LOGO_EMOJIS = [
  "🚀",
  "🏢",
  "⭐",
  "🎯",
  "💼",
  "🔥",
  "🛠️",
  "📈",
  "🎨",
  "🌱",
];

const SPACE_COLORS = [
  "#6366F1",
  "#3B82F6",
  "#06B6D4",
  "#22C55E",
  "#EAB308",
  "#F97316",
  "#EF4444",
  "#EC4899",
  "#8B5CF6",
];

interface OnboardingWizardProps {
  existingWorkspace: { id: string; name: string } | null;
  userName: string;
}

export function OnboardingWizard({
  existingWorkspace,
  userName,
}: OnboardingWizardProps) {
  // Step 0 = collect name (only if blank), Step 1 = workspace, Step 2 = space
  const needsName = !userName.trim();
  const [step, setStep] = useState<"name" | "workspace" | "space">(
    needsName ? "name" : existingWorkspace ? "space" : "workspace",
  );

  const [workspaceState, setWorkspaceState] = useState(existingWorkspace);
  const [pending, startTransition] = useTransition();

  const [displayName, setDisplayName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [logoEmoji, setLogoEmoji] = useState<string | null>(null);

  const [spaceName, setSpaceName] = useState("");
  const [spaceColor, setSpaceColor] = useState(SPACE_COLORS[0]);

  function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await saveUserName(displayName);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setStep("workspace");
    });
  }

  function handleCreateWorkspace(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createOnboardingWorkspace({
        name: workspaceName,
        logoEmoji,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setWorkspaceState({ id: result.workspaceId, name: workspaceName.trim() });
      setStep("space");
    });
  }

  function handleCreateSpace(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceState) return;
    startTransition(async () => {
      const result = await createOnboardingSpace({
        workspaceId: workspaceState.id,
        name: spaceName,
        color: spaceColor,
      });
      if (result && "error" in result) toast.error(result.error);
    });
  }

  // ── Step 0: collect name ──────────────────────────────────────────────────
  if (step === "name") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <UserIcon className="size-5 text-primary" weight="duotone" />
          </div>
          <CardTitle className="text-xl">What's your name?</CardTitle>
          <CardDescription>
            This is how teammates will see you across the workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveName} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="display-name">Full name</Label>
              <Input
                id="display-name"
                placeholder="e.g. Priya Shah"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={100}
                autoFocus
                required
              />
            </div>
            <Button
              type="submit"
              className="w-full gap-2"
              disabled={pending || displayName.trim().length < 2}
            >
              <ArrowRightIcon className="size-4" />
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  // ── Step 1: create workspace ──────────────────────────────────────────────
  if (step === "workspace") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <BuildingsIcon className="size-5 text-primary" weight="duotone" />
          </div>
          <CardTitle className="text-xl">Create your Workspace</CardTitle>
          <CardDescription>
            Your Workspace is your company or team's home. Everything your team
            works on lives here.
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
                Logo{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {LOGO_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-pressed={logoEmoji === emoji}
                    onClick={() =>
                      setLogoEmoji(logoEmoji === emoji ? null : emoji)
                    }
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

            <Button
              type="submit"
              className="w-full gap-2"
              disabled={pending || !workspaceName.trim()}
            >
              <ArrowRightIcon className="size-4" />
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  // ── Step 2: create first space ────────────────────────────────────────────
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <StackIcon className="size-5 text-primary" weight="duotone" />
        </div>
        <CardTitle className="text-xl">Create your first Space</CardTitle>
        <CardDescription>
          A Space is where your team's work lives — like a department or project
          area. You can create more later.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleCreateSpace} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="space-name">Space name</Label>
            <Input
              id="space-name"
              placeholder="e.g. Product, Engineering, Design"
              value={spaceName}
              onChange={(e) => setSpaceName(e.target.value)}
              maxLength={100}
              autoFocus
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-1.5">
              {SPACE_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-pressed={spaceColor === color}
                  onClick={() => setSpaceColor(color)}
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                    spaceColor === color
                      ? "border-foreground scale-110"
                      : "border-transparent",
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <Button
            type="submit"
            className="w-full gap-2"
            disabled={pending || !spaceName.trim()}
          >
            <ArrowRightIcon className="size-4" />
            Create Space &amp; continue
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
