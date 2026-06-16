"use client";

import * as React from "react";
import {
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  DotsThreeIcon,
  PaperPlaneRightIcon,
  PencilSimpleIcon,
  SmileyIcon,
  TrashIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow, format } from "date-fns";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  getTaskComments,
  createComment,
  editComment,
  deleteComment,
  resolveComment,
  unresolveComment,
  toggleReaction,
  type CommentWithReplies,
} from "@/app/actions/comment";
import { getTaskActivity } from "@/app/actions/task";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
  if (name) return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  return (email ?? "?").slice(0, 2).toUpperCase();
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
    case "time_logged": return `logged ${meta.minutes} minutes`;
    case "comment_added": return "left a comment";
    case "subtask_created": return `created subtask "${meta.subtask_title}"`;
    case "subtask_completed": return `completed subtask "${meta.subtask_title}"`;
    case "sprint_assigned": return `added to ${meta.sprint_name}`;
    case "sprint_unassigned": return `removed from ${meta.sprint_name}`;
    default: return eventType.replace(/_/g, " ");
  }
}

const COMMON_EMOJIS = ["👍", "👎", "❤️", "😄", "🎉", "🚀", "👀", "✅"];

// ─── Mini Tiptap editor ───────────────────────────────────────────────────────

function CommentEditor({
  placeholder,
  onSubmit,
  onCancel,
  initialContent,
  autoFocus,
}: {
  placeholder?: string;
  onSubmit: (content: unknown) => Promise<void>;
  onCancel?: () => void;
  initialContent?: unknown;
  autoFocus?: boolean;
}) {
  const [submitting, setSubmitting] = React.useState(false);

  const editor = useEditor({
    extensions: [StarterKit],
    content: (initialContent as object) ?? "",
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none min-h-[60px] outline-none px-3 py-2 text-sm",
      },
    },
  });

  async function handleSubmit() {
    if (!editor || editor.isEmpty) return;
    setSubmitting(true);
    try {
      await onSubmit(editor.getJSON());
      editor.commands.clearContent();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border bg-background focus-within:ring-1 focus-within:ring-primary/40 transition-shadow">
      <EditorContent editor={editor} />
      <div className="flex items-center justify-end gap-2 border-t px-2 py-1.5">
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleSubmit}
          disabled={submitting || !editor || editor.isEmpty}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          <PaperPlaneRightIcon className="size-3" />
          {submitting ? "Sending…" : "Comment"}
        </button>
      </div>
    </div>
  );
}

// ─── Comment body renderer ────────────────────────────────────────────────────

