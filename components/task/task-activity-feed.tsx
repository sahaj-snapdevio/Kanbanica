"use client";

import * as React from "react";
import {
  AtIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  FileIcon,
  CodeBlockIcon,
  FilePdfIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  PaperclipIcon,
  ParagraphIcon,
  PaperPlaneRightIcon,
  PencilSimpleIcon,
  PlusIcon,
  QuotesIcon,
  SmileyIcon,
  TextHOneIcon,
  TextHThreeIcon,
  TextHTwoIcon,
  ThumbsUpIcon,
  TrashIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow, format } from "date-fns";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import { getWorkspaceMentionMembers, type MentionMember } from "@/app/actions/mention";
import { buildMentionSuggestion } from "@/components/task/mention-suggestion";
import {
  SlashCommandGrid,
  SlashCommandMenu,
  useSlashCommands,
  type SlashCommand,
} from "@/components/task/slash-command-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// Slash commands for the comment composer — mirror its "+" formatting menu.
const COMMENT_SLASH_COMMANDS: SlashCommand[] = [
  { key: "paragraph", label: "Normal text", desc: "Plain paragraph", keywords: "text paragraph normal", icon: ParagraphIcon, run: (e) => e.chain().focus().setParagraph().run() },
  { key: "h1", label: "Heading 1", desc: "Large heading", keywords: "h1 heading title", icon: TextHOneIcon, run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { key: "h2", label: "Heading 2", desc: "Medium heading", keywords: "h2 heading", icon: TextHTwoIcon, run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { key: "h3", label: "Heading 3", desc: "Small heading", keywords: "h3 heading", icon: TextHThreeIcon, run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { key: "bulletList", label: "Bullet list", desc: "Unordered list", keywords: "bullet unordered list ul", icon: ListBulletsIcon, run: (e) => e.chain().focus().toggleBulletList().run() },
  { key: "orderedList", label: "Numbered list", desc: "Ordered list", keywords: "numbered ordered list ol", icon: ListNumbersIcon, run: (e) => e.chain().focus().toggleOrderedList().run() },
  { key: "blockquote", label: "Blockquote", desc: "Block quote", keywords: "quote blockquote", icon: QuotesIcon, run: (e) => e.chain().focus().setBlockquote().run() },
  { key: "codeBlock", label: "Code block", desc: "Code snippet", keywords: "code block", icon: CodeBlockIcon, run: (e) => e.chain().focus().setCodeBlock().run() },
];
import {
  getTaskComments,
  createComment,
  editComment,
  deleteComment,
  resolveComment,
  unresolveComment,
  toggleReaction,
  type CommentAttachment,
  type CommentWithReplies,
} from "@/app/actions/comment";
import { getTaskActivity } from "@/app/actions/task";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAttachmentPreview } from "@/components/task/attachment-preview-modal";
import dynamic from "next/dynamic";

const EmojiPicker = dynamic(() => import("@emoji-mart/react"), {
  ssr: false,
  loading: () => (
    <div className="w-88 p-3 space-y-2">
      <div className="h-8 rounded-md bg-muted animate-pulse" />
      <div className="flex gap-1 pb-1 border-b border-border">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="size-7 rounded bg-muted animate-pulse" />
        ))}
      </div>
      <div className="h-3 w-20 rounded bg-muted animate-pulse" />
      <div className="grid grid-cols-8 gap-1">
        {Array.from({ length: 40 }).map((_, i) => (
          <div key={i} className="size-8 rounded bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  ),
});
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivityEntry {
  id: string;
  eventType: string;
  meta: unknown;
  createdAt: Date;
  name: string | null;
  email: string | null;
  image?: string | null;
}

interface FeedItem {
  type: "comment" | "activity";
  createdAt: Date;
  comment?: CommentWithReplies;
  activity?: ActivityEntry;
}

export interface TaskActivityFeedHandle {
  refresh: () => void;
}

interface TaskActivityFeedProps {
  workspaceId: string;
  spaceId: string;
  listId: string;
  taskId: string;
  currentUserId: string;
  isAdmin?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string | null, email: string | null) {
  const n = name?.trim();
  if (n) return n.split(" ").map((s) => s[0]).join("").toUpperCase().slice(0, 2);
  return (email ?? "?").slice(0, 2).toUpperCase();
}

function avatarSrc(key: string | null | undefined): string | undefined {
  return key ? `/api/files/${key}` : undefined;
}

function describeEvent(eventType: string, meta: Record<string, unknown>): string {
  switch (eventType) {
    case "task_created": return "created this task";
    case "title_changed": return `renamed to "${meta.to}"`;
    case "status_changed": return `changed status from ${meta.from_status_name ?? "—"} → ${meta.to_status_name ?? "—"}`;
    case "priority_changed": return `changed priority to ${meta.to}`;
    case "description_updated": return "updated the description";
    case "assignee_added": return `assigned ${meta.user_name ?? "someone"}`;
    case "assignee_removed": return `unassigned ${meta.user_name ?? "someone"}`;
    case "watcher_added": return "started watching";
    case "watcher_removed": return "stopped watching";
    case "due_date_set": return `set due date to ${meta.date}`;
    case "due_date_changed": return `changed due date from ${meta.from} → ${meta.to}`;
    case "due_date_removed": return "removed due date";
    case "tag_added": return `added tag "${meta.tagName}"`;
    case "tag_removed": return `removed tag "${meta.tagName}"`;
    case "checklist_created": return `added checklist "${meta.checklist_name}"`;
    case "checklist_deleted": return `deleted checklist "${meta.checklist_name}"`;
    case "checklist_item_checked": return `checked "${meta.item_title}"`;
    case "checklist_item_unchecked": return `unchecked "${meta.item_title}"`;
    case "dependency_added": return `added dependency on "${meta.depends_on_task_title}"`;
    case "dependency_removed": return `removed dependency on "${meta.depends_on_task_title}"`;
    case "attachment_uploaded": return `uploaded "${meta.file_name}"`;
    case "attachment_deleted": return `deleted "${meta.file_name}"`;
    case "task_archived": return "archived this task";
    case "task_unarchived": return "unarchived this task";
    case "task_moved": return "moved this task";
    case "time_logged": {
      const mins = Number(meta.minutes);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      const duration = h > 0 && m > 0 ? `${h}h ${m}m` : h > 0 ? `${h}h` : `${m}m`;
      return `logged ${duration}`;
    }
    case "comment_added": return "left a comment";
    case "subtask_created": return `created subtask "${meta.subtask_title}"`;
    case "subtask_completed": return `completed subtask "${meta.subtask_title}"`;
    case "sprint_assigned": return `added to ${meta.sprint_name}`;
    case "sprint_unassigned": return `removed from ${meta.sprint_name}`;
    default: return eventType.replace(/_/g, " ");
  }
}


// ─── Comment editor ───────────────────────────────────────────────────────────

function CommentEditor({
  placeholder,
  onSubmit,
  onCancel,
  initialContent,
  autoFocus,
  enableAttachments,
  compact,
  members,
}: {
  placeholder?: string;
  onSubmit: (content: unknown, files: File[]) => Promise<void>;
  onCancel?: () => void;
  initialContent?: unknown;
  autoFocus?: boolean;
  enableAttachments?: boolean;
  compact?: boolean;
  members?: MentionMember[];
}) {
  const [submitting, setSubmitting] = React.useState(false);
  const [pendingFiles, setPendingFiles] = React.useState<File[]>([]);
  const [editorEmpty, setEditorEmpty] = React.useState(!initialContent);
  const [plusOpen, setPlusOpen] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  // Stable refs so the editor's handleKeyDown always calls the latest versions
  const submitRef = React.useRef<() => void>(() => undefined);
  const splitListItemRef = React.useRef<() => void>(() => undefined);
  const isMentionActiveRef = React.useRef(false);

  // Keep a ref so the mention suggestion always reads the latest members list,
  // even though the Tiptap extension is created only once on mount.
  const membersRef = React.useRef<MentionMember[]>(members ?? []);
  React.useEffect(() => {
    membersRef.current = members ?? [];
  }, [members]);

  const slashMenu = useSlashCommands(COMMENT_SLASH_COMMANDS);

  const mentionExtension = React.useMemo(
    () =>
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        renderText: ({ node }) =>
          `@${(node.attrs.label as string | null) ?? (node.attrs.id as string) ?? "someone"}`,
        suggestion: buildMentionSuggestion(
          () => membersRef.current,
          (active) => { isMentionActiveRef.current = active; },
        ),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: placeholder ?? "Write a comment…" }),
      mentionExtension,
    ],
    content: (initialContent as object) ?? "",
    autofocus: autoFocus,
    onUpdate: ({ editor: e }) => {
      setEditorEmpty(e.isEmpty);
      slashMenu.refresh(e);
    },
    onSelectionUpdate: ({ editor: e }) => slashMenu.refresh(e),
    onBlur: () => slashMenu.close(),
    editorProps: {
      handleKeyDown: (view, event) => {
        // Slash command menu takes priority while it's open.
        if (slashMenu.handleKeyDown(event)) return true;
        if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
          // Let the mention suggestion handle Enter when popup is open
          if (isMentionActiveRef.current) return false;
          const { $from } = view.state.selection;
          let inListItem = false;
          let inFormattedBlock = false;
          for (let d = $from.depth; d > 0; d--) {
            const name = $from.node(d).type.name;
            if (name === "listItem") { inListItem = true; break; }
            if (name === "heading" || name === "blockquote" || name === "codeBlock") {
              inFormattedBlock = true; break;
            }
          }
          // Shift+Enter inside a list → new list item (same as plain Enter)
          if (event.shiftKey && inListItem) {
            splitListItemRef.current();
            return true;
          }
          // Any Enter inside a formatted block → let Tiptap handle natively
          if (inFormattedBlock || inListItem) return false;
          // Plain Enter in a paragraph → submit
          if (!event.shiftKey) {
            submitRef.current();
            return true;
          }
        }
        return false;
      },
      attributes: {
        class: cn(
          "prose prose-sm dark:prose-invert max-w-none outline-none px-3 py-2.5 text-sm",
          compact ? "min-h-[44px]" : "min-h-[72px]",
        ),
      },
    },
  });

  React.useEffect(() => { slashMenu.setEditor(editor); }, [editor, slashMenu]);

  async function handleSubmit() {
    if (!editor || (editorEmpty && pendingFiles.length === 0)) return;
    setSubmitting(true);
    try {
      // Deep-clone through JSON.parse/stringify to convert ProseMirror's
      // null-prototype attrs objects into plain objects — React Flight (server
      // action transport) drops null-prototype object properties silently.
      const body = JSON.parse(JSON.stringify(editor.getJSON())) as unknown;
      await onSubmit(body, pendingFiles);
      editor.commands.clearContent();
      setPendingFiles([]);
      setEditorEmpty(true);
    } finally {
      setSubmitting(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = "";
  }

  function removeFile(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  const canSubmit = !editorEmpty || pendingFiles.length > 0;

  // Keep submitRef pointing at the latest handleSubmit so the editor keydown
  // closure (created once) always calls the current version.
  submitRef.current = () => void handleSubmit();
  splitListItemRef.current = () => { editor?.chain().splitListItem("listItem").run(); };

  return (
    <div className="rounded-xl border bg-background shadow-sm focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all">
      <EditorContent editor={editor} />
      <SlashCommandMenu menu={slashMenu} />

      {/* Pending file previews */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pb-2 border-t pt-2">
          {pendingFiles.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
              className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
            >
              {file.type.startsWith("image/") ? (
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  className="size-4 object-cover rounded"
                />
              ) : file.type === "application/pdf" ? (
                <FilePdfIcon className="size-4 text-red-500 shrink-0" />
              ) : (
                <FileIcon className="size-4 text-muted-foreground shrink-0" />
              )}
              <span className="truncate max-w-28">{file.name}</span>
              <button
                onClick={() => removeFile(i)}
                className="text-muted-foreground hover:text-destructive shrink-0"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border-t px-2 py-1.5">
        {/* Plus — formatting menu */}
        <Popover open={plusOpen} onOpenChange={setPlusOpen}>
          <PopoverTrigger asChild>
            <button className="size-7 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
              <PlusIcon className="size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="top"
            className="w-110 max-w-[calc(100vw-2rem)] p-1.5 mb-1"
          >
            <SlashCommandGrid
              commands={COMMENT_SLASH_COMMANDS}
              onSelect={(cmd) => {
                if (editor) cmd.run(editor);
                setPlusOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Emoji */}
        <Popover>
          <PopoverTrigger asChild>
            <button className="size-7 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
              <SmileyIcon className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 border-0 shadow-lg" align="start">
            <EmojiPicker
              data={async () => (await import("@emoji-mart/data")).default}
              onEmojiSelect={(e: { native: string }) => editor?.commands.insertContent(e.native)}
              theme={typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light"}
              previewPosition="none"
              skinTonePosition="none"
              maxFrequentRows={2}
              perLine={8}
            />
          </PopoverContent>
        </Popover>

        {/* Attach */}
        {enableAttachments && (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="size-7 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Attach file"
            >
              <PaperclipIcon className="size-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              onChange={handleFileChange}
            />
          </>
        )}

        {/* Mention */}
        <button
          onClick={() => editor?.chain().focus().insertContent("@").run()}
          className="size-7 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <AtIcon className="size-4" />
        </button>

        {/* Right: cancel + submit */}
        <div className="flex-1" />

        {onCancel && (
          <button
            onClick={onCancel}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-accent transition-colors mr-1"
          >
            Cancel
          </button>
        )}

        {/* Submit group */}
        <div className={cn(
          "flex items-stretch rounded-lg overflow-hidden border transition-colors",
          canSubmit ? "border-primary bg-primary" : "border-border bg-muted/40",
        )}>
          <button
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
            className={cn(
              "flex items-center px-3 py-1.5 text-xs font-medium transition-colors",
              canSubmit
                ? "text-primary-foreground hover:bg-white/10"
                : "text-muted-foreground cursor-not-allowed",
            )}
          >
            {submitting ? <span>Sending…</span> : <span>Comment</span>}
          </button>
          <div className={cn("w-px shrink-0", canSubmit ? "bg-white/25" : "bg-border")} />
          <button
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
            className={cn(
              "flex items-center justify-center px-2 transition-colors",
              canSubmit
                ? "text-primary-foreground hover:bg-white/10"
                : "text-muted-foreground cursor-not-allowed",
            )}
          >
            <PaperPlaneRightIcon className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Comment body renderer ────────────────────────────────────────────────────

function CommentBody({ body }: { body: unknown }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        renderText: ({ node }) =>
          `@${(node.attrs.label as string | null) ?? (node.attrs.id as string) ?? "someone"}`,
      }),
    ],
    content: (body as object) ?? "",
    editable: false,
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none outline-none text-sm",
      },
    },
  });

  // Tiptap only applies `content` at init. When the comment is edited and the
  // feed refetches, the `body` prop changes but the editor keeps the old text
  // until it remounts — so push new content into the editor on every change.
  React.useEffect(() => {
    if (!editor) return;
    const next = (body as object) ?? "";
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(next)) {
      editor.commands.setContent(next);
    }
  }, [body, editor]);

  return <EditorContent editor={editor} />;
}

