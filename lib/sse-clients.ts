const encoder = new TextEncoder();
const clients = new Map<string, Set<ReadableStreamDefaultController>>();

export function registerClient(userId: string, ctrl: ReadableStreamDefaultController): void {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId)!.add(ctrl);
}

export function unregisterClient(userId: string, ctrl: ReadableStreamDefaultController): void {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(ctrl);
  if (set.size === 0) clients.delete(userId);
}

// Push a JSON event to all open SSE connections for a user.
// Silently ignores users with no active connection.
export function pushToUser(userId: string, data: object): void {
  const set = clients.get(userId);
  if (!set || set.size === 0) return;
  const payload = encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  for (const ctrl of set) {
    try {
      ctrl.enqueue(payload);
    } catch {
      // controller already closed — will be cleaned up on cancel/abort
    }
  }
}
