"use client";

import type { Editor } from "@tiptap/react";
import * as React from "react";
import { cn } from "@/lib/utils";

// ─── Shared "/" command menu ──────────────────────────────────────────────────
// Generic, command-agnostic slash menu used by the task description editor and
// the comment composer. Each command's `run` calls an action that already exists
// in that editor's toolbar — the menu only invokes existing behavior.

export type SlashCommand = {
  key: string;
  label: string;
  desc: string;
  keywords: string;
  icon: React.ElementType;
  run: (editor: Editor) => void;
};

export interface SlashState {
  from: number;
  left: number;
  query: string;
  to: number;
  top: number;
}

// Detect a "/command" being typed at the cursor in a normal text context.
export function computeSlash(editor: Editor): SlashState | null {
  const { selection } = editor.state;
  if (!selection.empty) {
    return null;
  }
  if (editor.isActive("codeBlock")) {
    return null;
  }
  const { $from } = selection;
  const textBefore = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    " "
  );
  const match = /(?:^|\s)\/(\w*)$/.exec(textBefore);
  if (!match) {
    return null;
  }
  const query = match[1];
  const to = $from.pos;
  const from = to - (query.length + 1);
  const coords = editor.view.coordsAtPos(to);
  return { query, from, to, top: coords.bottom + 6, left: coords.left };
}

export interface SlashMenuController {
  /** Call from the editor's onBlur. */
  close: () => void;
  filtered: SlashCommand[];
  /** Call first inside editorProps.handleKeyDown — returns true if handled. */
  handleKeyDown: (event: KeyboardEvent) => boolean;
  menuRef: React.RefObject<HTMLDivElement | null>;
  /** Call from the editor's onUpdate / onSelectionUpdate. */
  refresh: (editor: Editor) => void;
  selectCommand: (cmd: SlashCommand) => void;
  selectedIndex: number;
  /** Wire the live editor instance (after useEditor). */
  setEditor: (editor: Editor | null) => void;
  setSelectedIndex: (i: number) => void;
  slash: SlashState | null;
}

export function useSlashCommands(
  commands: SlashCommand[]
): SlashMenuController {
  const [slash, setSlash] = React.useState<SlashState | null>(null);
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  const filtered = React.useMemo(() => {
    if (!slash) {
      return [];
    }
    const q = slash.query.toLowerCase();
    if (!q) {
      return commands;
    }
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.keywords.includes(q)
    );
  }, [slash, commands]);

  const editorRef = React.useRef<Editor | null>(null);
  const slashRef = React.useRef<SlashState | null>(slash);
  const filteredRef = React.useRef<SlashCommand[]>(filtered);
  const selectedIndexRef = React.useRef(selectedIndex);
  const selectRef = React.useRef<(cmd: SlashCommand) => void>(() => {});
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    slashRef.current = slash;
  }, [slash]);
  React.useEffect(() => {
    filteredRef.current = filtered;
  }, [filtered]);
  React.useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);
  // Reset the highlight whenever the query changes (dep is an intentional trigger).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on query change
  React.useEffect(() => {
    setSelectedIndex(0);
  }, [slash?.query]);
  // Keep the highlighted command in view during keyboard navigation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on selection change
  React.useEffect(() => {
    if (!slash) {
      return;
    }
    menuRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, slash]);

  // Dismiss like a modern editor: close on outside click, on page/container
  // scroll, and on resize — so no orphaned menu is left floating.
  const slashActive = slash !== null;
  React.useEffect(() => {
    if (!slashActive) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) {
        return;
      }
      // Ignore clicks inside the menu or the editor itself.
      if (menuRef.current?.contains(t)) {
        return;
      }
      const dom = editorRef.current?.view.dom;
      if (dom?.contains(t)) {
        return;
      }
      setSlash(null);
    };
    const onScroll = (e: Event) => {
      // The menu's own internal scroll shouldn't dismiss it.
      const t = e.target as Node | null;
      if (t && menuRef.current?.contains(t)) {
        return;
      }
      setSlash(null);
    };
    const onResize = () => setSlash(null);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [slashActive]);

  const selectCommand = React.useCallback((cmd: SlashCommand) => {
    const editor = editorRef.current;
    const s = slashRef.current;
    if (!editor || !s) {
      return;
    }
    editor.chain().focus().deleteRange({ from: s.from, to: s.to }).run();
    cmd.run(editor);
    setSlash(null);
  }, []);
  React.useEffect(() => {
    selectRef.current = selectCommand;
  }, [selectCommand]);

  const refresh = React.useCallback((editor: Editor) => {
    setSlash(computeSlash(editor));
  }, []);
  const close = React.useCallback(() => setSlash(null), []);
  const setEditor = React.useCallback((editor: Editor | null) => {
    editorRef.current = editor;
  }, []);

  const handleKeyDown = React.useCallback((event: KeyboardEvent): boolean => {
    const s = slashRef.current;
    const list = filteredRef.current;
    if (!s || list.length === 0) {
      return false;
    }
    // Two-column grid navigation (←/→ within a row, ↑/↓ across rows).
    if (event.key === "ArrowRight") {
      setSelectedIndex((i) => Math.min(i + 1, list.length - 1));
      return true;
    }
    if (event.key === "ArrowLeft") {
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return true;
    }
    if (event.key === "ArrowDown") {
      setSelectedIndex((i) => Math.min(i + 2, list.length - 1));
      return true;
    }
    if (event.key === "ArrowUp") {
      setSelectedIndex((i) => Math.max(i - 2, 0));
      return true;
    }
    if (event.key === "Enter") {
      const cmd = list[selectedIndexRef.current];
      if (cmd) {
        selectRef.current(cmd);
      }
      return true;
    }
    if (event.key === "Escape") {
      setSlash(null);
      return true;
    }
    return false;
  }, []);

  return {
    slash,
    filtered,
    selectedIndex,
    setSelectedIndex,
    selectCommand,
    menuRef,
    refresh,
    close,
    handleKeyDown,
    setEditor,
  };
}

