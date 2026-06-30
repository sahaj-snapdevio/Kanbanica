"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CameraIcon, TrashIcon } from "@phosphor-icons/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface AvatarUploadProps {
  currentImageKey: string | null;
  name: string | null;
  email: string;
}

function getInitials(name: string | null, email: string) {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return email.slice(0, 2).toUpperCase();
}

export function AvatarUpload({ currentImageKey, name, email }: AvatarUploadProps) {
  const router = useRouter();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  // The preview is driven directly by upload (sets the returned URL) and remove
  // (sets null), so it updates instantly. We intentionally do NOT mirror
  // `currentImageKey` after mount: the session is cached briefly server-side, so
  // a post-action router.refresh() can return a stale key that would otherwise
  // resurrect a just-removed image and render blank.
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(
    currentImageKey ? `/api/files/${currentImageKey}` : null,
  );

  const initials = getInitials(name, email);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);
    setUploading(true);

    try {
      const body = new FormData();
      body.append("image", file);
      const res = await fetch("/api/user/avatar", { method: "POST", body });
      const data = await res.json();

      if (!res.ok) {
        setPreviewUrl(currentImageKey ? `/api/files/${currentImageKey}` : null);
        toast.error(data.error ?? "Upload failed");
        return;
      }

      // Swap the temporary blob preview for the persistent server URL before
      // the blob is revoked, so the avatar doesn't flash blank after upload.
      if (data.url) setPreviewUrl(data.url);
      toast.success("Avatar updated");
      router.refresh();
    } finally {
      setUploading(false);
      URL.revokeObjectURL(localPreview);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      const res = await fetch("/api/user/avatar", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to remove avatar");
        return;
      }
      setPreviewUrl(null);
      // Full reload so every avatar (header/sidebar included) re-reads from the
      // server and shows the name initial — a soft router.refresh() can keep a
      // stale cached image, leaving a blank until the user reloads manually.
      window.location.reload();
      return;
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex items-center gap-5">
      <div className="relative">
        <Avatar className="size-20">
          {previewUrl && <AvatarImage src={previewUrl} alt={name ?? email} />}
          <AvatarFallback className="text-xl">{initials}</AvatarFallback>
        </Avatar>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-sm transition-opacity hover:opacity-80 disabled:opacity-50"
          title="Change avatar"
        >
          <CameraIcon className="size-3.5" weight="bold" />
        </button>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">Profile photo</p>
        <p className="text-xs text-muted-foreground">
          JPEG, PNG, WebP or GIF · max 2 MB
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "Uploading…" : "Upload photo"}
          </Button>
          {previewUrl && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={handleRemove}
              disabled={removing}
            >
              <TrashIcon className="size-3.5 mr-1" />
              {removing ? "Removing…" : "Remove"}
            </Button>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
