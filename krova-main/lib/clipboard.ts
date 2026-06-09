"use client";

import { toast } from "sonner";

/**
 * Copy `text` to the user's clipboard and fire a success / error toast.
 * Returns true on success, false otherwise (caller can chain additional
 * stateful behavior — e.g. a transient checkmark — off the boolean).
 *
 * Centralizes the navigator.clipboard.writeText + toast pattern that was
 * previously re-implemented in ~13 components. Prefer the `<CopyButton>`
 * component in `components/copy-button.tsx` for icon-button UIs; reach for
 * this helper only when you need to copy from a non-button affordance
 * (e.g. an inline "Copy URL" link inside a sheet).
 */
export async function copyToClipboard(
  text: string,
  successMessage = "Copied"
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
    return true;
  } catch {
    toast.error("Copy failed");
    return false;
  }
}