function CommentBody({ body }: { body: unknown }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: (body as object) ?? "",
    editable: false,
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none outline-none text-sm",
      },
    },
  });
  return <EditorContent editor={editor} />;
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
}) {
  const [replying, setReplying] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [repliesOpen, setRepliesOpen] = React.useState(true);

  const isAuthor = comment.authorId === currentUserId;
  const canDelete = isAuthor || isAdmin;
  const canResolve = isAuthor || isAdmin;
  const displayName = comment.authorName ?? comment.authorEmail ?? "Unknown";

  async function handleDelete() {
    if (!confirm("Delete this comment?")) return;
    await deleteComment(workspaceId, spaceId, listId, taskId, comment.id);
    onRefresh();
  }

  async function handleReply(body: unknown) {
    await createComment(workspaceId, spaceId, listId, taskId, body, comment.id);
    setReplying(false);
    onRefresh();
  }

  async function handleEdit(body: unknown) {
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

  return (
    <div className={cn("group/comment", depth > 0 && "ml-8 border-l pl-4")}>
      <div className={cn("rounded-lg p-3", comment.isResolved && "opacity-60")}>
        {/* Header */}
        <div className="flex items-start gap-2 mb-2">
          <Avatar className="size-6 shrink-0 mt-0.5">
            {comment.authorImage && <AvatarImage src={comment.authorImage} />}
            <AvatarFallback className="text-2xs bg-primary/10 text-primary">
              {initials(comment.authorName, comment.authorEmail)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">{displayName}</span>
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
          </div>

          {/* Actions popover */}
          <div className="opacity-0 group-hover/comment:opacity-100 flex items-center gap-1 transition-opacity shrink-0">
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
              <button
                onClick={handleDelete}
                className="size-6 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
              >
                <TrashIcon className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="pl-8">
          {comment.isDeleted ? (
            <p className="text-sm italic text-muted-foreground">[Comment deleted]</p>
          ) : editing ? (
            <CommentEditor
              initialContent={comment.body}
              onSubmit={handleEdit}
              onCancel={() => setEditing(false)}
              autoFocus
            />
          ) : (
            <CommentBody body={comment.body} />
          )}

          {/* Reactions */}
          {!comment.isDeleted && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {comment.reactions.map((r) => {
                const reacted = r.userIds.includes(currentUserId);
                return (
                  <button
                    key={r.emoji}
                    onClick={() => handleReaction(r.emoji)}
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                      reacted ? "border-primary/40 bg-primary/10 text-primary" : "border-border hover:bg-accent",
                    )}
                  >
                    <span>{r.emoji}</span>
                    <span className="font-medium">{r.count}</span>
                  </button>
                );
              })}

              {/* Add reaction */}
              <Popover>
                <PopoverTrigger asChild>
                  <button className="opacity-0 group-hover/comment:opacity-100 size-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground transition-opacity">
                    <SmileyIcon className="size-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2" align="start">
                  <div className="flex gap-1">
                    {COMMON_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => handleReaction(emoji)}
                        className="rounded p-1 text-base hover:bg-accent transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Reply button */}
              {depth === 0 && (
                <button
                  onClick={() => setReplying((v) => !v)}
                  className="opacity-0 group-hover/comment:opacity-100 text-xs text-muted-foreground hover:text-foreground transition-opacity ml-1"
                >
                  Reply
                </button>
              )}
            </div>
          )}

          {/* Reply editor */}
          {replying && (
            <div className="mt-3">
              <CommentEditor
                placeholder="Write a reply…"
                onSubmit={handleReply}
                onCancel={() => setReplying(false)}
                autoFocus
              />
            </div>
          )}
        </div>
      </div>

      {/* Replies */}
      {comment.replies.length > 0 && (
        <div className="mt-1">
          <button
            onClick={() => setRepliesOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ml-8 mb-1 transition-colors"
          >
            {repliesOpen ? <CaretDownIcon className="size-3" /> : <CaretRightIcon className="size-3" />}
            {comment.replies.length} {comment.replies.length === 1 ? "reply" : "replies"}
          </button>
          {repliesOpen && (
            <div className="space-y-1">
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
  return (
    <div className="flex items-start gap-2 py-1">
      <Avatar className="size-5 shrink-0 mt-0.5">
        {entry.image && <AvatarImage src={entry.image} />}
        <AvatarFallback className="text-[9px] bg-muted">
          {initials(entry.name, entry.email)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{entry.name ?? entry.email ?? "System"}</span>
        {" "}
        {describeEvent(entry.eventType, entry.meta as Record<string, unknown>)}
        <span
          className="ml-2 text-2xs"
          title={format(new Date(entry.createdAt), "PPpp")}
        >
          {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
        </span>
      </div>
    </div>
  );
}

// ─── Main feed ────────────────────────────────────────────────────────────────

export function TaskActivityFeed({
  workspaceId,
  spaceId,
  listId,
  taskId,
  currentUserId,
  isAdmin,
}: TaskActivityFeedProps) {
  const [comments, setComments] = React.useState<CommentWithReplies[]>([]);
  const [activityLogs, setActivityLogs] = React.useState<ActivityEntry[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    const [commentsRes, activityRes] = await Promise.all([
      getTaskComments(workspaceId, spaceId, taskId),
      getTaskActivity(workspaceId, spaceId, taskId),
    ]);
    if (!("error" in commentsRes)) setComments(commentsRes.comments);
    if (!("error" in activityRes)) setActivityLogs(activityRes.logs as ActivityEntry[]);
    setLoading(false);
  }, [workspaceId, spaceId, taskId]);

  React.useEffect(() => { void load(); }, [load]);

  // Interleave comments + activity log in chronological order
  const feed: FeedItem[] = React.useMemo(() => {
    const items: FeedItem[] = [
      ...comments.map((c): FeedItem => ({ type: "comment", createdAt: new Date(c.createdAt), comment: c })),
      ...activityLogs
        .filter((a) => a.eventType !== "comment_added") // skip — comment itself shown
        .map((a): FeedItem => ({ type: "activity", createdAt: new Date(a.createdAt), activity: a })),
    ];
    items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return items;
  }, [comments, activityLogs]);

  async function handleNewComment(body: unknown) {
    await createComment(workspaceId, spaceId, listId, taskId, body);
    void load();
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Activity
      </p>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-2">
              <div className="size-6 rounded-full bg-muted shrink-0" />
              <div className="flex-1 h-14 rounded-lg bg-muted" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {feed.map((item, i) =>
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
      <CommentEditor
        placeholder="Write a comment… (Ctrl+Enter to submit)"
        onSubmit={handleNewComment}
      />
    </div>
  );
}
