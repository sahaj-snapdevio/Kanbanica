import { pgEnum, pgTable, text, timestamp, boolean, index, unique } from "drizzle-orm/pg-core";

export const notificationEntityTypeEnum = pgEnum("notification_entity_type", [
  "TASK",
  "COMMENT",
  "SPACE",
  "WORKSPACE",
  "SPRINT",
]);

export const mutedEntityTypeEnum = pgEnum("muted_entity_type", ["TASK", "SPACE"]);

export const notification = pgTable(
  "notification",
  {
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
  },
  (t) => [
    index("notification_recipient_read_idx").on(t.recipientId, t.isRead),
    index("notification_expires_at_idx").on(t.expiresAt),
  ],
);

export const userNotificationPreference = pgTable(
  "user_notification_preference",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id"),
    triggerType: text("trigger_type").notNull(),
    inAppEnabled: boolean("in_app_enabled").notNull().default(true),
    emailEnabled: boolean("email_enabled").notNull().default(true),
    pushEnabled: boolean("push_enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("user_notif_pref_unique").on(t.userId, t.workspaceId, t.triggerType)],
);

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
}, (t) => [unique("muted_entity_unique").on(t.userId, t.entityType, t.entityId)]);

export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_subscription_user_id_idx").on(t.userId)],
);
