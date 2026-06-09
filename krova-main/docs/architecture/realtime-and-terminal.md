# Real-time, Reachability & Browser Terminal

> On-demand detail extracted from CLAUDE.md. CLAUDE.md keeps only a short summary + a pointer to this file; the full reference lives here.

### Real-time (Pusher/Soketi)

Channels: `private-cube-{cubeId}`, `private-space-{spaceId}`, `private-server-{serverId}` (admin only), `presence-terminal-{sessionId}` (browser terminal — per-session, single-user). Auth via `/api/pusher/auth`. Supports Soketi self-hosted (when `PUSHER_HOST` is set) and Pusher cloud (when `PUSHER_CLUSTER` is set).

### Cube reachability & live metrics

Three layers of health on every running cube, observed by the `cube.reachability` cron (every 1 min, batched 10 servers concurrent — same SSH-per-server pattern as `cube.state-sync`):

- **L1 — vsock agent ping**: TCP `CONNECT 52` + `{"cmd":"ping"}` to the in-guest `krova-agent`. Proves the guest kernel and userspace are alive. Hung kernel / OOM-killed agent / cloud-init still running → fails.
- **L2 — SSH port reachability**: host-side `bash -c 'exec 3<>/dev/tcp/<cubeInternalIp>/<cubeSshPort>'` directly against the cube's bridge IP, where `<cubeSshPort>` is read live from the `isSsh=true` row in `tcp_port_mappings` (see Rule 47). Proves the bridge route + sshd are healthy inside the cube. Uses bash's built-in `/dev/tcp` so there's zero tool dependency on the host (the previous `nc -z` implementation silently failed for the lifetime of the feature because `nc` was never installed). When the customer changes sshd's port inside the cube and updates us via `PUT /ssh-port`, the cron's next tick automatically probes the new port — no hardcoding of `22`.
- **L3 — guest metrics snapshot**: `{"cmd":"metrics"}` against the same agent. Returns uptime, load 1/5/15, CPU% (user/system/idle from a ~100ms `/proc/stat` delta), MemTotal/MemAvailable, and `statvfs("/")` totals. Stored as JSONB on the cube row alongside the reachability snapshot.

The cron writes three columns on `cubes`: `last_reachability_at` (indexed for staleness queries), `reachability_jsonb` (`{agentOk, sshOk, lastAgentSeenAt, lastSshSeenAt}`), and `last_metrics_jsonb` (collected snapshot + ISO `collectedAt`). The `lastAgentSeenAt`/`lastSshSeenAt` fields preserve the most recent successful timestamp across failed ticks so the UI can show "Agent unresponsive — last seen 3m ago".

The cron is a **pure observer**: never transitions `cubes.status`, never bumps `updatedAt`. State changes still flow through `cube.state-sync` and the explicit lifecycle handlers. It also fires Pusher `cube.reachability` events on `private-cube-{cubeId}` for snappy UI updates, with a 60s SWR fallback through the existing cube GET endpoint.

Older agents that lack the `metrics` verb degrade gracefully — the JSON-parsed `{status: "error", message: "unknown command: metrics"}` becomes a null in `guestMetrics()` and the UI shows the badge without the metrics grid until the image is rebuilt + servers run "Update Images".

The reachability snapshot + metrics surface as a **Live status** card at the top of the cube detail page sidebar ([components/cube-live-status-card.tsx](components/cube-live-status-card.tsx)), driven by [hooks/use-cube-reachability.ts](hooks/use-cube-reachability.ts). Tri-state badge (Healthy / SSH unreachable / Agent unresponsive) + metrics grid (uptime, load, CPU%, RAM used/total, disk used/total). Only rendered when `cube.status === "running"`.

### Browser terminal (xterm.js + vsock PTY through Soketi)

Customers with `cube.manage` can open a full-viewport xterm.js terminal directly in the browser — dedicated route at `/[spaceId]/cubes/[cubeId]/terminal`, opened in a new tab from the **Terminal** button in the cube detail header. The page lives under a separate `app/(terminal)/` route group so it escapes the dashboard chrome; auth gating duplicates the cube-page checks (membership + `cube.manage` + `cube.access`).

