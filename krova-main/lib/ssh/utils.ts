/**
 * Escapes a value for safe use in single-quoted shell strings.
 * Handles the edge case where the value itself contains single quotes.
 */
export function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
