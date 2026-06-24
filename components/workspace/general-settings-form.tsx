"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateWorkspace } from "@/app/actions/workspace";
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
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const LOGO_EMOJIS = ["🚀", "🏢", "⭐", "🎯", "💼", "🔥", "🛠️", "📈", "🎨", "🌱"];

interface GeneralSettingsFormProps {
  workspace: {
    id: string;
    name: string;
    slug: string;
    logoEmoji: string | null;
  };
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
        <form className="space-y-5 max-w-md" onSubmit={handleSave}>
          <div className="space-y-2">
            <Label htmlFor="ws-name">Workspace name</Label>
            <Input
              id="ws-name"
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              required
              value={name}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ws-slug">URL slug</Label>
            <Input
              id="ws-slug"
              maxLength={48}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              required
              value={slug}
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
                  aria-pressed={logoEmoji === emoji}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition-colors hover:bg-accent",
                    logoEmoji === emoji && "border-primary bg-primary/10"
                  )}
                  key={emoji}
                  onClick={() =>
                    setLogoEmoji(logoEmoji === emoji ? null : emoji)
                  }
                  type="button"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Image upload arrives with the avatar system.
            </p>
          </div>

          <Button
            className="gap-2"
            disabled={pending || !name.trim() || !slug.trim()}
            type="submit"
          >
            {pending && <Spinner className="size-4" />}
            Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
