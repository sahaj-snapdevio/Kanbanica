"use client";

import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import * as React from "react";
import { cn } from "@/lib/utils";

interface TaskDescriptionEditorProps {
  className?: string;
  onChange: (json: string) => void;
  onSave?: () => void;
  placeholder?: string;
  value: string;
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
      className={cn(
        "flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

export function TaskDescriptionEditor({
  value,
  onChange,
  onSave,
  placeholder = "Add a description…",
  className,
}: TaskDescriptionEditorProps) {
  const [focused, setFocused] = React.useState(false);

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
      if (!value) {
        return "";
      }
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    })(),
    onUpdate: ({ editor }) => {
      onChange(JSON.stringify(editor.getJSON()));
    },
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      onSave?.();
    },
    editorProps: {
      attributes: {
        class: "focus:outline-none min-h-[80px] px-0 py-1 tiptap-content",
      },
    },
    immediatelyRender: false,
  });

  // Sync external value when taskId changes
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    const current = JSON.stringify(editor.getJSON());
    if (current !== value && value) {
      try {
        editor.commands.setContent(JSON.parse(value), { emitUpdate: false });
      } catch {
        editor.commands.setContent(value, { emitUpdate: false });
      }
    }
  }, [value, editor]);

  if (!editor) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-lg border bg-card transition-all",
        focused ? "border-primary/50 ring-1 ring-primary/20" : "border-border",
        className
      )}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5">
        {/* Undo / Redo */}
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          title="Undo (Ctrl+Z)"
        >
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              d="M3 10h10a4 4 0 0 1 0 8H9m-6-8 3-3-3-3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          title="Redo (Ctrl+Y)"
        >
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              d="M21 10H11a4 4 0 0 0 0 8h4m6-8-3-3 3-3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </ToolbarButton>

        <div className="mx-1.5 h-4 w-px bg-border shrink-0" />

        {/* Text formatting */}
        <ToolbarButton
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold (Ctrl+B)"
        >
          <span className="font-bold text-sm leading-none">B</span>
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic (Ctrl+I)"
        >
          <span className="italic font-serif text-sm leading-none">I</span>
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Underline (Ctrl+U)"
        >
          <span className="underline text-sm leading-none">U</span>
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Strikethrough"
        >
          <span className="line-through text-sm leading-none">S</span>
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("code")}
          onClick={() => editor.chain().focus().toggleCode().run()}
          title="Inline code"
        >
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              d="m16 18 6-6-6-6M8 6l-6 6 6 6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </ToolbarButton>

        <div className="mx-1.5 h-4 w-px bg-border shrink-0" />

        {/* Lists */}
        <ToolbarButton
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bullet list"
        >
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Numbered list"
        >
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              d="M10 6h11M10 12h11M10 18h11M4 6h1V4H4l-1 1.5L4 7h1M4 12v-2l1.5-1-1.5-.5v-1H4M4 19v-1h2v-1H4l2-2v-1H4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("taskList")}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          title="Task list"
        >
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <rect height="4" rx="0.5" width="4" x="3" y="5" />
            <path
              d="m4 7 1 1 1.5-1.5M10 7h11M10 13h11M10 19h11"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect height="4" rx="0.5" width="4" x="3" y="11" />
            <rect height="4" rx="0.5" width="4" x="3" y="17" />
          </svg>
        </ToolbarButton>

        <div className="mx-1.5 h-4 w-px bg-border shrink-0" />

        {/* Headings */}
        {([1, 2, 3] as const).map((level) => (
          <ToolbarButton
            active={editor.isActive("heading", { level })}
            key={level}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level }).run()
            }
            title={`Heading ${level}`}
          >
            <span className="text-xs font-bold">H{level}</span>
          </ToolbarButton>
        ))}

        <div className="mx-1.5 h-4 w-px bg-border shrink-0" />

        {/* Align */}
        <ToolbarButton
          active={editor.isActive({ textAlign: "left" })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          title="Align left"
        >
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path d="M3 6h18M3 12h12M3 18h15" strokeLinecap="round" />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          title="Align center"
        >
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path d="M3 6h18M6 12h12M4.5 18h15" strokeLinecap="round" />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive({ textAlign: "right" })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          title="Align right"
        >
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path d="M3 6h18M9 12h12M6 18h15" strokeLinecap="round" />
          </svg>
        </ToolbarButton>

        <div className="mx-1.5 h-4 w-px bg-border shrink-0" />

        {/* Extras */}
        <ToolbarButton
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          title="Code block"
        >
          <span className="text-xs font-mono leading-none">{"</>"}</span>
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Blockquote"
        >
          <svg className="size-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z" />
          </svg>
        </ToolbarButton>
      </div>

      {/* Editor canvas */}
      <div className="px-4 py-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
