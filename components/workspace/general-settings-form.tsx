"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateWorkspace } from "@/app/actions/workspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const LOGO_EMOJIS = ["🚀", "🏢", "⭐", "🎯", "💼", "🔥", "🛠️", "📈", "🎨", "🌱"];

interface GeneralSettingsFormProps {
  workspace: { id: string; name: string; slug: string; logoEmoji: string | null };
}

export function GeneralSettingsForm({ workspace }: GeneralSettingsFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [logoEmoji, setLogoEmoji] = useState(workspace.logoEmoji);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateWorkspace({
        workspaceId: workspace.id,
        name: name.trim(),
        slug: slug.trim(),
        logoEmoji,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Workspace updated");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="normal-case tracking-normal text-base font-semibold">
          General
        </CardTitle>
        <CardDescription>Workspace name, logo and URL slug.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-5 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="ws-name">Workspace name</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ws-slug">URL slug</Label>
            <Input
              id="ws-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              maxLength={48}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              required
            />
            <p className="text-xs text-muted-foreground">
              Vanity alias only — changing it never breaks existing links.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Logo</Label>
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
            <p className="text-xs text-muted-foreground">
              Image upload arrives with the avatar system.
            </p>
          </div>

          <Button type="submit" disabled={pending || !name.trim() || !slug.trim()} className="gap-2">
            {pending && <Spinner className="size-4" />}
            Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