**Wire path (browser-only at the customer's edge, everything else server-internal):**

```text
browser xterm.js
   ⇅ pusher-js                     presence-terminal-{sessionId}    (Soketi)
worker bridge process              cube.terminal-bridge pg-boss job
   ⇅ ssh2 client.exec()             /usr/local/bin/krova-vsock-pty <vsock.sock> <cols> <rows>
bare-metal host (Python helper, transparent passthrough)
   ⇅ Firecracker vsock UDS         CONNECT 52
in-guest krova-agent                 {"cmd":"pty",...} → pty.fork() /bin/bash -il
```

**Framed binary protocol** between the worker bridge and the in-guest agent (the host-side helper is intentionally framing-blind so the wire can evolve without rolling new hosts):

- 5-byte header: `[type:uint8][length:big-endian uint32]`, then `length` bytes of payload.
- `0x01` STDIN (worker → guest) — raw keystrokes from `xterm.onData`, base64-encoded over Pusher `client-stdin`.
- `0x02` STDOUT (guest → worker) — raw PTY output. The bridge chunks at `STDOUT_PUBLISH_MAX_BYTES` (64 KB) to fit Soketi's per-event payload cap.
- `0x03` RESIZE (worker → guest) — JSON `{cols, rows}`. The agent calls `TIOCSWINSZ` on the PTY master.
- `0x04` EXIT (guest → worker) — JSON `{exitCode}` then the connection closes.

**Lifecycle state machine** on `cube_terminal_sessions`:

```text
pending  → row inserted by the API; worker bridge has not claimed it yet.
running  → bridge atomically claimed (pending → running) and owns the SSH + vsock.
ended    → customer closed cleanly via the close API or the bridge saw exit.
failed   → bridge errored before delivering bytes (SSH refused, helper missing).
expired  → idle / hard timeout fired and the bridge tore down.
```

**Teardown triggers** (any one of them fires `cube.terminal-bridge` cleanup):

1. SSH stream closes (helper exited, shell died, cube vanished).
2. `cube_terminal_sessions.status` moves out of `running` (the close API does this) — bridge polls every 5s.
3. `cubes.status` moves out of `running` (sleep / transfer / delete) — same 5s poll.
4. Idle timeout — `TERMINAL_SESSION_IDLE_MS` (default 15 min) since last stdin OR stdout activity.
5. Hard timeout — `TERMINAL_SESSION_HARD_MS` (default 4 h) since the bridge started.
6. Pusher subscription error (e.g. the channel was force-vacated).

The pg-boss `expireInSeconds` budget for the bridge is `TERMINAL_BRIDGE_EXPIRE_SECONDS` (4h + 5min safety margin); past the hard timeout, pg-boss would kill the handler anyway. `retryLimit: 0` because resuming an in-flight PTY across worker restarts is impossible — the browser reconnects with a fresh session id.

**Pusher channel auth** for `presence-terminal-{sessionId}` checks: (a) the session row exists; (b) the connecting user IS the session's opener (defense in depth on top of the API's `cube.manage` check); (c) status is `pending` or `running`. The worker bridge subscribes as a server-side pusher-js client with a custom authorizer that signs the auth response inline using `PUSHER_SECRET` (no HTTP round-trip to `/api/pusher/auth`), using a synthetic `user_id: bridge-{sessionId}` distinct from the browser's id.

**Soketi app-config requirements** (operator must update the Soketi app row / env / dashboard before the terminal works — these are per-app fields on the App interface in [Soketi src/app.ts](https://github.com/soketi/soketi/blob/master/src/app.ts)):

- **`enableClientMessages: true`** — REQUIRED. Soketi defaults to false on the default app and silently drops `client-*` events without it. Without this set, the browser's `client-stdin` / `client-resize` triggers never reach the worker bridge.
- **`maxEventPayloadInKb`** — raise to at least 100 KB. The bridge already chunks stdout to fit `STDOUT_PUBLISH_MAX_BYTES` (64 KB raw → ~85 KB once base64-encoded into the `{b64: "..."}` envelope), so 100 KB is the floor; 256 KB gives comfortable headroom.
- **`maxClientEventsPerSecond`** — raise to at least 100. Default 10/sec is plenty for typing but is hit immediately when the customer pastes a multi-line script (1 paste = multiple bursty `client-stdin` events). 100/sec covers normal interactive use.
- **`maxBackendEventsPerSecond`** — raise to at least 100. The worker uses the server SDK (`getPusherServer().trigger`) for every stdout chunk; a noisy command like `find / | head -1000` produces dozens of triggers per second. 100/sec is the floor; for verbose customers consider 500/sec.

**Host helper deployment.** New servers get `/usr/local/bin/krova-vsock-pty` during the `install` setup phase ([lib/worker/handlers/server-install.ts](lib/worker/handlers/server-install.ts) "deploy krova-vsock-pty helper" step — best-effort, logs a warning rather than failing the phase if the source file is missing in the worker container). Existing servers retrofit via `pnpm install:vsock-pty`. **Image rebuild required** for the in-guest `pty` verb — the updated `setup/images/krova-agent` Python script ships in the rootfs, so existing cubes need an image refresh (run `pnpm build:images`, then "Update Images" on each server) before a terminal session works for cubes booted from the old rootfs.

