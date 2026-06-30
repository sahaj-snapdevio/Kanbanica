"use client";

import * as React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  CodeBlockIcon,
  CodeIcon,
  ListBulletsIcon,
  ListChecksIcon,
  ListNumbersIcon,
  QuotesIcon,
  TextBIcon,
  TextHOneIcon,
  TextHThreeIcon,
  TextHTwoIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  TextUnderlineIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  SlashCommandMenu,
  useSlashCommands,
  type SlashCommand,
} from "@/components/task/slash-command-menu";

interface TaskDescriptionEditorProps {
  value: string;
  onChange: (json: string) => void;
  onSave?: () => void;
  placeholder?: string;
  className?: string;
}

function ToolbarButton({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(
        "flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// ─── Slash commands ───────────────────────────────────────────────────────────
// Every command maps to an action that already exists in the toolbar above —
// the menu (see slash-command-menu.tsx) is just a faster way to invoke them.
// Ordered so related commands sit together (Headings · Lists · Blocks · Text).
const SLASH_COMMANDS: SlashCommand[] = [
  { key: "h1", label: "Heading 1", desc: "Large section heading", keywords: "h1 heading title", icon: TextHOneIcon, run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { key: "h2", label: "Heading 2", desc: "Medium heading", keywords: "h2 heading", icon: TextHTwoIcon, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { key: "h3", label: "Heading 3", desc: "Small heading", keywords: "h3 heading", icon: TextHThreeIcon, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { key: "bulletList", label: "Bullet list", desc: "Unordered list", keywords: "bullet unordered list ul", icon: ListBulletsIcon, run: (e) => e.chain().focus().toggleBulletList().run() },
  { key: "orderedList", label: "Numbered list", desc: "Ordered list", keywords: "numbered ordered list ol", icon: ListNumbersIcon, run: (e) => e.chain().focus().toggleOrderedList().run() },
  { key: "taskList", label: "Task list", desc: "Checklist with checkboxes", keywords: "task todo checklist checkbox", icon: ListChecksIcon, run: (e) => e.chain().focus().toggleTaskList().run() },
  { key: "blockquote", label: "Quote", desc: "Block quote", keywords: "quote blockquote", icon: QuotesIcon, run: (e) => e.chain().focus().toggleBlockquote().run() },
  { key: "codeBlock", label: "Code block", desc: "Code snippet", keywords: "code block", icon: CodeBlockIcon, run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { key: "bold", label: "Bold", desc: "Bold text", keywords: "bold strong", icon: TextBIcon, run: (e) => e.chain().focus().toggleBold().run() },
  { key: "italic", label: "Italic", desc: "Italic text", keywords: "italic emphasis", icon: TextItalicIcon, run: (e) => e.chain().focus().toggleItalic().run() },
  { key: "underline", label: "Underline", desc: "Underlined text", keywords: "underline", icon: TextUnderlineIcon, run: (e) => e.chain().focus().toggleUnderline().run() },
  { key: "strike", label: "Strikethrough", desc: "Crossed-out text", keywords: "strike strikethrough", icon: TextStrikethroughIcon, run: (e) => e.chain().focus().toggleStrike().run() },
  { key: "code", label: "Inline code", desc: "Inline code", keywords: "inline code", icon: CodeIcon, run: (e) => e.chain().focus().toggleCode().run() },
];

export function TaskDescriptionEditor({
  value,
  onChange,
  onSave,
  placeholder = "Add a description… Type '/' for commands",
  className,
}: TaskDescriptionEditorProps) {
  const [focused, setFocused] = React.useState(false);
  const slashMenu = useSlashCommands(SLASH_COMMANDS);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      Placeholder.configure({ placeholder }),
      Underline,
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: (() => {
      if (!value) return "";
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    })(),
    onUpdate: ({ editor }) => {
      onChange(JSON.stringify(editor.getJSON()));
      slashMenu.refresh(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      slashMenu.refresh(editor);
    },
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      slashMenu.close();
      onSave?.();
    },
    editorProps: {
      attributes: {
        class:
          "focus:outline-none min-h-[80px] px-0 py-1 tiptap-content",
      },
      handleKeyDown: (_view, event) => slashMenu.handleKeyDown(event),
    },
    immediatelyRender: false,
  });

  React.useEffect(() => { slashMenu.setEditor(editor); }, [editor, slashMenu]);

  // Sync external value when taskId changes
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = JSON.stringify(editor.getJSON());
    if (current !== value && value) {
      try {
        editor.commands.setContent(JSON.parse(value), { emitUpdate: false });
      } catch {
        editor.commands.setContent(value, { emitUpdate: false });
      }
    }
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card transition-all",
        focused ? "border-primary/50 ring-1 ring-primary/20" : "border-border",
        className,
      )}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5">
        {/* Undo / Redo */}
        <ToolbarButton title="Undo (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()}>
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a4 4 0 0 1 0 8H9m-6-8 3-3-3-3" />
          </svg>
        </ToolbarButton>
        <ToolbarButton title="Redo (Ctrl+Y)" onClick={() => editor.chain().focus().redo().run()}>
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a4 4 0 0 0 0 8h4m6-8-3-3 3-3" />
          </svg>
        </ToolbarButton>

        <div className="mx-1.5 h-4 w-px bg-border shrink-0" />

        {/* Text formatting */}
        <ToolbarButton title="Bold (Ctrl+B)" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <span className="font-bold text-sm leading-none">B</span>
        </ToolbarButton>
        <ToolbarButton title="Italic (Ctrl+I)" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <span className="italic font-serif text-sm leading-none">I</span>
        </ToolbarButton>
        <ToolbarButton title="Underline (Ctrl+U)" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <span className="underline text-sm leading-none">U</span>
        </ToolbarButton>
        <ToolbarButton title="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <span className="line-through text-sm leading-none">S</span>
        </ToolbarButton>
        <ToolbarButton title="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
          </svg>
        </ToolbarButton>

        <div className="mx-1.5 h-4 w-px bg-border shrink-0" />

        {/* Lists */}
        <ToolbarButton title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
        </ToolbarButton>
        <ToolbarButton title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6h11M10 12h11M10 18h11M4 6h1V4H4l-1 1.5L4 7h1M4 12v-2l1.5-1-1.5-.5v-1H4M4 19v-1h2v-1H4l2-2v-1H4" />
          </svg>
        </ToolbarButton>
        <ToolbarButton title="Task list" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="3" y="5" width="4" height="4" rx="0.5" />
            <path strokeLinecap="round" strokeLinejoin="round" d="m4 7 1 1 1.5-1.5M10 7h11M10 13h11M10 19h11" />
            <rect x="3" y="11" width="4" height="4" rx="0.5" />
            <rect x="3" y="17" width="4" height="4" rx="0.5" />
          </svg>
        </ToolbarButton>

        <div className="mx-1.5 h-4 w-px bg-border shrink-0" />

        {/* Headings */}
        {([1, 2, 3] as const).map((level) => (
          <ToolbarButton
            key={level}
            title={`Heading ${level}`}
            active={editor.isActive("heading", { level })}
            onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          >
            <span className="text-xs font-bold">H{level}</span>
          </ToolbarButton>
        ))}

        <div className="mx-1.5 h-4 w-px bg-border shrink-0" />

        {/* Align */}
        <ToolbarButton title="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M3 6h18M3 12h12M3 18h15" />
          </svg>
        </ToolbarButton>
        <ToolbarButton title="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M3 6h18M6 12h12M4.5 18h15" />
          </svg>
        </ToolbarButton>
        <ToolbarButton title="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M3 6h18M9 12h12M6 18h15" />
          </svg>
        </ToolbarButton>

        <div className="mx-1.5 h-4 w-px bg-border shrink-0" />

        {/* Extras */}
        <ToolbarButton title="Code block" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
          <span className="text-xs font-mono leading-none">{"</>"}</span>
        </ToolbarButton>
        <ToolbarButton title="Blockquote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <svg className="size-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z" />
          </svg>
        </ToolbarButton>
      </div>

      {/* Editor canvas */}
      <div className="px-4 py-3">
        <EditorContent editor={editor} />
      </div>

      {/* Slash command menu */}
      <SlashCommandMenu menu={slashMenu} />
    </div>
  );
}
