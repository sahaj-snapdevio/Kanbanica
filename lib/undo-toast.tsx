"use client";

import { toast } from "sonner";

/**
 * Show a toast with an "Undo" action that can also be triggered with Ctrl/Cmd+Z
 * while the toast is visible. Used for reversible actions like archive/unarchive.
 *
 * The Ctrl+Z shortcut is ignored while focus is in an input, textarea, or
 * contentEditable (e.g. the Tiptap editor) so it never hijacks native undo.
 */
export function toastWithUndo(message: string, onUndo: () => void | Promise<void>) {
  let toastId: string | number = "";
  let done = false;

  const cleanup = () => window.removeEventListener("keydown", onKey);

  const run = () => {
    if (done) return;
    done = true;
    cleanup();
    toast.dismiss(toastId);
    void onUndo();
  };

  function onKey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (e.key !== "z" && e.key !== "Z") return;

    const el = document.activeElement as HTMLElement | null;
    if (
      el &&
      (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
    ) {
      return;
    }

    e.preventDefault();
    run();
  }

  window.addEventListener("keydown", onKey);

  toastId = toast(message, {
    duration: 6000,
    onDismiss: cleanup,
    onAutoClose: cleanup,
    action: {
      label: (
        <span className="flex items-center gap-1.5 font-medium">
          Undo
          <kbd className="rounded border border-current/40 px-1 py-px text-2xs font-medium opacity-70">
            Ctrl Z
          </kbd>
        </span>
      ),
      onClick: run,
    },
  });

  return toastId;
}
