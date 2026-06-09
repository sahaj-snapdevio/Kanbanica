/**
 * Layout for the dedicated browser-terminal route group. Deliberately
 * minimal — no nav, no sidebar, no analytics-tracked page transitions —
 * so the customer can drop into a full-viewport xterm.js session that
 * mirrors the experience of a native terminal.
 *
 * The root layout in app/layout.tsx still wraps this (html/body/fonts/
 * providers), but everything below it is left to the page component.
 */
export default function TerminalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="h-dvh w-dvw overflow-hidden bg-black">{children}</div>;
}
