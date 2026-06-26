import { auth } from "@/lib/auth";
import { registerClient, unregisterClient } from "@/lib/sse-clients";

const encoder = new TextEncoder();

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const userId = session.user.id;
  // eslint-disable-next-line prefer-const
  let ctrl!: ReadableStreamDefaultController;
  let keepalive: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      ctrl = controller;
      registerClient(userId, ctrl);
      // Confirm connection to the client
      ctrl.enqueue(encoder.encode(": connected\n\n"));
      // Keep-alive ping every 25s to prevent proxy/load-balancer timeouts
      keepalive = setInterval(() => {
        try {
          ctrl.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(keepalive);
        }
      }, 25_000);
    },
    cancel() {
      clearInterval(keepalive);
      unregisterClient(userId, ctrl);
    },
  });

  // Also clean up on request abort (browser tab closed / navigated away)
  req.signal.addEventListener("abort", () => {
    clearInterval(keepalive);
    unregisterClient(userId, ctrl);
    try { ctrl.close(); } catch { /* already closed */ }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering
    },
  });
}
