"use client";

import * as React from "react";
import {
  PaperclipIcon,
  PaperPlaneRightIcon,
  XIcon,
  FileIcon,
  ImageIcon,
} from "@phosphor-icons/react";
import { MentionPopover } from "@/components/channel/mention-popover";
import { VoiceInputButton } from "@/components/channel/voice-input-button";
import { cn } from "@/lib/utils";

interface MentionMember {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

interface PendingAttachment {
  id: string;
  file: File;
  preview?: string;
  uploading: boolean;
  progress: number;
  uploadedId?: string;
  error?: string;
}

interface ChannelComposerProps {
  workspaceId: string;
  channelId: string;
  members: MentionMember[];
  onSend: (content: string, attachmentIds: string[], mentionedUserIds: string[]) => Promise<void>;
  disabled?: boolean;
}

export function ChannelComposer({
  workspaceId,
  channelId,
  members,
  onSend,
  disabled,
}: ChannelComposerProps) {
  const [content, setContent] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [attachments, setAttachments] = React.useState<PendingAttachment[]>([]);
  const [mentionedIds, setMentionedIds] = React.useState<Set<string>>(new Set());
  const [mentionQuery, setMentionQuery] = React.useState("");
  const [mentionVisible, setMentionVisible] = React.useState(false);
  const [mentionStartIdx, setMentionStartIdx] = React.useState(-1);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const composerRef = React.useRef<HTMLDivElement>(null);

  // Auto-resize textarea
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [content]);

  // Handle mention detection
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setContent(value);

    const pos = e.target.selectionStart ?? value.length;
    const textBefore = value.slice(0, pos);
    const atMatch = textBefore.match(/@(\w*)$/);

    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setMentionStartIdx(atMatch.index!);
      setMentionVisible(true);
    } else {
      setMentionVisible(false);
      setMentionQuery("");
    }
  }

  function handleMentionSelect(member: MentionMember) {
    const before = content.slice(0, mentionStartIdx);
    const after = content.slice(
      mentionStartIdx + 1 + mentionQuery.length, // +1 for the @
    );
    const newContent = `${before}@${member.name} ${after}`;
    setContent(newContent);
    setMentionedIds((prev) => new Set(prev).add(member.id));
    setMentionVisible(false);
    setMentionQuery("");

    // Focus back
    setTimeout(() => {
      const el = textareaRef.current;
      if (el) {
        const cursorPos = before.length + member.name.length + 2; // @ + name + space
        el.focus();
        el.setSelectionRange(cursorPos, cursorPos);
      }
    }, 0);
  }

  // File handling
  async function handleFiles(files: FileList | File[]) {
    const fileArr = Array.from(files);

    for (const file of fileArr) {
      const pendingId = `pending-${Date.now()}-${Math.random()}`;
      const preview = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined;

      const pending: PendingAttachment = {
        id: pendingId,
        file,
        preview,
        uploading: true,
        progress: 0,
      };

      setAttachments((prev) => [...prev, pending]);

      // Upload
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("workspaceId", workspaceId);

        const res = await fetch("/api/channel-attachments", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Upload failed");
        }

        const data = await res.json();
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === pendingId
              ? { ...a, uploading: false, progress: 100, uploadedId: data.id }
              : a,
          ),
        );
      } catch (e: any) {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === pendingId
              ? { ...a, uploading: false, error: e.message || "Upload failed" }
              : a,
          ),
        );
      }
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att?.preview) URL.revokeObjectURL(att.preview);
      return prev.filter((a) => a.id !== id);
    });
  }

  // Drag and drop
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }

  // Send message
  async function handleSend() {
    const trimmed = content.trim();
    const uploadedIds = attachments
      .filter((a) => a.uploadedId && !a.error)
      .map((a) => a.uploadedId!);

    if (!trimmed && uploadedIds.length === 0) return;

    setSending(true);
    try {
      await onSend(trimmed, uploadedIds, Array.from(mentionedIds));
      setContent("");
      setAttachments([]);
      setMentionedIds(new Set());
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionVisible) return; // Let mention popover handle keys

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Voice transcript callback
  const handleVoiceTranscript = React.useCallback((text: string) => {
    setContent((prev) => {
      const separator = prev && !prev.endsWith(" ") ? " " : "";
      return prev + separator + text;
    });
  }, []);

  const isUploadPending = attachments.some((a) => a.uploading);

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div
      ref={composerRef}
      className="relative border-t bg-card px-4 py-3"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className={cn(
                "relative flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm",
                att.error && "border-destructive/50 bg-destructive/5",
              )}
            >
              {att.preview ? (
                <img
                  src={att.preview}
                  alt={att.file.name}
                  className="size-8 rounded object-cover"
                />
              ) : (
                <FileIcon className="size-5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 max-w-32">
                <p className="truncate text-xs font-medium">{att.file.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {att.uploading
                    ? "Uploading…"
                    : att.error
                      ? att.error
                      : formatFileSize(att.file.size)}
                </p>
              </div>
              {att.uploading && (
                <div className="absolute bottom-0 left-0 h-0.5 rounded-full bg-primary/60 transition-all" style={{ width: `${att.progress}%` }} />
              )}
              <button
                onClick={() => removeAttachment(att.id)}
                className="ml-1 flex size-5 items-center justify-center rounded-full hover:bg-accent"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Mention popover */}
      <MentionPopover
        query={mentionQuery}
        members={members}
        onSelect={handleMentionSelect}
        onClose={() => setMentionVisible(false)}
        position={null}
        visible={mentionVisible}
      />

      {/* Input area */}
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col rounded-lg border bg-background transition-colors focus-within:ring-1 focus-within:ring-ring">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (@ to mention)"
            disabled={disabled || sending}
            rows={1}
            className="w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          <div className="flex items-center gap-0.5 px-2 pb-1.5">
            {/* Attach button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || sending}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              title="Attach files"
            >
              <PaperclipIcon className="size-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip"
            />

            {/* Voice input */}
            <VoiceInputButton
              onTranscript={handleVoiceTranscript}
              disabled={disabled || sending}
            />

            <div className="flex-1" />

            {/* Send button */}
            <button
              type="button"
              onClick={handleSend}
              disabled={
                disabled ||
                sending ||
                isUploadPending ||
                (!content.trim() && attachments.filter((a) => a.uploadedId).length === 0)
              }
              className={cn(
                "flex size-8 items-center justify-center rounded-md transition-colors",
                content.trim() || attachments.some((a) => a.uploadedId)
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "text-muted-foreground hover:bg-accent",
                (disabled || sending || isUploadPending) && "opacity-50 cursor-not-allowed",
              )}
              title="Send message"
            >
              <PaperPlaneRightIcon className="size-4" weight="fill" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
