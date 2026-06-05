# Keyboard Shortcuts

## Overview

Teamority supports keyboard shortcuts for common actions to let power users work without reaching for the mouse. Shortcuts are **context-aware** — they only fire when the user is not typing inside a text input, rich text editor, or modal form field.

**Platform notation:**
- `Ctrl` = Windows / Linux
- `Cmd` = Mac
- Shortcuts listed as `Ctrl/Cmd` work on both platforms

---

## Global Shortcuts

Available on every page in the app.

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + K` | Open global search / command palette |
| `C` | Create a new task (opens quick-create in the current List, or full create modal if not in a List) |
| `?` | Open keyboard shortcuts reference panel (this list, in-app) |
| `Esc` | Close any open modal, panel, or dropdown |

---

## Navigation Shortcuts

| Shortcut | Action |
|----------|--------|
| `G` then `H` | Go to Home / My Tasks |
| `G` then `S` | Go to Search results page |
| `G` then `N` | Go to Notifications inbox |

> **Sequential shortcuts** (`G` then `H`): press `G` first — a 1-second window opens for the second key. If the second key is not pressed within 1 second, the sequence resets silently.

---

## List View Shortcuts

Active when the user is viewing a List in List View and no input is focused.

| Shortcut | Action |
|----------|--------|
| `C` | Create a new task (inline quick-create at bottom of list) |
| `↑` / `↓` | Move focus to the previous / next task row |
| `Enter` | Open the focused task's detail panel |
| `E` | Edit the focused task's title inline |
| `Esc` | Close task detail panel / cancel inline edit |
| `Space` | Toggle checkbox (select / deselect focused task for bulk actions) |
| `Shift + ↑` / `Shift + ↓` | Extend bulk selection up / down |
| `Backspace` / `Delete` | Delete focused task (requires confirmation modal — shortcut does not bypass it) |

---

## Task Detail Panel Shortcuts

Active when the task detail panel is open and focus is not inside a text field.

| Shortcut | Action |
|----------|--------|
| `Esc` | Close the task detail panel |
| `E` | Focus the title field for editing |
| `Ctrl/Cmd + Enter` | Save current field edit and return focus to the panel |
| `Ctrl/Cmd + Shift + ,` | Change priority — cycles: None → Low → Medium → High → Urgent → None |
| `A` | Open assignee picker |
| `D` | Open due date picker |
| `L` | Open tag (label) picker |
| `Ctrl/Cmd + /` | Open the shortcuts reference panel |

---

## Rich Text Editor Shortcuts (Description & Comments)

Standard formatting shortcuts inside any Tiptap rich text field.

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + B` | Bold |
| `Ctrl/Cmd + I` | Italic |
| `Ctrl/Cmd + U` | Underline |
| `Ctrl/Cmd + Shift + X` | Strikethrough |
| `Ctrl/Cmd + E` | Inline code |
| `Ctrl/Cmd + Shift + C` | Code block |
| `Ctrl/Cmd + K` | Insert / edit link |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Tab` | Indent list item |
| `Shift + Tab` | Outdent list item |
| `Ctrl/Cmd + Enter` | Submit comment (when in comment composer) |
| `Esc` | Cancel / blur the editor (does not save — confirmation if content is unsaved) |

> `Ctrl/Cmd + K` inside the editor opens the **link dialog**, not global search. Global search is suppressed when a rich text editor is focused.

---

## Board View Shortcuts

Active when viewing a List in Board View.

| Shortcut | Action |
|----------|--------|
| `C` | Create a new task (opens quick-create in the first column) |
| `Enter` | Open the focused card's detail panel |
| `Esc` | Close task detail panel |

> Arrow key navigation between cards is **not** supported in MVP — Board View cards are not keyboard-focusable beyond `Tab` order.

---

## Modal & Dropdown Shortcuts

| Shortcut | Action |
|----------|--------|
| `Esc` | Close the modal or dropdown |
| `Enter` | Confirm / submit (when a confirm button is focused) |
| `↑` / `↓` | Move between options in a dropdown list |
| `Tab` | Move focus to the next field in a form |
| `Shift + Tab` | Move focus to the previous field |

---

## Global Search Palette Shortcuts

Active when the search palette (`Ctrl/Cmd + K`) is open.

| Shortcut | Action |
|----------|--------|
| `↑` / `↓` | Move between results |
| `Enter` | Open the selected result |
| `Esc` | Close the palette |
| `Ctrl/Cmd + K` | Close the palette (toggle) |

---

## Implementation Notes

### Conflict prevention rules

| Situation | Behavior |
|-----------|----------|
| User is typing in any `<input>`, `<textarea>`, or `contenteditable` | All single-key shortcuts (`C`, `E`, `A`, etc.) are suppressed — only modifier shortcuts (`Ctrl/Cmd + ...`) remain active |
| A modal is open | Navigation and List View shortcuts are suppressed — only modal-specific shortcuts apply |
| Rich text editor is focused | `Ctrl/Cmd + K` opens the link dialog (Tiptap default), not global search |
| User is on the Landing Page (unauthenticated) | No app shortcuts active |

### Browser conflicts

| Shortcut | Browser default | Resolution |
|----------|----------------|------------|
| `Ctrl/Cmd + K` | Chrome: focus URL bar | `event.preventDefault()` called on `keydown` — must be registered on `window` with `{ capture: true }` to intercept before Chrome handles it |
| `Ctrl/Cmd + B` | Chrome: open Bookmarks bar | Suppressed only when a rich text editor is focused — `event.preventDefault()` is called inside the Tiptap keydown handler |
| `Backspace` / `Delete` | Browser back navigation (on some browsers when no input focused) | `event.preventDefault()` called when a task row is focused in List View |

### Implementation pattern (Next.js App Router)

```ts
// Global shortcut handler — attach once in a root client component
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    const inInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)
      || (e.target as HTMLElement).isContentEditable

    // Ctrl/Cmd+K — always intercept, even in inputs
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault()
      openSearchPalette()
      return
    }

    // Single-key shortcuts — suppress when typing
    if (inInput) return

    if (e.key === 'c' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      openCreateTask()
    }
    if (e.key === '?') {
      e.preventDefault()
      openShortcutsPanel()
    }
    if (e.key === 'Escape') {
      closeTopModal()
    }
  }

  window.addEventListener('keydown', handler, { capture: true })
  return () => window.removeEventListener('keydown', handler, { capture: true })
}, [])
```

### `?` Shortcuts Panel (in-app)

- Pressing `?` anywhere opens a modal showing this shortcuts reference grouped by section
- Also accessible from the sidebar footer: `Help → Keyboard Shortcuts`
- The panel itself closes with `Esc` or clicking outside

---

## Business Rules

1. Single-key shortcuts (`C`, `E`, `A`, `D`, `L`) are suppressed whenever the user's cursor is inside any `<input>`, `<textarea>`, or `contenteditable` element.
2. `Ctrl/Cmd + K` is always intercepted — even when an input is focused — using `{ capture: true }` on the `keydown` event listener.
3. Shortcuts do not bypass confirmation dialogs — `Delete` / `Backspace` on a task always shows the confirmation modal before deleting.
4. Sequential shortcuts (`G` then `H`) have a 1-second window for the second key — no visual indicator is shown in MVP.
5. `Esc` always closes the topmost open layer first (panel → modal → dropdown → nothing). It does not close multiple layers at once.
6. `Ctrl/Cmd + Enter` inside a comment composer submits the comment. Inside a task title edit, it saves and blurs the field.
7. `Ctrl/Cmd + K` inside a focused Tiptap editor opens the link dialog — global search is not triggered.
8. Keyboard shortcuts are disabled on all public / unauthenticated pages (landing page, sign-in, sign-up, etc.).

---

## Out of Scope (MVP)

- Custom / remappable keyboard shortcuts
- Vim-style navigation (`j` / `k` for up / down) — conflicts with typing in inputs without complex mode detection
- Shortcut chords beyond 2-key sequences
- Keyboard shortcut analytics (tracking which shortcuts are used most)
