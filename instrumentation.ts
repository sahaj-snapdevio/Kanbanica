import type { Instrumentation } from "next";

function formatError(err: unknown): string {
  const lines: string[] = [];
  let current: unknown = err;
  let depth = 0;
  const seen = new Set<unknown>();

  while (current && !seen.has(current) && depth < 5) {
    seen.add(current);
    const prefix = depth === 0 ? "" : "  caused by: ";

    if (current instanceof Error) {
      const digest = (current as Error & { digest?: string }).digest;
      const code = (current as Error & { code?: string }).code;
      const tag = [
        current.name,
        digest ? `digest=${digest}` : null,
        code ? `code=${code}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      lines.push(`${prefix}${tag}: ${current.message}`);
      if (current.stack) {
        const stackBody = current.stack
          .split("\n")
          .slice(1)
          .map((l) => "    " + l.trim())
          .join("\n");
        if (stackBody) {
          lines.push(stackBody);
        }
      }
      current = (current as Error).cause;
    } else {
      lines.push(`${prefix}${String(current)}`);
      current = null;
    }
    depth++;
  }

  return lines.join("\n");
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  const err = error instanceof Error ? error : new Error(String(error));

  console.error(
    `[server-error] ${request.method ?? "?"} ${request.path ?? "?"} ` +
      `routerKind=${context.routerKind} routeType=${context.routeType} ` +
      `routePath=${context.routePath ?? "?"}\n` +
      formatError(err)
  );
};
