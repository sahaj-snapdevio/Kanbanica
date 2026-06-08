# Folder

> **Post-MVP Feature.** Folder is not included in the initial MVP build. The MVP hierarchy is `Workspace → Space → List → Task → Subtask`. Folders will be introduced once teams are active and start accumulating enough Lists that grouping becomes necessary. See [improvement.md](./improvement.md) for the rationale.

---

## Overview

A Folder is an optional grouping layer inside a Space. It organizes multiple Lists under a single named container — useful when a Space has many Lists that logically belong together.

Folder is **optional** — Lists can exist directly under a Space without any Folder.

**Real-world analogy:** A Folder = a project or product area. e.g. `Mobile App`, `Website Redesign`, `Q3 Campaign`, `Internal Tools`

**Hierarchy position:**
```
Workspace
  └── Space
        └── Folder (optional)   ← you are here
              └── List
                    └── Task
```

---

## User Stories

- As a Member with Full Access, I want to create a Folder to group related Lists so the Space stays organized.
- As a Member, I want to collapse and expand Folders in the sidebar so I can focus on what I need.
- As a Member with Full Access, I want to move a List from one Folder to another without losing any task data.
- As a Member, I want to create Lists directly under a Space without needing a Folder.
- As an Admin, I want to archive a Folder to hide completed project work without deleting it.
- As an Admin, I want to delete a Folder and all its Lists when a project is fully retired.

---

## Features

### 1. Create Folder

- **Who can create:** Members with **Full Access** on the Space, Admin, Owner
- Required fields:
  - Folder Name (required)
  - Color (optional — pick from palette, used in sidebar)
- Folder is created inside a specific Space
- A Space can have unlimited Folders
- New Folder starts empty (no Lists inside)

---

### 2. Edit Folder

- **Who can edit:** Members with **Full Access** on the Space, Admin, Owner
- Editable fields:
  - Name
  - Color
- Changes are reflected immediately in the sidebar for all Space members

---

### 3. Archive Folder

- **Who can archive:** Members with **Full Access** on the Space, Admin, Owner
- Archived Folders are hidden from the active sidebar
- All Lists and Tasks inside are preserved and remain searchable
- No new Lists or Tasks can be created inside an archived Folder
- Can be unarchived at any time by a user with Full Access or Admin+
- Useful for completed projects that need to be kept for reference

---

### 4. Delete Folder

- **Who can delete:** Admin, Owner only
- Two deletion modes:

  **Delete Folder only:**
  - Removes the Folder container
  - All Lists inside move up directly under the Space
  - No task data is lost

  **Delete Folder and all contents:**
  - Permanently deletes the Folder plus all Lists, Tasks, Subtasks, Comments, and Attachments inside
  - Requires explicit confirmation
  - Cannot be undone

---

### 5. Move Lists In / Out of Folder

- **Who can move:** Members with **Full Access** on the Space, Admin, Owner
- A List can be:
  - Moved into a Folder (from Space root or another Folder)
  - Moved out of a Folder (back to Space root)
  - Moved to a different Folder within the same Space
- Moving a List does not affect its Tasks, Statuses, or any task data
- Lists cannot be moved across Spaces via Folder — use List-level move for that

---

### 6. Sidebar Behavior

- Folders appear in the Space section of the left sidebar
- Each Folder can be collapsed or expanded — state persists per user
- Lists inside a Folder are indented under it in the sidebar
- Lists not in any Folder appear flat at the Space root level
- Folder order in the sidebar can be manually reordered (drag-and-drop) — order is global (same for all members)

---

## Folder vs No Folder

| Scenario | Use Folder? |
|----------|------------|
| Space has 2–3 Lists | No — keep flat |
| Space has many Lists for different projects | Yes — group by project |
| Engineering Space with Frontend, Backend, DevOps | Yes — one Folder per area |
| A single team backlog | No — one List directly in Space |

Folder is a convenience layer. Do not force it — it is always optional.

---

## Data Model

```
Folder
├── id                  (uuid, primary key)
├── space_id            (foreign key → Space)
├── name                (string, required)
├── color               (string — hex color code, nullable)
├── order_index         (integer — for sidebar ordering)
├── is_archived         (boolean, default: false)
├── archived_at         (timestamp, nullable)
├── created_by          (user_id, foreign key)
├── created_at          (timestamp)
└── updated_at          (timestamp)

List (reference — belongs to Folder or Space directly)
├── folder_id           (foreign key → Folder, nullable)
└── space_id            (foreign key → Space)
```

> A List with `folder_id = null` sits directly under the Space. A List with a `folder_id` is inside that Folder.

---

