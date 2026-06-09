# Keyboard Shortcuts

## Goal

Provide a consistent, discoverable keyboard shortcut system across the application that speeds up power-user workflows without conflicting with browser defaults or OS shortcuts.

---

## Existing Scope (MVP)

- Global shortcuts (available everywhere in the app)
- Navigation shortcuts (sequential key combos, e.g. G -> H)
- List View shortcuts (row navigation, inline edit)
- Task Detail shortcuts (field picker triggers)
- Rich Text shortcuts (Tiptap formatting -- native, not reimplemented)
- Shortcut reference modal (`?` key)
- No user-customizable shortcuts in MVP

---

## User Flow

1. User presses `?` anywhere in the app -> Shortcut Reference modal opens
2. Modal lists all shortcuts grouped by context (Global, Navigation, List View, Task Detail, Rich Text)
3. User presses `Ctrl+K` -> Command Palette opens (global search)
4. User is in List View, presses `Arrow Down` -> focus moves to next task row
5. User presses `E` on a focused row -> inline title edit activates
6. User presses `Esc` -> edit cancelled; focus returns to row
7. User presses `C` -> New Task sheet opens for current list

---

## Technical Design

### Architecture: `useKeyboardShortcuts` Hook

All keyboard shortcut registration should be centralized in a single React hook to prevent duplicate listeners and make registration/deregistration declarative.

```typescript
// src/hooks/use-keyboard-shortcuts.ts

type ShortcutHandler = (event: KeyboardEvent) => void

interface ShortcutDefinition {
  key: string           // e.g. "k", "ArrowDown", "?"
  ctrlOrMeta?: boolean  // true = Ctrl on Windows/Linux, Cmd on Mac
  shift?: boolean
  alt?: boolean
  description: string   // shown in shortcut modal
  group: ShortcutGroup
  handler: ShortcutHandler
  /**
   * When true, handler fires even if an input/textarea is focused.
   * Default: false. Set true only for Esc and Ctrl+K.
   */
  allowInInput?: boolean
}

type ShortcutGroup = 'global' | 'navigation' | 'list' | 'task' | 'richtext'

export function useKeyboardShortcuts(shortcuts: ShortcutDefinition[]): void
```

**Implementation rules:**
- Single `window.addEventListener('keydown', handler, { capture: true })` per hook instance
- On unmount, call `removeEventListener` -- prevents memory leaks on route change
- Suppress handler if `event.target` is `INPUT`, `TEXTAREA`, `SELECT`, or `[contenteditable]` unless `allowInInput: true`
- Use `event.metaKey || event.ctrlKey` for cross-platform Ctrl/Cmd handling

### Shortcut Registry for the Modal

The `?` modal needs to know all currently-active shortcuts. Use a Zustand store:

```typescript
// src/store/shortcut-registry.ts

interface ShortcutRegistry {
  shortcuts: ShortcutDefinition[]
  register: (shortcuts: ShortcutDefinition[]) => void
  unregister: (keys: string[]) => void
}
```

`useKeyboardShortcuts` registers shortcuts on mount and unregisters on unmount -- the modal always reflects what is currently active.

### Sequential Shortcuts (G -> H Navigation)

Sequential shortcuts (press G, then H within 500ms) require a small state machine:

```typescript
// src/hooks/use-sequential-shortcuts.ts

interface SequentialShortcut {
  sequence: [string, string]  // first key, second key
  description: string
  group: ShortcutGroup
  handler: () => void
}

export function useSequentialShortcuts(shortcuts: SequentialShortcut[]): void
```

State: `lastKey: string | null`, `lastKeyTime: number`. On keydown: if `lastKey === sequence[0]` and `Date.now() - lastKeyTime < 500`, fire handler. Reset after firing or after 500ms timeout.

### Browser Conflict Handling

| Shortcut | Browser Default | Resolution |
|----------|----------------|-----------|
| `Ctrl+K` | Chrome address bar focus | Call `event.preventDefault()` before opening palette |
| `Ctrl+B` | Chrome bookmark | Acceptable conflict -- Tiptap bold only fires inside the editor |
| `Ctrl+F` | Browser find | Do NOT override; use a separate in-app shortcut |
| `?` | No browser default | Safe to use globally |
| `G` (sequential) | No conflict | Safe; only fires outside inputs |

### Per-Route Registration Pattern

Register context-specific shortcuts inside the relevant page or component:

```typescript
// src/app/(app)/[workspaceId]/[spaceId]/list/[listId]/page.tsx

export default function ListPage() {
  useKeyboardShortcuts([
    {
      key: 'c',
      description: 'Create new task',
      group: 'list',
      handler: () => openNewTaskSheet(),
    },
    {
      key: 'ArrowDown',
      description: 'Move focus to next task',
      group: 'list',
      handler: () => focusNextRow(),
    },
  ])
}
```

