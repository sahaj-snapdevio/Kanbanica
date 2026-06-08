# Database Schema

Single source of truth for all Prisma models. This is what goes into `prisma/schema.prisma`.

All feature-level data model sections in individual docs are the narrative spec. This file is the build reference.

---

## Conventions

- All IDs: `String @id @default(uuid())`
- All tables have: `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt`
- Soft delete: `isArchived Boolean @default(false)` + `archivedAt DateTime?`
- Hard delete: immediate, no tombstone (unless noted)
- Enums use SCREAMING_SNAKE_CASE

---

## Auth Tables (Better Auth managed)

Better Auth creates and manages these. Do not manually create migrations for them — let `npx better-auth migrate` handle it.

```prisma
model User {
  id               String    @id @default(uuid())
  name             String
  email            String    @unique
  emailVerified    Boolean   @default(false)
  image            String?
  isPlatformAdmin  Boolean   @default(false)
  banned           Boolean   @default(false)
  bannedReason     String?
  bannedAt         DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
}

model Session {
  id             String   @id @default(uuid())
  expiresAt      DateTime
  token          String   @unique
  ipAddress      String?
  userAgent      String?
  userId         String
  impersonatedBy String?
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model Account {
  id                    String    @id @default(uuid())
  accountId             String
  providerId            String
  userId                String
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
}

model Verification {
  id         String   @id @default(uuid())
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

---

## Workspace

```prisma
enum WorkspaceStatus {
  ACTIVE
  DELETING
}

model Workspace {
  id              String          @id @default(uuid())
  name            String
  slug            String          @unique
  logoUrl         String?
  logoEmoji       String?
  inviteLinkToken String?         @unique
  taskSeq         Int             @default(0)
  status          WorkspaceStatus @default(ACTIVE)
  createdBy       String
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  members         WorkspaceMember[]
  spaces          Space[]
}

enum WorkspaceRole {
  OWNER
  ADMIN
  MEMBER
  GUEST
}

enum MemberStatus {
  ACTIVE
  INVITED
}

model WorkspaceMember {
  id              String        @id @default(uuid())
  workspaceId     String
  userId          String?
  email           String?
  role            WorkspaceRole
  status          MemberStatus
  invitedBy       String?
  inviteToken     String?       @unique
  inviteExpiresAt DateTime?
  joinedAt        DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  workspace       Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
}
```

---

## Space

```prisma
model Space {
  id          String   @id @default(uuid())
  workspaceId String
  name        String
  color       String?
  isPrivate   Boolean  @default(false)
  isArchived  Boolean  @default(false)
  archivedAt  DateTime?
  createdBy   String
  orderIndex  Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace   Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  members     SpaceMember[]
  lists       List[]
}

enum SpacePermission {
  FULL_ACCESS
  EDIT
  VIEW
}

model SpaceMember {
  id          String          @id @default(uuid())
  spaceId     String
  userId      String
  permission  SpacePermission
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  space       Space           @relation(fields: [spaceId], references: [id], onDelete: Cascade)

  @@unique([spaceId, userId])
}
```

---

## List

```prisma
model List {
  id          String    @id @default(uuid())
  spaceId     String
  folderId    String?   -- null in MVP (Folder is post-MVP)
  name        String
  description String?
  color       String?
  orderIndex  Int       @default(0)
  isArchived  Boolean   @default(false)
  archivedAt  DateTime?
  createdBy   String
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  space       Space        @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  statuses    ListStatus[]
  tasks       Task[]
}

enum StatusType {
  OPEN
  ACTIVE
  CLOSED
}

model ListStatus {
  id         String     @id @default(uuid())
  listId     String
  name       String
  color      String
  type       StatusType
  orderIndex Int        @default(0)
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt

  list       List       @relation(fields: [listId], references: [id], onDelete: Cascade)
  tasks      Task[]
}
```

---

## Task

```prisma
enum Priority {
  NONE
  LOW
  MEDIUM
  HIGH
  URGENT
}

