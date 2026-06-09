/**
 * Long-lived bridge between the browser xterm.js terminal and the Cube's
 * in-guest PTY. Owns one terminal session at a time.
 *
 * Wire path:
 *   browser xterm.js
 *     ↓ pusher-js (Soketi)         presence-terminal-{sessionId}
 *   Worker bridge (this handler)
 *     ↓ ssh2 client.exec()         krova-vsock-pty <vsock-path> <cols> <rows>
 *   bare-metal host
 *     ↓ Firecracker vsock UDS
 *   guest krova-agent (`pty` verb) → /bin/bash
 *
 * Framing (between this worker process and the guest agent):
 *   5-byte header: [type:uint8][length:big-endian uint32], then `length` bytes.
 *   0x01 STDIN  (worker → guest) — raw keystrokes
 *   0x02 STDOUT (guest → worker) — raw PTY output
 *   0x03 RESIZE (worker → guest) — JSON {cols, rows}
 *   0x04 EXIT   (guest → worker) — JSON {exitCode}, then connection closes
 *
 * Teardown triggers (any of):
 *   - SSH stream closes (helper exited; shell died; cube vanished)
 *   - cube_terminal_sessions.status moved out of `running` (close API or admin)
 *   - cube.status moved out of `running` (sleep/wake/transfer/delete)
 *   - idle timeout — no stdin/stdout activity for TERMINAL_SESSION_IDLE_MS
 *   - hard timeout — TERMINAL_SESSION_HARD_MS since startedAt
 *   - Pusher channel becomes vacated (tracked via member_removed)
 *
 * NOTE on idempotency: defense in depth. retryLimit=0 means pg-boss never
 * re-fires a bridge job. The queue is created with policy=exclusive +
 * singletonKey=sessionId so any duplicate enqueue for the same session is
 * rejected before it can race. And the handler itself claims the row via
 * an atomic `pending → running` update; a second run finds the row already
 * `running` and exits early.
 */

import { and, eq } from "drizzle-orm";
import type { Job } from "pg-boss";
// pusher-js's Node CJS build (dist/node/pusher.js) exports
// `{ Pusher: <Class> }`, NOT the class as default. So `import Pusher from
// "pusher-js"` in Node gets the namespace object — `new Pusher(...)` then
// throws "Pusher is not a constructor" at runtime, even though TypeScript
// thinks it's fine because the type definitions claim a default export.
// The browser bundle (dist/web/pusher.js) DOES expose the class as default,
// which is why `hooks/use-pusher.ts` and `components/cube-terminal-client.tsx`
// have no issue — Webpack resolves the `browser` field and gets a different
// build. The worker has to unwrap the namespace at runtime to find the class.
import * as PusherNamespace from "pusher-js";
import type { ClientChannel, Client as SshClient } from "ssh2";

const Pusher: typeof PusherNamespace.default =
  (PusherNamespace as unknown as { Pusher?: typeof PusherNamespace.default })
    .Pusher ??
  PusherNamespace.default ??
  (PusherNamespace as unknown as typeof PusherNamespace.default);
type Pusher = PusherNamespace.default;