## API Endpoints

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/api/spaces/:spaceId/folders` | Create a Folder | Full Access / Admin+ |
| GET | `/api/spaces/:spaceId/folders` | List all Folders in a Space | Space member |
| GET | `/api/spaces/:spaceId/folders/:id` | Get Folder details | Space member |
| PATCH | `/api/spaces/:spaceId/folders/:id` | Update Folder (name, color) | Full Access / Admin+ |
| DELETE | `/api/spaces/:spaceId/folders/:id` | Delete Folder (options: folder-only or with contents) | Admin+ |
| PATCH | `/api/spaces/:spaceId/folders/:id/archive` | Archive Folder | Full Access / Admin+ |
| PATCH | `/api/spaces/:spaceId/folders/:id/unarchive` | Unarchive Folder | Full Access / Admin+ |
| PATCH | `/api/spaces/:spaceId/folders/:id/reorder` | Update sidebar order | Full Access / Admin+ |

---

## UI Screens

| Screen | Description | Access |
|--------|-------------|--------|
| Sidebar — Folder list | Folders shown under their Space in left sidebar | All Space members |
| Folder view | Clicking a Folder expands to show its Lists | All Space members |
| Create Folder modal | Triggered from sidebar `+` button next to Space name | Full Access / Admin+ |
| Edit Folder modal | Accessible from Folder context menu (right-click or `...`) | Full Access / Admin+ |
| Archive / Delete confirmation | Confirmation dialog before destructive actions | Full Access / Admin+ |

---

## Data Lifecycle

### Archive
- Archived Folders are hidden from the sidebar for all Space members.
- All Lists and Tasks inside are preserved — fully searchable.
- No new Lists or Tasks can be created inside an archived Folder.
- Can be unarchived at any time — **no time limit**.
- Archiving a Folder does **not** archive its Lists individually — they remain active inside the Folder.
- When unarchived, all Lists and Tasks become immediately accessible again.
- If the parent Space is archived or deleted, the Folder follows the same fate.

### Soft Delete
- Folder deletion has **two modes** (no soft delete in either):
  1. **Folder only (hard delete):** Removes the Folder container. Lists inside move to Space root. No data lost.
  2. **Folder + contents (hard delete):** Permanently removes Folder and all Lists, Tasks, and their data. No recovery.
- Archive is the recommended alternative to deletion when you need to preserve data.

### Recovery Period
- **Archived Folder:** Recoverable at any time — no expiry.
- **Deleted Folder (folder only):** The Folder container is gone but Lists are moved to Space root — no data lost.
- **Deleted Folder with contents:** No recovery. All data is permanently gone.

### Permanent Deletion Rules
- **Delete folder only:** Folder record deleted, all child Lists have their `folder_id` set to `null` (moved to Space root).
- **Delete folder with contents:** The following are permanently removed in cascade:
  - All Lists inside the Folder
  - All Tasks and Subtasks in those Lists
  - All Checklists, ChecklistItems, TaskAttachments (DB + S3/R2 files)
  - All Comments (including soft-deleted tombstones)
  - All ActivityLog entries for tasks in this Folder
  - All Sprints and TaskSprint records
  - All Notifications referencing tasks in this Folder
- Requires explicit confirmation modal with the user choosing which deletion mode.
- Admin+ required for full deletion — Full Access members can only delete folder-only.

---

## Business Rules

1. A Folder always belongs to exactly one Space.
2. Folder is optional — a Space can have zero Folders.
3. A List can either belong to a Folder or sit directly under a Space — never both.
4. A List cannot belong to more than one Folder at a time.
5. Archiving a Folder does not archive its Lists or Tasks individually — they are accessible again when the Folder is unarchived.
6. Deleting a Folder without contents moves its Lists to the Space root — no data is lost.
7. Deleting a Folder with contents is permanent and irreversible — requires explicit user confirmation.
8. Folder order (sidebar position) is global — reordering affects all Space members.
9. A Folder cannot be moved across Spaces — it belongs to one Space permanently.
10. Permission to create/edit/delete a Folder is derived from the user's Space Permission — no separate Folder-level permissions exist.

---

## Out of Scope (MVP and Post-MVP Phase 1)

- Folder templates
- Folder duplication / copy
- Moving a Folder across Spaces
- Folder-level permission override (separate from Space permission)
- Folder-level analytics

---

## When to Build

Introduce Folder when:
- Beta users report that their Spaces have grown to 10+ Lists and the sidebar feels cluttered
- Teams ask for a way to group related Lists by project or area

Do not ship it earlier — no team needs it on day 1 and it adds navigation depth that confuses new users.
