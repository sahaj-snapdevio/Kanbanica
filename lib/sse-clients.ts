const encoder = new TextEncoder();

// The SSE route handler and server actions get bundled into SEPARATE module
// graphs by Turbopack, so a plain module-level `new Map()` is duplicated — the
// route registers connections in one copy while `pushToUser` (called from
// server actions) reads an empty second copy. Pin the registry to `globalThis`
// so every module instance in the process shares ONE map. (Same pattern used
// for the DB client singleton.)
const globalForSse = globalThis as unknown as {
  __sseClients?: Map<string, Set<ReadableStreamDefaultController>>;
};
const clients: Map<string, Set<ReadableStreamDefaultController>> =
  (globalForSse.__sseClients ??= new Map());

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