model Task {
  id            String    @id @default(uuid())
  seqNumber     Int
  workspaceId   String
  listId        String
  parentTaskId  String?
  statusId      String
  title         String
  description   Json?          // Tiptap rich text — full-text search on jsonb requires generated column (post-MVP, Phase 11+)
  priority      Priority  @default(NONE)
  reporterId    String
  dueDateStart  DateTime?
  dueDateEnd    DateTime?
  timeEstimate  Int?
  orderIndex    Int       @default(0)
  isArchived    Boolean   @default(false)
  archivedAt    DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  list          List          @relation(fields: [listId], references: [id], onDelete: Cascade)
  status        ListStatus    @relation(fields: [statusId], references: [id])
  parentTask    Task?         @relation("Subtasks", fields: [parentTaskId], references: [id])
  subtasks      Task[]        @relation("Subtasks")
  assignees     TaskAssignee[]
  watchers      TaskWatcher[]
  tags          TaskTag[]
  checklists    Checklist[]
  dependencies  TaskDependency[] @relation("BlockedBy")
  blocking      TaskDependency[] @relation("Blocking")
  comments      Comment[]
  attachments   TaskAttachment[]
  activityLogs  ActivityLog[]
  timeLogs      TimeLog[]
  notifications Notification[]
  descSnapshot  TaskDescriptionSnapshot?
  sprintTasks   TaskSprint[]
}

model TaskAssignee {
  taskId    String
  userId    String
  createdAt DateTime @default(now())

  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@id([taskId, userId])
}

model TaskWatcher {
  taskId    String
  userId    String
  createdAt DateTime @default(now())

  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@id([taskId, userId])
}

model Tag {
  id          String    @id @default(uuid())
  workspaceId String
  name        String
  color       String
  createdAt   DateTime  @default(now())

  taskTags    TaskTag[]

  @@unique([workspaceId, name])
}

model TaskTag {
  taskId    String
  tagId     String

  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  tag       Tag      @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([taskId, tagId])
}

enum DependencyType {
  BLOCKED_BY
}

model TaskDependency {
  id              String         @id @default(uuid())
  taskId          String
  dependsOnTaskId String
  type            DependencyType @default(BLOCKED_BY)
  createdAt       DateTime       @default(now())

  task            Task           @relation("BlockedBy", fields: [taskId], references: [id], onDelete: Cascade)
  dependsOnTask   Task           @relation("Blocking", fields: [dependsOnTaskId], references: [id], onDelete: Cascade)

  @@unique([taskId, dependsOnTaskId])
}

model TaskDescriptionSnapshot {
  id        String   @id @default(uuid())
  taskId    String   @unique
  content   Json
  savedBy   String
  savedAt   DateTime @default(now())

  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
}

model TimeLog {
  id              String   @id @default(uuid())
  taskId          String
  userId          String
  durationMinutes Int
  note            String?
  loggedAt        DateTime @default(now())
  createdAt       DateTime @default(now())

  task            Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
}
```

---

## Checklist

```prisma
model Checklist {
  id        String          @id @default(uuid())
  taskId    String
  name      String
  orderIndex Int            @default(0)
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt

  task      Task            @relation(fields: [taskId], references: [id], onDelete: Cascade)
  items     ChecklistItem[]
}

model ChecklistItem {
  id          String    @id @default(uuid())
  checklistId String
  title       String
  isChecked   Boolean   @default(false)
  checkedBy   String?
  checkedAt   DateTime?
  orderIndex  Int       @default(0)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  checklist   Checklist @relation(fields: [checklistId], references: [id], onDelete: Cascade)
}
```

---

## Sprint

```prisma
enum SprintStatus {
  PLANNED
  ACTIVE
  CLOSED
}

model Sprint {
  id          String       @id @default(uuid())
  listId      String
  workspaceId String
  name        String
  goal        String?
  status      SprintStatus @default(PLANNED)
  startDate   DateTime?
  endDate     DateTime?
  createdBy   String
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  taskSprints TaskSprint[]
}

model TaskSprint {
  taskId    String
  sprintId  String
  points    Int?
  addedAt   DateTime @default(now())

  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  sprint    Sprint   @relation(fields: [sprintId], references: [id], onDelete: Cascade)

  @@id([taskId, sprintId])
}
```

---

## Collaboration

```prisma
model Comment {
  id              String    @id @default(uuid())
  taskId          String
  parentCommentId String?
  authorId        String
  body            Json
  isDeleted       Boolean   @default(false)
  isResolved      Boolean   @default(false)
  resolvedBy      String?
  resolvedAt      DateTime?
  editedAt        DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  task            Task              @relation(fields: [taskId], references: [id], onDelete: Cascade)
  parentComment   Comment?          @relation("Replies", fields: [parentCommentId], references: [id])
  replies         Comment[]         @relation("Replies")
  reactions       CommentReaction[]
  attachments     TaskAttachment[]
}