// ─── Comment attachments ──────────────────────────────────────────────────────

function CommentAttachments({ attachments }: { attachments: CommentAttachment[] }) {
  const preview = useAttachmentPreview();
  const images = attachments.filter((a) => a.mimeType.startsWith("image/"));
  const files = attachments.filter((a) => !a.mimeType.startsWith("image/"));

  // Open in the in-app preview modal; fall back to a new tab if no provider.
  function openAttachment(a: CommentAttachment) {
    if (preview) {
      preview.open({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        fileSize: a.fileSize,
        url: a.url,
      });
    } else {
      window.open(a.url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="px-3 pb-2 space-y-2">
      {/* Image grid */}
      {images.length > 0 && (
        <div className={cn(
          "grid gap-1.5",
          images.length === 1 ? "grid-cols-1" : images.length === 2 ? "grid-cols-2" : "grid-cols-3",
        )}>
          {images.map((img) => (
            <button
              key={img.id}
              type="button"
              onClick={() => openAttachment(img)}
              className="block overflow-hidden rounded-lg border bg-muted/30 hover:opacity-90 transition-opacity"
            >
              <img
                src={img.url}
                alt={img.fileName}
                className={cn(
                  "w-full object-cover",
                  images.length === 1 ? "max-h-64" : "h-28",
                )}
              />
            </button>
          ))}
        </div>
      )}

      {/* File cards */}
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={() => openAttachment(file)}
              className="flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-left hover:bg-accent transition-colors"
            >
              {file.mimeType === "application/pdf" ? (
                <FilePdfIcon className="size-4 text-red-500 shrink-0" />
              ) : (
                <FileIcon className="size-4 text-muted-foreground shrink-0" />
              )}
              <span className="text-xs font-medium truncate flex-1">{file.fileName}</span>
              <span className="text-2xs text-muted-foreground shrink-0">
                {(file.fileSize / 1024).toFixed(0)} KB
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Single comment ───────────────────────────────────────────────────────────

function CommentItem({
  comment,
  workspaceId,
  spaceId,
  listId,
  taskId,
  currentUserId,
  isAdmin,
  depth,
  onRefresh,
  members,
}: {
  comment: CommentWithReplies;
  workspaceId: string;
  spaceId: string;
  listId: string;
  taskId: string;
  currentUserId: string;
  isAdmin?: boolean;
  depth: number;
  onRefresh: () => void;
  members: MentionMember[];
}) {
  const [replying, setReplying] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [repliesOpen, setRepliesOpen] = React.useState(true);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const isAuthor = comment.authorId === currentUserId;
  const canDelete = isAuthor || isAdmin;
  const canResolve = isAuthor || isAdmin;
  const displayName = comment.authorName?.trim() || comment.authorEmail || "Unknown";

  async function handleDelete() {
    await deleteComment(workspaceId, spaceId, listId, taskId, comment.id);
    onRefresh();
  }

  async function handleReply(body: unknown, _files: File[]) {
    await createComment(workspaceId, spaceId, listId, taskId, body, comment.id);
    setReplying(false);
    onRefresh();
  }

  async function handleEdit(body: unknown, _files: File[]) {
    await editComment(workspaceId, spaceId, listId, comment.id, body);
    setEditing(false);
    onRefresh();
  }

  async function handleResolve() {
    if (comment.isResolved) {
      await unresolveComment(workspaceId, spaceId, listId, comment.id);
    } else {
      await resolveComment(workspaceId, spaceId, listId, comment.id);
    }
    onRefresh();
  }

  async function handleReaction(emoji: string) {
    await toggleReaction(workspaceId, spaceId, comment.id, emoji);
    onRefresh();
  }

  const thumbsUpReaction = comment.reactions.find((r) => r.emoji === "👍");
  const hasThumbsUp = thumbsUpReaction?.userIds.includes(currentUserId) ?? false;

  return (
    <div className={cn("group/comment", depth > 0 && "ml-6 mt-2")}>
      {/* Comment card */}
      <div
        className={cn(
          "rounded-xl border bg-card transition-colors",
          comment.isResolved && "opacity-60",
          depth > 0 && "border-border/60",
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <Avatar className="size-7 shrink-0">
            {comment.authorImage && <AvatarImage src={avatarSrc(comment.authorImage)} />}
            <AvatarFallback className="text-2xs bg-primary/10 text-primary font-semibold">
              {initials(comment.authorName, comment.authorEmail)}
            </AvatarFallback>
          </Avatar>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold leading-none">{displayName}</span>
            <span
              className="text-2xs text-muted-foreground"
              title={format(new Date(comment.createdAt), "PPpp")}
            >
              {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
            </span>
            {comment.editedAt && (
              <span className="text-2xs text-muted-foreground italic">(edited)</span>
            )}
            {comment.isResolved && (
              <span className="text-2xs text-green-600 font-medium flex items-center gap-0.5">
                <CheckCircleIcon className="size-3" weight="fill" /> Resolved
              </span>
            )}
          </div>

          {/* Options menu — visible on hover */}
          <div className="opacity-0 group-hover/comment:opacity-100 flex items-center gap-0.5 transition-opacity shrink-0">
            {canResolve && depth === 0 && (
              <button
                onClick={handleResolve}
                title={comment.isResolved ? "Unresolve" : "Resolve"}
                className="size-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
              >
                {comment.isResolved
                  ? <XCircleIcon className="size-3.5" />
                  : <CheckCircleIcon className="size-3.5" />}
              </button>
            )}
            {isAuthor && !comment.isDeleted && (
              <button
                onClick={() => setEditing((v) => !v)}
                className="size-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
              >
                <PencilSimpleIcon className="size-3.5" />
              </button>
            )}
            {canDelete && (
              <>
                <button
                  onClick={() => setDeleteOpen(true)}
                  className="size-6 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                >
                  <TrashIcon className="size-3.5" />
                </button>
                <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete comment?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This comment will be permanently deleted and cannot be recovered.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => void handleDelete()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="px-3 pb-1">
          {comment.isDeleted ? (
            <p className="text-sm italic text-muted-foreground py-1">[Comment deleted]</p>
          ) : editing ? (
            <CommentEditor
              initialContent={comment.body}
              onSubmit={handleEdit}
              onCancel={() => setEditing(false)}
              autoFocus
              compact
              members={members}
            />
          ) : (
            <CommentBody body={comment.body} />
          )}
        </div>

        {/* Attachments */}
        {!comment.isDeleted && comment.attachments.length > 0 && (
          <CommentAttachments attachments={comment.attachments} />
        )}

        {/* Footer */}
        {!comment.isDeleted && (
          <div className="flex items-center gap-1 px-3 pb-2 pt-1 border-t border-border/40">
            {/* Existing emoji reactions (👍 is shown on the dedicated like button) */}
            {comment.reactions
              .filter((r) => r.emoji !== "👍")
              .map((r) => {
              const reacted = r.userIds.includes(currentUserId);
              return (
                <button
                  key={r.emoji}
                  onClick={() => handleReaction(r.emoji)}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                    reacted
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border hover:bg-accent",
                  )}
                >
                  <span>{r.emoji}</span>
                  <span className="font-medium">{r.count}</span>
                </button>
              );
            })}

            {/* Thumbs up quick reaction (the only thumbs-up shown) */}
            <button
              onClick={() => handleReaction("👍")}
              className={cn(
                "h-7 flex items-center justify-center gap-1 rounded-md border px-2 transition-colors",
                hasThumbsUp
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border hover:bg-accent text-muted-foreground hover:text-foreground",
              )}
              title="Like"
            >
              <ThumbsUpIcon className="size-3.5" weight={hasThumbsUp ? "fill" : "regular"} />
              {(thumbsUpReaction?.count ?? 0) > 0 && (
                <span className="text-xs font-medium">
                  {thumbsUpReaction?.count}
                </span>
              )}
            </button>

            {/* Emoji picker */}
            <Popover>
              <PopoverTrigger asChild>
                <button className="size-7 flex items-center justify-center rounded-md border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                  <SmileyIcon className="size-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 border-0 shadow-lg" align="start">
                <EmojiPicker
                  data={async () => (await import("@emoji-mart/data")).default}
                  onEmojiSelect={(e: { native: string }) => handleReaction(e.native)}
                  theme={typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light"}
                  previewPosition="none"
                  skinTonePosition="none"
                  maxFrequentRows={2}
                  perLine={8}
                />
              </PopoverContent>
            </Popover>

            <div className="flex-1" />

            {/* Reply */}
            {depth === 0 && (
              <button
                onClick={() => setReplying((v) => !v)}
                className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-1"
              >
                Reply
              </button>
            )}
          </div>
        )}
      </div>

      {/* Reply editor */}
      {replying && (
        <div className="mt-2 ml-4">
          <CommentEditor
            placeholder="Write a reply…"
            onSubmit={handleReply}
            onCancel={() => setReplying(false)}
            autoFocus
            compact
            members={members}
          />
        </div>
      )}

      {/* Replies */}
      {comment.replies.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setRepliesOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ml-3 mb-2 transition-colors"
          >
            {repliesOpen
              ? <CaretDownIcon className="size-3" />
              : <CaretRightIcon className="size-3" />}
            {comment.replies.length} {comment.replies.length === 1 ? "reply" : "replies"}
          </button>
          {repliesOpen && (
            <div className="space-y-2">
              {comment.replies.map((reply) => (
                <CommentItem
                  key={reply.id}
                  comment={reply}
                  workspaceId={workspaceId}
                  spaceId={spaceId}
                  listId={listId}
                  taskId={taskId}
                  currentUserId={currentUserId}
                  isAdmin={isAdmin}
                  depth={depth + 1}
                  onRefresh={onRefresh}
                  members={members}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Activity row ─────────────────────────────────────────────────────────────

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const meta = entry.meta as Record<string, unknown>;
  const timeNote = entry.eventType === "time_logged" ? (meta.note as string | null | undefined) : null;

  return (
    <div className="flex items-center gap-2 py-1 px-1">
      <Avatar className="size-5 shrink-0">
        {entry.image && <AvatarImage src={avatarSrc(entry.image)} />}
        <AvatarFallback className="text-[9px] bg-muted">
          {initials(entry.name, entry.email)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0 text-xs text-muted-foreground">
        <div>
          <span className="font-medium text-foreground">{entry.name ?? entry.email ?? "System"}</span>
          {" "}
          {describeEvent(entry.eventType, meta)}
          <span
            className="ml-2 text-2xs opacity-70"
            title={format(new Date(entry.createdAt), "PPpp")}
          >
            {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
          </span>
        </div>
        {timeNote && (
          <p className="mt-0.5 text-2xs text-muted-foreground/80 italic truncate">
            &ldquo;{timeNote}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main feed ────────────────────────────────────────────────────────────────

export const TaskActivityFeed = React.forwardRef<TaskActivityFeedHandle, TaskActivityFeedProps>(
function TaskActivityFeed({
  workspaceId,
  spaceId,
  listId,
  taskId,
  currentUserId,
  isAdmin,
}, ref) {
  const [comments, setComments] = React.useState<CommentWithReplies[]>([]);
  const [activityLogs, setActivityLogs] = React.useState<ActivityEntry[]>([]);
  const [members, setMembers] = React.useState<MentionMember[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    const [commentsRes, activityRes, membersRes] = await Promise.all([
      getTaskComments(workspaceId, spaceId, taskId),
      getTaskActivity(workspaceId, spaceId, taskId),
      getWorkspaceMentionMembers(workspaceId, spaceId),
    ]);
    if (!("error" in commentsRes)) setComments(commentsRes.comments);
    if (!("error" in activityRes)) setActivityLogs(activityRes.logs as ActivityEntry[]);
    if (Array.isArray(membersRes)) setMembers(membersRes);
    setLoading(false);
  }, [workspaceId, spaceId, taskId]);

  React.useImperativeHandle(ref, () => ({ refresh: () => { void load(); } }), [load]);

  React.useEffect(() => { void load(); }, [load]);

  const feed: FeedItem[] = React.useMemo(() => {
    const items: FeedItem[] = [
      ...comments.map((c): FeedItem => ({
        type: "comment",
        createdAt: new Date(c.createdAt),
        comment: c,
      })),
      ...activityLogs
        .filter((a) => a.eventType !== "comment_added")
        .map((a): FeedItem => ({
          type: "activity",
          createdAt: new Date(a.createdAt),
          activity: a,
        })),
    ];
    items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return items;
  }, [comments, activityLogs]);

  async function handleNewComment(body: unknown, files: File[]) {
    const res = await createComment(workspaceId, spaceId, listId, taskId, body);
    if (files.length > 0 && "commentId" in res) {
      await Promise.all(
        files.map((file) => {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("commentId", res.commentId);
          return fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: fd });
        }),
      );
    }
    void load();
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Activity
      </p>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-2">
              <div className="size-7 rounded-full bg-muted shrink-0" />
              <div className="flex-1 h-20 rounded-xl bg-muted" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {feed.map((item) =>
            item.type === "comment" && item.comment ? (
              <CommentItem
                key={`c-${item.comment.id}`}
                comment={item.comment}
                workspaceId={workspaceId}
                spaceId={spaceId}
                listId={listId}
                taskId={taskId}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                depth={0}
                onRefresh={load}
                members={members}
              />
            ) : item.activity ? (
              <ActivityRow key={`a-${item.activity.id}`} entry={item.activity} />
            ) : null,
          )}
          {feed.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">No activity yet.</p>
          )}
        </div>
      )}

      {/* New comment editor */}
      <div className="pt-1">
        <CommentEditor
          placeholder="Add a comment… Type '/' for commands"
          onSubmit={handleNewComment}
          enableAttachments
          members={members}
        />
      </div>
    </div>
  );
});

TaskActivityFeed.displayName = "TaskActivityFeed";
