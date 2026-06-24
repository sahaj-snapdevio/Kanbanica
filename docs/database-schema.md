# Database Schema

Single source of truth for all Drizzle table definitions. These are split across files in `db/schema/` and re-exported from `db/schema/index.ts`.

All feature-level data model sections in individual docs are the narrative spec. This file is the build reference.

---

## Conventions

- All IDs: `text("id").primaryKey()` — UUIDs generated via `crypto.randomUUID()` before insert
- All tables have: `createdAt` and `updatedAt` as `timestamp({ withTimezone: true }).notNull().defaultNow()`
- `updatedAt` must be set manually on every update: `.set({ updatedAt: new Date() })`
- Soft delete: `isArchived boolean default false` + `archivedAt timestamp?`
- Hard delete: immediate, no tombstone (unless noted)
- Enums use Drizzle `pgEnum` with SCREAMING_SNAKE_CASE values
- Schema files live in `db/schema/<domain>.ts` and are exported from `db/schema/index.ts`
- Run migrations: `npx drizzle-kit generate` then `npx drizzle-kit migrate`

---

## Auth Tables (Better Auth managed)

Better Auth creates and manages these. Schema file: `db/schema/auth.ts`.
Better Auth's Drizzle adapter generates the exact column names it needs — do not rename them.

```ts
// db/schema/auth.ts
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  banned: boolean("banned").notNull().default(false),
  bannedReason: text("banned_reason"),
  bannedAt: timestamp("banned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

---

## Workspace

Schema file: `db/schema/workspace.ts`

```ts
import { pgEnum, pgTable, text, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";

export const workspaceStatusEnum = pgEnum("workspace_status", ["ACTIVE", "DELETING"]);
export const workspaceRoleEnum = pgEnum("workspace_role", ["OWNER", "ADMIN", "MEMBER", "GUEST"]);
export const memberStatusEnum = pgEnum("member_status", ["ACTIVE", "INVITED"]);

export const workspace = pgTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  logoEmoji: text("logo_emoji"),
  inviteLinkToken: text("invite_link_token").unique(),
  taskSeq: integer("task_seq").notNull().default(0),
  status: workspaceStatusEnum("status").notNull().default("ACTIVE"),
  theme: text("theme").notNull().default("indigo"),           // accent color key — see Theme Settings
  appearanceMode: text("appearance_mode").notNull().default("auto"), // "light" | "dark" | "auto"
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceMember = pgTable("workspace_member", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  email: text("email"),
  role: workspaceRoleEnum("role").notNull(),
  status: memberStatusEnum("status").notNull(),
  invitedBy: text("invited_by"),
  inviteToken: text("invite_token").unique(),
  inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("workspace_member_workspace_id_idx").on(t.workspaceId),
  index("workspace_member_user_id_idx").on(t.userId),
]);
```

---

## Space

Schema file: `db/schema/space.ts`

```ts
import { pgEnum, pgTable, text, timestamp, boolean, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { workspace } from "./workspace";

export const spacePermissionEnum = pgEnum("space_permission", ["FULL_ACCESS", "EDIT", "VIEW"]);

export const space = pgTable("space", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  isPrivate: boolean("is_private").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  // Sprint settings (null sprint_start_day = not yet configured → show first-time setup modal)
  sprintStartDay: integer("sprint_start_day"),                                    // 0=Sun, 1=Mon, …, 6=Sat; NULL = unconfigured
  sprintDefaultDurationWeeks: integer("sprint_default_duration_weeks").notNull().default(2),
  sprintNameFormat: text("sprint_name_format").notNull().default("Sprint {n}"),   // {n}=number, {project}=space name
  sprintDateFormat: text("sprint_date_format").notNull().default("MM/DD"),        // date display format in sprint views
  sprintAutoMarkDone: boolean("sprint_auto_mark_done").notNull().default(false),
  sprintAutoCreateNext: boolean("sprint_auto_create_next").notNull().default(false),
  sprintAutoMoveIncomplete: boolean("sprint_auto_move_incomplete").notNull().default(false),
  sprintAutoArchiveAfterN: integer("sprint_auto_archive_after_n"),                // NULL = disabled
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("space_workspace_id_idx").on(t.workspaceId),
]);

export const spaceMember = pgTable("space_member", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => space.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  permission: spacePermissionEnum("permission").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("space_member_space_user_idx").on(t.spaceId, t.userId),
]);
```

---

## List

Schema file: `db/schema/list.ts`

```ts
import { pgEnum, pgTable, text, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { space } from "./space";

export const statusTypeEnum = pgEnum("status_type", ["OPEN", "ACTIVE", "CLOSED"]);

export const list = pgTable("list", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => space.id, { onDelete: "cascade" }),
  folderId: text("folder_id"),  // null in MVP — Folder is post-MVP
  name: text("name").notNull(),
  description: text("description"),
  color: text("color"),
  orderIndex: integer("order_index").notNull().default(0),
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("list_space_id_idx").on(t.spaceId),
]);

