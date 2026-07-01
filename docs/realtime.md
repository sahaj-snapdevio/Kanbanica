# Real-time Sync (SSE)

Live collaboration: when one member changes something, other members viewing the same
workspace see it without a manual refresh. Built on the existing SSE channel
(`lib/sse-clients.ts` + `/api/me/notifications/stream`).

## Flow

```
mutation (server action / route handler)
  └─ refreshWorkspace(workspaceId, paths?)      lib/realtime/refresh.ts
       ├─ revalidatePath(...)                    (Next cache — data is fresh on next fetch)
       └─ broadcastDataChanged(workspaceId)      lib/realtime/broadcast.ts
            └─ pushToUser(userId, { type:"data_changed", workspaceId, v:1 })   lib/sse-clients.ts
                 └─ EventSource → RealtimeProvider   components/realtime/realtime-provider.tsx
                      ├─ router.refresh()            → List, Board, sidebar (server-rendered)
                      └─ subscribers → fetchData()   → Sprint (client-fetched via useRealtimeRefetch)
```

- **List / Board / sidebar** are server-rendered, so `router.refresh()` re-pulls them.
- **Sprint** is client-fetched (`getActiveSprintView`), so it subscribes with
  `useRealtimeRefetch(() => fetchData())`.

## Rule: one post-mutation chokepoint

Every mutation (server action **and** route handler) must call
**`refreshWorkspace(workspaceId, paths?)`** after writing. It pairs the Next cache
revalidation with the broadcast so they never drift.

- **Never call `broadcastDataChanged()` directly** from new code.
- The per-file `revalidate*` helpers (in `app/actions/task.ts`, `sprint.ts`, etc.) delegate to
  `refreshWorkspace`, so existing call sites are unchanged.
- Adding a new mutation = call `refreshWorkspace(...)` at the end. Nothing else.

## Gotcha: the SSE client registry must live on `globalThis`

`lib/sse-clients.ts` pins its `clients` map to `globalThis`:

```ts
const clients = ((globalThis as ...).__sseClients ??= new Map());
```

**Why:** Turbopack bundles **route handlers** and **server actions / RSC** into *separate module
graphs*. A plain module-level `const clients = new Map()` is therefore **duplicated** — the SSE
route (`/api/me/notifications/stream`) registers connections in one copy, while `pushToUser`
(called from server actions) reads a *different, empty* copy. Symptom: everything looks correct
(`registerClient` shows connections) but `pushToUser` finds none and no live update/notification
ever arrives.

**Takeaway:** any in-memory singleton shared between route handlers and actions/RSC must use the
same `globalThis` pattern (this is the same reason the DB client is a `globalThis` singleton).

## Client behavior (`RealtimeProvider`)

Mounted once per workspace (`app/(app)/[workspaceId]/layout.tsx`). Opens **one** `EventSource`
and, on a `data_changed` event for the current workspace:

- **Debounce ~600ms** and coalesce a burst of events into a single refresh.
- **Pause-while-busy** — defer the refresh (never clobber the user) while any of: a focused
  `<input>/<textarea>/[contenteditable]`, an open Dialog/Dropdown/Select/Popover/Command menu, or
  an active drag. Flush once idle. DnD contexts bracket a drag with `useRealtimePause()` →
  `pause()`/`resume()` in `onDragStart`/`onDragEnd`/`onDragCancel`.
- **Skip inactive tabs** (`document.hidden`) and re-check the workspace at flush time (drop if the
  user navigated to a different workspace).
- **Reconnect** with exponential backoff (1s → 30s) so updates resume after sleep/drop.

## Constraints & notes

- The SSE registry is **in-memory, per Node process**. Fine for local dev and a single prod
  instance; multi-instance production needs a shared pub/sub (e.g. Redis) behind `pushToUser`.
- Granularity is **workspace-level** (any change in the workspace refreshes the current view).
- **Notifications delivery is separate:** the notification *bell* component is currently
  unmounted, so the Inbox and sidebar badge refresh via **SWR polling** (15s / 30s), not SSE.
  `RealtimeProvider` only reacts to `data_changed` (not `new_notification`).
