"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { updateList } from "@/app/actions/list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const COLOR_PALETTE = [
  "#6B7280", "#EF4444", "#F97316", "#EAB308",
  "#22C55E", "#14B8A6", "#3B82F6", "#8B5CF6",
  "#EC4899", "#F43F5E",
];

interface ListGeneralSettingsFormProps {
  workspaceId: string;
  spaceId: string;
  listId: string;
  initialName: string;
  initialColor: string | null;
  initialDescription: string | null;
}

export function ListGeneralSettingsForm({
  workspaceId,
  spaceId,
  listId,
  initialName,
  initialColor,
  initialDescription,
}: ListGeneralSettingsFormProps) {
  const router = useRouter();
  const [name, setName] = React.useState(initialName);
  const [color, setColor] = React.useState(initialColor ?? COLOR_PALETTE[5]);
  const [description, setDescription] = React.useState(initialDescription ?? "");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [saved, setSaved] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("List name is required"); return; }
    setLoading(true);
    setError("");
    const result = await updateList(workspaceId, spaceId, listId, {
      name: name.trim(),
      color: color || null,
      description: description.trim() || null,
    });
    setLoading(false);
    if ("error" in result) { setError(result.error); return; }
    setSaved(true);
    router.refresh();
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="lg-name">Name</Label>
        <Input
          id="lg-name"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(""); }}
          disabled={loading}
          className="max-w-sm"
        />
      </div>

      <div className="space-y-2">
        <Label>Color</Label>
        <div className="flex flex-wrap gap-2.5">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="h-7 w-7 rounded-full focus:outline-none"
              style={{
                backgroundColor: c,
                boxShadow: color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : undefined,
              }}
            />
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="lg-desc">
          Description{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Textarea
          id="lg-desc"
          placeholder="What is this list for?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          disabled={loading}
          className="max-w-sm"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={loading || !name.trim()}>
          {loading ? "Saving…" : saved ? "Saved!" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