Global shortcuts (`Ctrl+K`, `?`) are registered in the root authenticated layout so they are always active.

---

## Shortcut Reference

### Global

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Open Command Palette / Global Search |
| `C` | Create new task (uses current list context) |
| `?` | Open Keyboard Shortcuts reference modal |
| `Esc` | Close modal / cancel action / deselect |

### Navigation (Sequential)

| Shortcut | Action |
|----------|--------|
| `G` then `H` | Go to Home / My Tasks |
| `G` then `S` | Go to Space list |
| `G` then `N` | Go to Notifications |

### List View

| Shortcut | Action |
|----------|--------|
| `Arrow Up` / `Arrow Down` | Move focus between task rows |
| `Enter` | Open focused task detail |
| `E` | Inline edit focused task title |
| `Space` | Toggle task status (cycle through statuses) |
| `Shift+A` | Bulk-select all visible tasks |

### Task Detail

| Shortcut | Action |
|----------|--------|
| `A` | Open assignee picker |
| `D` | Open due date picker |
| `L` | Open label/tag picker |

### Rich Text (Tiptap -- active when editor is focused)

| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+U` | Underline |
| `Ctrl+Shift+S` | Strikethrough |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+Shift+7` | Ordered list |
| `Ctrl+Shift+8` | Unordered list |
| `Ctrl+Shift+C` | Code block |
| `Ctrl+Shift+B` | Blockquote |

---

## Folder Mapping

```
src/
  hooks/
    use-keyboard-shortcuts.ts    <- core registration hook
    use-sequential-shortcuts.ts  <- G->H sequential handling
  store/
    shortcut-registry.ts         <- Zustand store for modal listing
  components/
    common/
      shortcut-modal.tsx         <- ? key modal showing all shortcuts
      shortcut-badge.tsx         <- <ShortcutBadge keys={['Ctrl', 'K']} />
```

---

## API

No API endpoints. Keyboard shortcuts are entirely client-side.

---

## Database

No database tables. Shortcuts are not user-customizable in MVP. No persistence required.

---

## Events

No activity log events for shortcut usage.

---

## Background Jobs

None.

---

## Dependencies

- Zustand (`src/store/shortcut-registry.ts`) for modal shortcut listing
- Tiptap (rich text shortcuts are Tiptap-native; do not reimplement them)
- `useKeyboardShortcuts` must be implemented before any shortcut feature is built

---

## Edge Cases

| Scenario | Handling |
|----------|---------|
| User is typing in a task title input and presses `C` | Suppress -- `allowInInput: false` by default |
| User opens `?` modal while inside Tiptap editor | Tiptap captures `?` for input first; `?` shortcut must have `allowInInput: false` so it only fires outside rich text |
| Multiple `useKeyboardShortcuts` instances for same key | Last-registered wins; global shortcuts registered at layout level avoid duplicates |
| Mac: Cmd vs Ctrl | Use `event.metaKey || event.ctrlKey` in all checks; display as Cmd symbol on Mac, `Ctrl` on Windows |
| Browser extension intercepts `Ctrl+K` | Cannot fix; document known conflicts in the `?` modal |

---

## Acceptance Criteria

- [ ] `?` opens a modal listing all currently-registered shortcuts grouped by context
- [ ] `Ctrl+K` opens the command palette and suppresses the browser address bar behavior
- [ ] Arrow keys navigate task rows in List View without scrolling the page
- [ ] `E` activates inline task title edit on the focused row
- [ ] `Esc` closes any open modal or cancels inline edit
- [ ] `G` then `H` navigates to My Tasks within 500ms window
- [ ] No shortcut fires when focus is inside a text input (except Esc and Ctrl+K)
- [ ] Rich text shortcuts are functional in the Tiptap task description editor
- [ ] `<ShortcutBadge />` renders correctly on both Mac and Windows (Cmd vs Ctrl)

---

## Implementation Notes

- Implement `useKeyboardShortcuts` and `useSequentialShortcuts` first; all other shortcut features depend on them
- Register global shortcuts in `src/app/(app)/layout.tsx` (authenticated root layout)
- Register view-specific shortcuts in the relevant page component; they auto-unregister on unmount via the hook's `removeEventListener`
- Tiptap rich text shortcuts should NOT be reimplemented -- Tiptap handles them natively. Inject them into the shortcut registry from the Tiptap component's `onCreate` callback so they appear in the `?` modal
- `<ShortcutBadge />` should detect the OS via `navigator.platform` and render Cmd symbol or `Ctrl` accordingly