import {
  TERMINAL_SESSION_HARD_MS,
  TERMINAL_SESSION_IDLE_MS,
} from "@/config/platform";
import {
  cubes,
  cubeTerminalSessions,
  memberCubeAssignments,
  memberPermissions,
  servers,
  spaceMemberships,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { getPusherServer } from "@/lib/pusher";
import { getPusherConfig } from "@/lib/service-config";
import { connectToServer } from "@/lib/ssh";
import { cubePaths } from "@/lib/ssh/jailer";
import { shellEscape } from "@/lib/ssh/utils";
import type { CubeTerminalBridgePayload } from "@/lib/worker/job-types";

const VSOCK_PTY_BIN = "/usr/local/bin/krova-vsock-pty";
const FRAME_HEADER_SIZE = 5;
const FRAME_STDIN = 0x01;
const FRAME_STDOUT = 0x02;
const FRAME_RESIZE = 0x03;
const FRAME_EXIT = 0x04;
const STATUS_POLL_MS = 5000;
const ACTIVITY_PERSIST_MS = 30_000;
/**
 * Permission re-check cadence — every Nth poll tick we re-verify that
 * the session's original opener still has `cube.manage` on the cube's
 * space AND (if the member has any cube-level assignments) is still
 * assigned to THIS cube. At STATUS_POLL_MS=5s and N=6, that's a
 * re-check every 30 seconds, which is plenty fast for a permission
 * revoke and avoids hitting the DB on every 5s tick. With this in
 * place an admin revoking `cube.manage` from a member with an
 * in-flight terminal session triggers teardown within ≤30s, even
 * if the customer never closes the browser tab.
 */
const PERMISSION_RECHECK_EVERY_N_TICKS = 6;
const STDOUT_PUBLISH_MAX_BYTES = 64 * 1024; // tune for Soketi maxPayloadInKb
/**
 * Hard upper bound on a single frame's payload size. The frame header
 * carries an unsigned 32-bit big-endian length, but a guest-side agent
 * sending a pathological length (whether due to a bug, a corrupt rootfs,
 * or a hypothetical compromise) could otherwise wedge the bridge's frame
 * parser or trigger a multi-GB allocation in the worker. 16 MB is
 * generous (~250× larger than any realistic interactive frame) while
 * still bounding worst-case worker memory.
 */
const MAX_FRAME_PAYLOAD_BYTES = 16 * 1024 * 1024;

export async function handleCubeTerminalBridge(
  jobs: Job<CubeTerminalBridgePayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleOne(job);
  }
}