model CommentReaction {
  id        String   @id @default(uuid())
  commentId String
  userId    String
  emoji     String
  createdAt DateTime @default(now())

  comment   Comment  @relation(fields: [commentId], references: [id], onDelete: Cascade)

  @@unique([commentId, userId, emoji])
}

model ActivityLog {
  id        String   @id @default(uuid())
  taskId    String
  userId    String
  eventType String
  meta      Json     @default("{}")
  createdAt DateTime @default(now())

  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
}

model TaskAttachment {
  id         String   @id @default(uuid())
  taskId     String
  commentId  String?
  uploadedBy String
  fileName   String
  fileUrl    String
  fileSize   Int
  mimeType   String
  createdAt  DateTime @default(now())

  task       Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  comment    Comment? @relation(fields: [commentId], references: [id])
}
```

---

## Notifications

```prisma
enum NotificationEntityType {
  TASK
  COMMENT
  SPACE
  WORKSPACE
  SPRINT
}

model Notification {
  id          String                 @id @default(uuid())
  workspaceId String
  recipientId String
  actorId     String?
  triggerType String
  entityType  NotificationEntityType
  entityId    String
  title       String
  body        String?
  isRead      Boolean                @default(false)
  readAt      DateTime?
  createdAt   DateTime               @default(now())
  expiresAt   DateTime

  task        Task?                  @relation(fields: [entityId], references: [id])
}

model UserNotificationPreference {
  id           String   @id @default(uuid())
  userId       String
  workspaceId  String?
  triggerType  String
  inAppEnabled Boolean  @default(true)
  emailEnabled Boolean  @default(true)
  pushEnabled  Boolean  @default(true)
  updatedAt    DateTime @updatedAt

  @@unique([userId, workspaceId, triggerType])
}

model UserEmailPreference {
  id             String   @id @default(uuid())
  userId         String   @unique
  deliveryMode   String   @default("instant")
  digestTime     String   @default("08:00")
  digestTimezone String   @default("UTC")
  updatedAt      DateTime @updatedAt
}

enum MutedEntityType {
  TASK
  SPACE
}

model MutedEntity {
  id         String          @id @default(uuid())
  userId     String
  entityType MutedEntityType
  entityId   String
  createdAt  DateTime        @default(now())

  @@unique([userId, entityType, entityId])
}

model PushSubscription {
  id        String   @id @default(uuid())
  userId    String
  endpoint  String
  p256dh    String
  auth      String
  userAgent String?
  createdAt DateTime @default(now())
}
```

---

## Search & Onboarding

```prisma
model UserSearchHistory {
  id          String   @id @default(uuid())
  userId      String
  workspaceId String
  entityType  String
  entityId    String
  visitedAt   DateTime @default(now())
}

model SavedFilter {
  id        String   @id @default(uuid())
  userId    String
  listId    String
  name      String
  filters   Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model UserOnboardingProgress {
  id             String   @id @default(uuid())
  userId         String
  workspaceId    String
  stepWorkspace  Boolean  @default(true)
  stepSpace      Boolean  @default(true)
  stepFirstTask  Boolean  @default(false)
  stepInvite     Boolean  @default(false)
  stepDueDate    Boolean  @default(false)
  stepBoardView  Boolean  @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([userId, workspaceId])
}
```

---

## Admin / Audit

```prisma
model PlatformAuditLog {
  id         String   @id @default(uuid())
  adminId    String
  action     String
  targetType String
  targetId   String
  meta       Json     @default("{}")
  createdAt  DateTime @default(now())
}
```

---

## Tables NOT in this schema

| Table | Reason |
|-------|--------|
| `Folder` | Post-MVP — do not create |
| `UserListViewPreference` | Include when implementing Views (Phase 12) |
| `UserMyTasksPreference` | Include when implementing My Tasks (Phase 12) |

---

## Index Notes

Add these indexes in Prisma after the initial schema is working:

```prisma
-- Task lookups
@@index([listId])
@@index([workspaceId])
@@index([parentTaskId])
@@index([statusId])

-- Notification lookups
@@index([recipientId, isRead])
@@index([expiresAt])

-- Search history
@@index([userId, workspaceId])

-- Activity log
@@index([taskId])
```