export function SlashCommandMenu({ menu }: { menu: SlashMenuController }) {
  const {
    slash,
    filtered,
    selectedIndex,
    setSelectedIndex,
    selectCommand,
    menuRef,
  } = menu;
  const open = !!slash && filtered.length > 0;
  // Keep the menu within the viewport (the caret can be near the right/bottom
  // edge, e.g. inside the narrow activity panel). Measure then clamp/flip.
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(
    null
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: reclamp on open/content change
  React.useLayoutEffect(() => {
    if (!(open && slash)) {
      setPos(null);
      return;
    }
    const el = menuRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const m = 8;
    let left = slash.left;
    if (left + rect.width > window.innerWidth - m) {
      left = window.innerWidth - rect.width - m;
    }
    left = Math.max(m, left);
    let top = slash.top;
    if (top + rect.height > window.innerHeight - m) {
      // Flip above the caret line if it fits there, otherwise clamp upward.
      const above = slash.top - rect.height - 28;
      top =
        above > m ? above : Math.max(m, window.innerHeight - rect.height - m);
    }
    setPos({ top, left });
  }, [open, slash, filtered.length, menuRef]);

  if (!(open && slash)) {
    return null;
  }
  return (
    <div
      className="fixed z-50 w-110 max-w-[calc(100vw-2rem)] max-h-80 overflow-y-auto overscroll-contain rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg"
      ref={menuRef}
      style={{
        top: pos?.top ?? slash.top,
        left: pos?.left ?? slash.left,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <SlashCommandGrid
        commands={filtered}
        selectedIndex={selectedIndex}
        onSelect={selectCommand}
        onHover={setSelectedIndex}
      />
    </div>
  );
}

// Two-column grid of command cards. Shared by the "/" menu and the composer's
// "+" formatting menu so they look identical.
export function SlashCommandGrid({
  commands,
  selectedIndex,
  onSelect,
  onHover,
}: {
  commands: SlashCommand[];
  selectedIndex?: number;
  onSelect: (cmd: SlashCommand) => void;
  onHover?: (i: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {commands.map((cmd, i) => {
        const Icon = cmd.icon;
        const active = i === selectedIndex;
        return (
          <button
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
              active ? "bg-accent" : "hover:bg-accent/60"
            )}
            data-active={active}
            key={cmd.key}
            onClick={() => onSelect(cmd)}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHover?.(i)}
            type="button"
          >
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-md border bg-background transition-colors",
                active
                  ? "border-primary/40 text-primary"
                  : "border-border text-muted-foreground"
              )}
            >
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium leading-tight text-foreground">
                {cmd.label}
              </span>
              <span className="block truncate text-2xs leading-tight text-muted-foreground">
                {cmd.desc}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