async function handleOne(job: Job<CubeTerminalBridgePayload>): Promise<void> {
  const { sessionId } = job.data;
  // Tag every log line with a fixed prefix + short session id so worker
  // logs can be grep'd per-session: `grep '\[cube-terminal-bridge\] \[abc12345'`.
  // The bridge previously produced ~zero log output unless something errored,
  // which made "stuck mid-flow" failures impossible to diagnose. Every key
  // transition now emits an info line.
  const shortId = sessionId.slice(0, 12);
  const log = (msg: string): void =>
    console.log(`[cube-terminal-bridge] [${shortId}] ${msg}`);
  const logErr = (msg: string, err?: unknown): void => {
    if (err === undefined) {
      console.error(`[cube-terminal-bridge] [${shortId}] ${msg}`);
    } else {
      console.error(
        `[cube-terminal-bridge] [${shortId}] ${msg}`,
        err instanceof Error ? err.stack || err.message : err
      );
    }
  };

  log("handler invoked");

  // 1. Atomically claim the session row: pending → running.
  const [claimed] = await db
    .update(cubeTerminalSessions)
    .set({
      status: "running",
      startedAt: new Date(),
      lastActivityAt: new Date(),
    })
    .where(
      and(
        eq(cubeTerminalSessions.id, sessionId),
        eq(cubeTerminalSessions.status, "pending")
      )
    )
    .returning();

  if (!claimed) {
    log("session already claimed or not pending — skipping");
    return;
  }

  log(
    `session claimed cube=${claimed.cubeId} cols=${claimed.initialCols} rows=${claimed.initialRows}`
  );

  // 2. Load the cube + server (FK joins).
  const [bundle] = await db
    .select({
      cubeId: cubes.id,
      spaceId: cubes.spaceId,
      cubeStatus: cubes.status,
      serverId: cubes.serverId,
      launchMode: cubes.launchMode,
      hostname: servers.hostname,
    })
    .from(cubes)
    .innerJoin(servers, eq(servers.id, cubes.serverId))
    .where(eq(cubes.id, claimed.cubeId))
    .limit(1);

  if (bundle?.cubeStatus !== "running") {
    log(`cube not running (cube=${claimed.cubeId}) — aborting`);
    await markSessionEnded(sessionId, "cube_state_change");
    return;
  }

  log(`cube bundle loaded cube=${bundle.cubeId} server=${bundle.hostname}`);

  const channelName = `presence-terminal-${sessionId}`;
  const sessionUserId = claimed.userId;
  let endReason: string | null = null;
  let sshClient: SshClient | null = null;
  let stream: ClientChannel | null = null;
  let pusherClient: Pusher | null = null;
  let handshakeBuffer = Buffer.alloc(0);
  let handshakeDone = false;
  const frameBuffer: number[] = [];
  const startedAt = Date.now();
  let lastActivity = Date.now();
  let lastActivityPersistAt = Date.now();
  let tornDown = false;
  let firstStdoutPublished = false;
  let pollTickCount = 0;

  function teardown(reason: string): void {
    if (tornDown) {
      return;
    }
    tornDown = true;
    endReason = reason;
    log(`teardown reason="${reason}"`);
  }

  /**
   * Resolve once the BROWSER (not the bridge itself) is observed as a
   * member of the presence channel. The bridge uses `user_id:
   * "bridge-<sessionId>"` for its own subscription; any member whose id
   * does NOT start with `bridge-` is the customer's browser.
   *
   * THREE detection paths, all running in parallel — any one resolving
   * wins. This is deliberate redundancy after a recurring production
   * failure mode where the customer's browser confirmed
   * `pusher:subscription_succeeded` (banner showed "Connected") but the
   * bridge's `pusher:member_added` event never fired, leading to a
   * spurious `browser_did_not_join_within_30s` teardown:
   *
   *   1. `pusher:subscription_succeeded` initial roster — wins if the
   *      browser subscribed before the bridge (common when the worker
   *      is busy).
   *   2. `pusher:member_added` event — wins if the browser subscribes
   *      after the bridge.
   *   3. Soketi HTTP `GET /channels/<name>/users` polled every 2s — wins
   *      if BOTH events above fail to fire (Soketi has been observed to
   *      drop presence events under load) but the browser IS actually
   *      subscribed from Soketi's authoritative perspective.
   *
   * Member IDs are logged on every path so the next time this fires we
   * can immediately see whether (a) Soketi never registered the browser
   * at all (stale subscription) vs. (b) it knew about the browser but
   * the event-delivery path failed.
   *
   * Returns false if the browser never appears within `timeoutMs`.
   */
  function waitForBrowserMember(
    ch: import("pusher-js").Channel,
    channelName: string,
    timeoutMs: number
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let pollTimer: NodeJS.Timeout | null = null;

      const finish = (found: boolean, via: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(deadline);
        if (pollTimer) {
          clearTimeout(pollTimer);
        }
        log(`waitForBrowserMember resolved found=${found} via=${via}`);
        resolve(found);
      };
      const deadline = setTimeout(() => finish(false, "timeout"), timeoutMs);

      ch.bind("pusher:subscription_succeeded", (members: unknown) => {
        const m = members as {
          count?: number;
          each?: (cb: (member: { id: string }) => void) => void;
        };
        const ids: string[] = [];
        if (m && typeof m.each === "function") {
          m.each((member) => ids.push(member.id));
        }
        log(
          `bridge own subscription_succeeded count=${m?.count ?? "?"} ids=[${ids.join(",")}]`
        );
        if (ids.some((id) => !id.startsWith("bridge-"))) {
          finish(true, "initial-roster");
        }
      });

      ch.bind("pusher:member_added", (member: unknown) => {
        const mm = member as { id?: string };
        log(`pusher:member_added id=${mm?.id ?? "?"}`);
        if (mm?.id && !mm.id.startsWith("bridge-")) {
          finish(true, "member_added-event");
        }
      });

      // Fallback path: poll Soketi's authoritative HTTP API for the
      // channel's user roster. This runs in parallel with the event
      // listeners above so a dropped Soketi presence event no longer
      // strands the session. Same Pusher API + same auth signature that
      // powers our existing `trigger()` calls — if those work, this
      // works.
      const pollMs = 2000;
      const tick = async (): Promise<void> => {
        if (settled) {
          return;
        }
        try {
          const res = await getPusherServer().get({
            path: `/channels/${channelName}/users`,
          });
          if (settled) {
            return;
          }
          // pusher SDK `get()` returns a fetch-like Response; if Soketi
          // ever returns non-2xx (e.g. channel temporarily missing), we
          // surface it as a log + try again on the next tick.
          if (res.ok) {
            const body = (await res.json()) as { users?: { id: string }[] };
            const ids = (body.users ?? []).map((u) => u.id);
            log(`http poll users=[${ids.join(",")}]`);
            if (ids.some((id) => !id.startsWith("bridge-"))) {
              finish(true, "http-poll");
              return;
            }
          } else {
            log(`http poll non-ok status=${res.status}`);
          }
        } catch (err) {
          logErr("http poll error:", err);
        }
        if (!settled) {
          pollTimer = setTimeout(tick, pollMs);
        }
      };
      // Kick off the first poll after a short delay so the event path
      // gets a chance to win cheaply; if it doesn't, the poll takes
      // over without blowing up Soketi with rapid-fire requests.
      pollTimer = setTimeout(tick, 1000);
    });
  }

  /**
   * Encode a single framed message into a Buffer.
   */
  function buildFrame(type: number, payload: Buffer): Buffer {
    const header = Buffer.alloc(FRAME_HEADER_SIZE);
    header.writeUInt8(type, 0);
    header.writeUInt32BE(payload.length, 1);
    return Buffer.concat([header, payload]);
  }

  /**
   * Serialization gate for consumeFrames. Pusher's trigger() is async and
   * NOT ordered across separate calls — if two `consumeFrames` invocations
   * run concurrently (e.g. a fresh SSH chunk arrives mid-await on the
   * previous chunk's trigger), the underlying HTTP POSTs to Soketi race
   * each other and stdout can deliver out of order at the browser. Holding
   * a boolean gate ensures at most one drain loop is in flight; the new
   * bytes appended to frameBuffer by `ingestStreamStdout` are picked up by
   * the still-running loop on its next iteration.
   */
  let consuming = false;

  /**
   * Drain any complete frames from frameBuffer and forward STDOUT to the
   * Pusher channel in order. EXIT frames trigger teardown. Unknown types
   * are dropped.
   */
  async function consumeFrames(): Promise<void> {
    if (consuming) {
      return;
    }
    consuming = true;
    try {
      await drainFrames();
    } finally {
      consuming = false;
    }
  }

  async function drainFrames(): Promise<void> {
    while (frameBuffer.length >= FRAME_HEADER_SIZE) {
      const type = frameBuffer[0];
      // Unsigned multiplication avoids JS's signed-int bitwise overflow:
      // `(byte << 24)` returns a negative number when the high bit of byte
      // is set, which then propagates through the OR-chain and produces a
      // negative `length`. That would slip past the `length > MAX_*` check
      // below. `Math.imul`-free expansion via multiplication keeps `length`
      // a true non-negative number up to 2^32.
      const length =
        frameBuffer[1] * 0x1_00_00_00 +
        frameBuffer[2] * 0x1_00_00 +
        frameBuffer[3] * 0x1_00 +
        frameBuffer[4];
      // Defense-in-depth: reject pathological / oversized frames outright.
      // A malformed length means the buffer is desynced and we can't
      // safely resume parsing; teardown is the only correct response.
      if (length > MAX_FRAME_PAYLOAD_BYTES) {
        teardown(
          `oversize_frame type=${type} length=${length} max=${MAX_FRAME_PAYLOAD_BYTES}`
        );
        return;
      }
      if (frameBuffer.length < FRAME_HEADER_SIZE + length) {
        return;
      }
      const payload = Buffer.from(
        frameBuffer
          .splice(0, FRAME_HEADER_SIZE + length)
          .slice(FRAME_HEADER_SIZE)
      );

      if (type === FRAME_STDOUT) {
        lastActivity = Date.now();
        if (!firstStdoutPublished) {
          firstStdoutPublished = true;
          log(`first stdout frame received from guest (${payload.length} B)`);
        }
        // Soketi enforces a per-event payload cap (default 10 KB; we bump it
        // via env to 100 KB+). Chunking lets the worker stay under that cap
        // even when bash dumps a multi-MB blob (`cat /var/log/syslog`).
        for (let i = 0; i < payload.length; i += STDOUT_PUBLISH_MAX_BYTES) {
          const slice = payload.subarray(i, i + STDOUT_PUBLISH_MAX_BYTES);
          try {
            await getPusherServer().trigger(channelName, "stdout", {
              b64: slice.toString("base64"),
            });
          } catch (err) {
            logErr("pusher trigger stdout failed:", err);
            teardown("pusher_trigger_failed");
            return;
          }
        }
      } else if (type === FRAME_EXIT) {
        let exitCode = -1;
        try {
          const parsed = JSON.parse(payload.toString("utf-8")) as {
            exitCode?: number;
          };
          if (typeof parsed.exitCode === "number") {
            exitCode = parsed.exitCode;
          }
        } catch {
          // ignore
        }
        try {
          await getPusherServer().trigger(channelName, "exit", { exitCode });
        } catch {
          // best-effort
        }
        teardown("shell_exited");
        return;
      }
      // STDIN / RESIZE shouldn't come back from the guest — silently drop.
    }
  }

  /**
   * Convert raw SSH stdout into the agent's framed payload buffer.
   * The helper's first line is the JSON handshake `{"status":"ok"}\n` — we
   * read up to that newline before flipping into framed mode.
   */
  function ingestStreamStdout(chunk: Buffer): void {
    if (!handshakeDone) {
      handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
      const newlineIdx = handshakeBuffer.indexOf(0x0a);
      if (newlineIdx < 0) {
        return;
      }
      const line = handshakeBuffer.subarray(0, newlineIdx).toString("utf-8");
      const tail = handshakeBuffer.subarray(newlineIdx + 1);
      handshakeBuffer = Buffer.alloc(0);
      handshakeDone = true;
      try {
        const parsed = JSON.parse(line.trim()) as {
          status?: string;
          message?: string;
        };
        if (parsed.status !== "ok") {
          teardown(`pty_handshake_failed: ${parsed.message ?? "unknown"}`);
          return;
        }
        log("pty handshake ok (helper → bridge)");
      } catch (err) {
        teardown(
          `pty_handshake_parse_failed: ${err instanceof Error ? err.message : String(err)}`
        );
        return;
      }
      // Push any post-newline bytes into the frame buffer
      if (tail.length > 0) {
        for (const b of tail) {
          frameBuffer.push(b);
        }
      }
      void consumeFrames();
      return;
    }
    for (const b of chunk) {
      frameBuffer.push(b);
    }
    void consumeFrames();
  }

  /**
   * Periodic state checks. Runs every STATUS_POLL_MS; fires teardown on
   * any state-change signal. Returns true if we should stop polling.
   */
  async function pollStateOnce(): Promise<boolean> {
    pollTickCount++;

    // Idle / hard timeout
    if (Date.now() - lastActivity > TERMINAL_SESSION_IDLE_MS) {
      teardown("idle_timeout");
      return true;
    }
    if (Date.now() - startedAt > TERMINAL_SESSION_HARD_MS) {
      teardown("hard_timeout");
      return true;
    }

    // Session row state — could be force-closed via API
    const [row] = await db
      .select({
        status: cubeTerminalSessions.status,
      })
      .from(cubeTerminalSessions)
      .where(eq(cubeTerminalSessions.id, sessionId))
      .limit(1);
    if (row?.status !== "running") {
      teardown("session_closed_externally");
      return true;
    }

    // Cube state — sleeping / deleting / transferring should terminate
    const [cubeRow] = await db
      .select({ status: cubes.status })
      .from(cubes)
      .where(eq(cubes.id, bundle.cubeId))
      .limit(1);
    if (cubeRow?.status !== "running") {
      teardown("cube_state_change");
      return true;
    }

    // Periodic permission re-check. The session opener's access to this
    // cube can be revoked by an admin while the bridge is alive (e.g.,
    // they get removed from the space, lose `cube.manage`, or have
    // their cube assignment changed). Without this re-check the
    // existing WS connection persists until the 15-min idle timeout —
    // which is technically acceptable but leaves a 15-min window where
    // a revoked user keeps root shell access. Running this every Nth
    // tick (every 30s at PERMISSION_RECHECK_EVERY_N_TICKS=6) caps the
    // window at ≤30s without 3×-ing DB load on every tick.
    if (pollTickCount % PERMISSION_RECHECK_EVERY_N_TICKS === 0) {
      const stillAuthorized = await stillHasCubeAccess(
        sessionUserId,
        bundle.spaceId,
        bundle.cubeId
      );
      if (!stillAuthorized) {
        teardown("permission_revoked");
        return true;
      }
    }

    // Persist lastActivityAt at coarse cadence (avoid per-keystroke DB writes)
    if (Date.now() - lastActivityPersistAt > ACTIVITY_PERSIST_MS) {
      lastActivityPersistAt = Date.now();
      await db
        .update(cubeTerminalSessions)
        .set({ lastActivityAt: new Date(lastActivity) })
        .where(eq(cubeTerminalSessions.id, sessionId))
        .catch(() => {});
    }
    return false;
  }

  // Wrap the entire post-claim flow in try/finally so that finalize ALWAYS
  // runs, regardless of what throws. Without this, an exception anywhere
  // between here and the poll loop would leave the cube_terminal_sessions
  // row stuck in `running` forever — a real bug we observed in prod where
  // sessions never timed out and the bridge handler appeared frozen.
  try {
    // 3. Wire up Pusher subscriber as a fake client. The worker has the
    //    PUSHER_SECRET so we can sign the auth response inline — no
    //    round-trip through the HTTP /api/pusher/auth route.
    const pusherCfg = getPusherConfig();
    log(
      `creating pusher client host=${pusherCfg.host ?? "(cluster mode)"} cluster=${pusherCfg.cluster || "(none)"}`
    );
    pusherClient = new Pusher(pusherCfg.key, {
      cluster: pusherCfg.cluster || "default",
      ...(pusherCfg.host
        ? {
            wsHost: pusherCfg.host,
            wssPort: pusherCfg.port ?? 443,
            wsPort: pusherCfg.port ?? 80,
            forceTLS: true,
            enabledTransports: ["ws", "wss"],
          }
        : {}),
      channelAuthorization: {
        transport: "ajax",
        endpoint: "",
        customHandler: ({ channelName: cn, socketId }, callback) => {
          try {
            const auth = getPusherServer().authorizeChannel(socketId, cn, {
              user_id: `bridge-${sessionId}`,
              user_info: { type: "bridge" },
            });
            callback(null, auth);
          } catch (err) {
            logErr("customHandler signing failed:", err);
            callback(err as Error, null);
          }
        },
      },
    });

    // Connection-state listeners. Without these, a failure to establish
    // the WebSocket to Soketi produced ZERO log output and the bridge
    // appeared to hang forever — exactly the "no stdout events" symptom.
    pusherClient.connection.bind(
      "state_change",
      (states: { previous: string; current: string }) => {
        log(`pusher state: ${states.previous} → ${states.current}`);
      }
    );
    pusherClient.connection.bind("connected", () => {
      log("pusher WS connection established");
    });
    pusherClient.connection.bind("disconnected", () => {
      log("pusher WS disconnected");
    });
    pusherClient.connection.bind("error", (err: unknown) => {
      logErr("pusher connection error:", err);
    });

    const channel = pusherClient.subscribe(channelName);
    log(`subscribe(${channelName}) called`);

    channel.bind("client-stdin", (data: { b64?: string }) => {
      if (!stream || !data?.b64) {
        return;
      }
      try {
        const payload = Buffer.from(data.b64, "base64");
        stream.stdin.write(buildFrame(FRAME_STDIN, payload));
        lastActivity = Date.now();
      } catch (err) {
        logErr("write stdin frame failed:", err);
      }
    });

    channel.bind("client-resize", (data: { cols?: number; rows?: number }) => {
      if (!stream || !data?.cols || !data?.rows) {
        return;
      }
      try {
        const payload = Buffer.from(
          JSON.stringify({ cols: data.cols, rows: data.rows }),
          "utf-8"
        );
        stream.stdin.write(buildFrame(FRAME_RESIZE, payload));
      } catch (err) {
        logErr("write resize frame failed:", err);
      }
    });

    channel.bind("pusher:subscription_error", (err: unknown) => {
      logErr("pusher subscription_error:", err);
      teardown("pusher_subscription_error");
    });

    // Defense-in-depth + UX: tear down immediately when the BROWSER leaves
    // the presence channel. This fires when the customer closes the tab,
    // navigates away, loses internet, or explicitly logs out (Better Auth
    // signOut tears down the cookie which kills the cookie-bound WS auth).
    // Without this we'd rely on the idle-timeout (15 min) to clean up,
    // which leaves the host PTY allocated + the bridge holding an SSH
    // connection for that whole window. The browser leaving is the
    // strongest possible "no one is reading anymore" signal.
    channel.bind("pusher:member_removed", (member: unknown) => {
      const mm = member as { id?: string };
      log(`pusher:member_removed id=${mm?.id ?? "?"}`);
      if (mm?.id && !mm.id.startsWith("bridge-")) {
        teardown("browser_left_channel");
      }
    });

    // Wait for the BROWSER to actually join the presence channel before
    // opening the SSH PTY pipe. Without this gate the bridge would fire
    // the bash prompt's stdout event before the browser's subscription
    // is established, Soketi drops the event (no current subscribers),
    // and the customer stares at an empty terminal forever. Presence
    // channels exist precisely to coordinate this kind of join.
    log("waiting for browser member to join channel");
    const browserJoinTimeoutMs = 60_000;
    const browserJoined = await waitForBrowserMember(
      channel,
      channelName,
      browserJoinTimeoutMs
    );
    if (!browserJoined) {
      teardown("browser_did_not_join_within_60s");
      return;
    }
    log("browser member joined — publishing bridge.online heartbeat");

    // Publish a one-shot bridge.online event so the browser can confirm
    // (in DevTools or via the UI) that server-triggered events on this
    // channel reach it. If the browser never sees this event, the trigger
    // path itself is broken (e.g. wrong channel name, Soketi config) and
    // we can stop debugging the SSH/PTY path entirely.
    try {
      await getPusherServer().trigger(channelName, "bridge.online", {
        sessionId,
        ts: new Date().toISOString(),
      });
      log("bridge.online published");
    } catch (err) {
      logErr("bridge.online trigger failed (continuing anyway):", err);
    }

    // 4. Open SSH + spawn the host helper.
    log(`opening SSH connection to server ${bundle.serverId}`);
    try {
      const conn = await connectToServer(bundle.serverId);
      sshClient = conn.client;
      log("SSH connected");
    } catch (err) {
      teardown(
        `ssh_connect_failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    const vsockPath = cubePaths(bundle.cubeId, bundle.launchMode).vsockPath;
    const cmd = `${VSOCK_PTY_BIN} ${shellEscape(vsockPath)} ${claimed.initialCols} ${claimed.initialRows}`;
    log(`ssh exec: ${cmd}`);

    const sshClientRef = sshClient;
    await new Promise<void>((resolve) => {
      sshClientRef.exec(cmd, (err, channel) => {
        if (err) {
          logErr("ssh exec callback err:", err);
          teardown(`ssh_exec_failed: ${err.message}`);
          resolve();
          return;
        }
        log("ssh exec channel open — awaiting helper handshake");
        stream = channel;
        channel
          .on("data", (chunk: Buffer) => {
            ingestStreamStdout(chunk);
          })
          .on("close", () => {
            log("ssh stream close event");
            if (endReason === null) {
              teardown("ssh_stream_closed");
            }
          })
          .stderr.on("data", (chunk: Buffer) => {
            logErr(`helper stderr: ${chunk.toString("utf-8").trim()}`);
          });
        resolve();
      });
    });

    if (tornDown) {
      log("tornDown before poll loop — skipping");
      return;
    }

    // 5. Poll state until teardown fires
    log("entering poll loop");
    while (!tornDown) {
      const done = await pollStateOnce().catch((err) => {
        logErr("poll failed:", err);
        return false;
      });
      if (done) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
    }
    log("poll loop exited");
  } catch (err) {
    // Catch-all so finalize always runs and the DB row never gets stuck
    // in `running`. This is the safety net for any unhandled exception
    // anywhere in the post-claim flow above.
    logErr("unhandled exception in bridge:", err);
    teardown(`exception: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    log(`finalize start (endReason="${endReason ?? "unknown"}")`);
    await finalize();
    log("finalize done");
  }

  async function finalize(): Promise<void> {
    try {
      stream?.end();
    } catch {
      // ignore
    }
    try {
      sshClient?.end();
    } catch {
      // ignore
    }
    try {
      pusherClient?.unsubscribe(channelName);
      pusherClient?.disconnect();
    } catch {
      // ignore
    }

    const reason = endReason ?? "unknown";
    const terminalStatus = reason.startsWith("idle_timeout")
      ? "expired"
      : reason.startsWith("hard_timeout")
        ? "expired"
        : reason.startsWith("ssh_") ||
            reason.startsWith("pty_handshake_") ||
            reason.startsWith("pusher_")
          ? "failed"
          : "ended";

    await db
      .update(cubeTerminalSessions)
      .set({
        status: terminalStatus,
        endReason: reason,
        endedAt: new Date(),
        lastActivityAt: new Date(lastActivity),
      })
      .where(
        and(
          eq(cubeTerminalSessions.id, sessionId),
          eq(cubeTerminalSessions.status, "running")
        )
      )
      .catch(() => {});

    // Best-effort exit notice to the browser if the channel is still live
    try {
      await getPusherServer().trigger(channelName, "bridge.ended", {
        reason,
        status: terminalStatus,
      });
    } catch {
      // ignore
    }

    audit({
      action: "cube.terminal_session_ended",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: bundle.cubeId,
      spaceId: bundle.spaceId,
      description: `Terminal session ended: ${reason}`,
      metadata: {
        sessionId,
        durationMs: Date.now() - startedAt,
        status: terminalStatus,
      },
      source: "worker",
    });
  }
}

/**
 * Re-verify that `userId` is still authorized to access `cubeId` within
 * `spaceId` at the moment of the check. Mirrors the four gates that the
 * session-create API runs once at open time:
 *   (1) the user is still a member of the space (not removed),
 *   (2) the membership has `cube.manage` permission (or is the space owner),
 *   (3) if the member has ANY cube assignments, this cube is in them.
 * Returns true only when all three hold. Any DB error returns false
 * (fail-closed — we'd rather end a session than keep it alive on a
 * transient DB hiccup, because the alternative is leaving a revoked
 * user with shell access).
 */
async function stillHasCubeAccess(
  userId: string,
  spaceId: string,
  cubeId: string
): Promise<boolean> {
  try {
    const [membership] = await db
      .select({
        id: spaceMemberships.id,
        isOwner: spaceMemberships.isOwner,
      })
      .from(spaceMemberships)
      .where(
        and(
          eq(spaceMemberships.userId, userId),
          eq(spaceMemberships.spaceId, spaceId)
        )
      )
      .limit(1);

    if (!membership) {
      return false;
    }

    // Space owners pass the permission + assignment checks unconditionally.
    if (membership.isOwner) {
      return true;
    }

    const [perm] = await db
      .select({ id: memberPermissions.id })
      .from(memberPermissions)
      .where(
        and(
          eq(memberPermissions.membershipId, membership.id),
          eq(memberPermissions.permission, "cube.manage")
        )
      )
      .limit(1);

    if (!perm) {
      return false;
    }

    // Mirrors the requireCubeAccess semantics: if the membership has ANY
    // cube assignments at all, the specific cube must be in them; if it
    // has NO assignments, access is unrestricted.
    const [anyAssignment] = await db
      .select({ id: memberCubeAssignments.id })
      .from(memberCubeAssignments)
      .where(eq(memberCubeAssignments.membershipId, membership.id))
      .limit(1);

    if (!anyAssignment) {
      return true;
    }

    const [specific] = await db
      .select({ id: memberCubeAssignments.id })
      .from(memberCubeAssignments)
      .where(
        and(
          eq(memberCubeAssignments.membershipId, membership.id),
          eq(memberCubeAssignments.cubeId, cubeId)
        )
      )
      .limit(1);

    return !!specific;
  } catch (err) {
    console.error(
      "[cube-terminal-bridge] stillHasCubeAccess error (fail-closed):",
      err
    );
    return false;
  }
}

async function markSessionEnded(
  sessionId: string,
  reason: string
): Promise<void> {
  await db
    .update(cubeTerminalSessions)
    .set({
      status: "failed",
      endReason: reason,
      endedAt: new Date(),
    })
    .where(eq(cubeTerminalSessions.id, sessionId))
    .catch(() => {});
}