export const listStatus = pgTable("list_status", {
  id: text("id").primaryKey(),
  listId: text("list_id").notNull().references(() => list.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull(),
  type: statusTypeEnum("type").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("list_status_list_id_idx").on(t.listId),
]);
```

---

## Task

Schema file: `db/schema/task.ts`

```ts
import { pgEnum, pgTable, text, timestamp, boolean, integer, json, index } from "drizzle-orm/pg-core";
import { list } from "./list";
import { listStatus } from "./list";
import { workspace } from "./workspace";

export const priorityEnum = pgEnum("priority", ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]);
export const dependencyTypeEnum = pgEnum("dependency_type", ["BLOCKED_BY"]);

export const task = pgTable("task", {
  id: text("id").primaryKey(),
  seqNumber: integer("seq_number").notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  listId: text("list_id").notNull().references(() => list.id, { onDelete: "cascade" }),
  parentTaskId: text("parent_task_id"),  // self-reference set up via relations
  statusId: text("status_id").notNull().references(() => listStatus.id),
  title: text("title").notNull(),
  description: json("description"),  // Tiptap JSON — full-text search on jsonb is post-MVP
  priority: priorityEnum("priority").notNull().default("NONE"),
  reporterId: text("reporter_id").notNull(),
  dueDateStart: timestamp("due_date_start", { withTimezone: true }),
  dueDateEnd: timestamp("due_date_end", { withTimezone: true }),
  timeEstimate: integer("time_estimate"),
  orderIndex: integer("order_index").notNull().default(0),
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  // List Pin (sticky) — see docs/pinned-tasks.md Part 2
  isPinnedToList: boolean("is_pinned_to_list").notNull().default(false),
  pinnedToListBy: text("pinned_to_list_by"),
  pinnedToListAt: timestamp("pinned_to_list_at", { withTimezone: true }),
  pinnedToListOrder: integer("pinned_to_list_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("task_list_id_idx").on(t.listId),
  index("task_workspace_id_idx").on(t.workspaceId),
  index("task_parent_task_id_idx").on(t.parentTaskId),
  index("task_status_id_idx").on(t.statusId),
  index("task_pinned_to_list_idx").on(t.listId, t.isPinnedToList),
]);

export const taskAssignee = pgTable("task_assignee", {
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // composite PK set via primaryKey() in relations or enforced via unique index
  index("task_assignee_task_id_idx").on(t.taskId),
]);

export const taskWatcher = pgTable("task_watcher", {
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("task_watcher_task_id_idx").on(t.taskId),
]);

export const tag = pgTable("tag", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const taskTag = pgTable("task_tag", {
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => tag.id, { onDelete: "cascade" }),
});

export const taskDependency = pgTable("task_dependency", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  dependsOnTaskId: text("depends_on_task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  type: dependencyTypeEnum("type").notNull().default("BLOCKED_BY"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// List Pin columns — added to the task table
// isPinnedToList, pinnedToListBy, pinnedToListAt, pinnedToListOrder
// See docs/pinned-tasks.md for full spec

export const taskDescriptionSnapshot = pgTable("task_description_snapshot", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().unique().references(() => task.id, { onDelete: "cascade" }),
  content: json("content").notNull(),
  savedBy: text("saved_by").notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
});

export const timeLog = pgTable("time_log", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  note: text("note"),
  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("time_log_task_id_idx").on(t.taskId),
]);
```

---

## Checklist

Schema file: `db/schema/checklist.ts`

```ts
import { pgTable, text, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { task } from "./task";

export const checklist = pgTable("checklist", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("checklist_task_id_idx").on(t.taskId),
]);

export const checklistItem = pgTable("checklist_item", {
  id: text("id").primaryKey(),
  checklistId: text("checklist_id").notNull().references(() => checklist.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  isChecked: boolean("is_checked").notNull().default(false),
  checkedBy: text("checked_by"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

---

## Sprint

Schema file: `db/schema/sprint.ts`

```ts
import { pgEnum, pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { task } from "./task";
import { space } from "./space";

export const sprintStatusEnum = pgEnum("sprint_status", ["PLANNED", "ACTIVE", "CLOSED"]);

export const sprint = pgTable("sprint", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => space.id, { onDelete: "cascade" }),  // Sprint belongs to a Project (space), not a List
  name: text("name").notNull(),
  goal: text("goal"),
  status: sprintStatusEnum("status").notNull().default("PLANNED"),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("sprint_space_id_idx").on(t.spaceId),
]);

export const taskSprint = pgTable("task_sprint", {
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  sprintId: text("sprint_id").notNull().references(() => sprint.id, { onDelete: "cascade" }),
  points: integer("points"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});
```

---

## Pinned Tasks

Schema file: `db/schema/pinned-task.ts`

```ts
import { pgTable, text, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { task } from "./task";
import { workspace } from "./workspace";

export const pinnedTask = pgTable("pinned_task", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  orderIndex: integer("order_index").notNull().default(0),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pinned_task_user_task_idx").on(t.userId, t.taskId),
  index("pinned_task_user_workspace_idx").on(t.userId, t.workspaceId),
]);
```

---

## Collaboration

Schema file: `db/schema/collaboration.ts`

```ts
import { pgTable, text, timestamp, boolean, json, uniqueIndex, index } from "drizzle-orm/pg-core";
import { task } from "./task";

export const comment = pgTable("comment", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  parentCommentId: text("parent_comment_id"),  // self-reference
  authorId: text("author_id").notNull(),
  body: json("body").notNull(),
  isDeleted: boolean("is_deleted").notNull().default(false),
  isResolved: boolean("is_resolved").notNull().default(false),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("comment_task_id_idx").on(t.taskId),
]);

export const commentReaction = pgTable("comment_reaction", {
  id: text("id").primaryKey(),
  commentId: text("comment_id").notNull().references(() => comment.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("comment_reaction_unique_idx").on(t.commentId, t.userId, t.emoji),
]);

export const activityLog = pgTable("activity_log", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  eventType: text("event_type").notNull(),
  meta: json("meta").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("activity_log_task_id_idx").on(t.taskId),
]);

export const taskAttachment = pgTable("task_attachment", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  commentId: text("comment_id"),  // optional link to a comment
  uploadedBy: text("uploaded_by").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: text("mime_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("task_attachment_task_id_idx").on(t.taskId),
]);
```

---

## Notifications

Schema file: `db/schema/notification.ts`

```ts
import { pgEnum, pgTable, text, timestamp, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";

export const notificationEntityTypeEnum = pgEnum("notification_entity_type", [
  "TASK", "COMMENT", "SPACE", "WORKSPACE", "SPRINT",
]);

export const mutedEntityTypeEnum = pgEnum("muted_entity_type", ["TASK", "SPACE"]);

export const notification = pgTable("notification", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  recipientId: text("recipient_id").notNull(),
  actorId: text("actor_id"),
  triggerType: text("trigger_type").notNull(),
  entityType: notificationEntityTypeEnum("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  index("notification_recipient_read_idx").on(t.recipientId, t.isRead),
  index("notification_expires_at_idx").on(t.expiresAt),
]);

export const userNotificationPreference = pgTable("user_notification_preference", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  workspaceId: text("workspace_id"),
  triggerType: text("trigger_type").notNull(),
  inAppEnabled: boolean("in_app_enabled").notNull().default(true),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  pushEnabled: boolean("push_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("user_notif_pref_unique_idx").on(t.userId, t.workspaceId, t.triggerType),
]);

export const userEmailPreference = pgTable("user_email_preference", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  deliveryMode: text("delivery_mode").notNull().default("instant"),
  digestTime: text("digest_time").notNull().default("08:00"),
  digestTimezone: text("digest_timezone").notNull().default("UTC"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mutedEntity = pgTable("muted_entity", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  entityType: mutedEntityTypeEnum("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("muted_entity_unique_idx").on(t.userId, t.entityType, t.entityId),
]);

export const pushSubscription = pgTable("push_subscription", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

---

## Search & Onboarding

Schema file: `db/schema/search.ts`

```ts
import { pgTable, text, timestamp, boolean, json, uniqueIndex, index } from "drizzle-orm/pg-core";

export const userSearchHistory = pgTable("user_search_history", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  visitedAt: timestamp("visited_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("user_search_history_user_workspace_idx").on(t.userId, t.workspaceId),
]);

export const savedFilter = pgTable("saved_filter", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  listId: text("list_id").notNull(),
  name: text("name").notNull(),
  filters: json("filters").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userOnboardingProgress = pgTable("user_onboarding_progress", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  stepWorkspace: boolean("step_workspace").notNull().default(true),
  stepSpace: boolean("step_space").notNull().default(true),
  stepFirstTask: boolean("step_first_task").notNull().default(false),
  stepInvite: boolean("step_invite").notNull().default(false),
  stepDueDate: boolean("step_due_date").notNull().default(false),
  stepBoardView: boolean("step_board_view").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("user_onboarding_user_workspace_idx").on(t.userId, t.workspaceId),
]);
```

---

## Admin / Audit

Schema file: `db/schema/audit-logs.ts`

```ts
import { pgTable, text, timestamp, json } from "drizzle-orm/pg-core";

export const platformAuditLog = pgTable("platform_audit_log", {
  id: text("id").primaryKey(),
  adminId: text("admin_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  meta: json("meta").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

---

## Tables NOT in this schema

| Table | Reason |
|-------|--------|
| `folder` | Post-MVP — do not create |
| `user_list_view_preference` | Include when implementing Views (Phase 12) |
| `user_my_tasks_preference` | Include when implementing My Tasks (Phase 12) |

---

## Migration workflow

```bash
# Generate a new migration after changing schema files
npx drizzle-kit generate

# Apply pending migrations to the database
npx drizzle-kit migrate

# Inspect current DB state
npx drizzle-kit studio
```
