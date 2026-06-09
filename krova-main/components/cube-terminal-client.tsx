"use client";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import PusherClient from "pusher-js";
import { useCallback, useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

import type { PusherClientConfig } from "@/lib/service-config";

interface CubeTerminalClientProps {
  cubeId: string;
  cubeName: string;
  cubeStatus: string;
  cubeTransferState: string;
  pusherClientConfig: PusherClientConfig;
  spaceId: string;
}

interface OpenSessionResponse {
  channelName: string;
  hardTimeoutMs: number;
  idleTimeoutMs: number;
  sessionId: string;
}

type ConnState =
  | { kind: "opening" }
  | { kind: "connecting"; sessionId: string }
  | { kind: "connected"; sessionId: string }
  | { kind: "disconnected"; reason: string }
  | { kind: "error"; message: string };

/**
 * Pusher's `pusher:subscription_error` event payload is NOT an Error
 * instance — it's a plain object whose shape varies by failure mode.
 * The most common shapes:
 *   { type: "AuthError", error: "<body>", status: 403 }    // auth endpoint non-2xx
 *   { type: "HTTPRateLimit", error: "...", status: 429 }
 *   { type: "PusherError", error: { code, message } }      // protocol-level
 * Doing `String(err)` would have produced "[object Object]" — useless.
 * Surface the http status + the human-readable detail so the customer
 * (and the operator reading screenshots) can act on it.
 */
function formatPusherError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  if (err && typeof err === "object") {
    const e = err as {
      type?: string;
      status?: number;
      error?: unknown;
    };
    const parts: string[] = [];
    if (e.status) {
      parts.push(`HTTP ${e.status}`);
    }
    if (e.type) {
      parts.push(e.type);
    }
    if (e.error !== undefined && e.error !== null) {
      if (typeof e.error === "string") {
        parts.push(e.error);
      } else if (e.error instanceof Error) {
        parts.push(e.error.message);
      } else {
        parts.push(JSON.stringify(e.error));
      }
    }
    if (parts.length === 0) {
      try {
        return JSON.stringify(err);
      } catch {
        return "unknown subscription error";
      }
    }
    return parts.join(" — ");
  }
  return String(err);
}

/**
 * Full-viewport xterm.js terminal that opens a krova-agent PTY session
 * through the cube.terminal-bridge worker over Soketi.
 *
 * Flow on mount:
 *   1. POST /api/spaces/.../terminal-sessions to claim a session id
 *   2. Subscribe to presence-terminal-{sessionId} via pusher-js
 *   3. Wire xterm.onData → client-stdin events
 *   4. Wire bridge's stdout events → xterm.write
 *   5. Wire xterm.onResize → client-resize events
 *
 * On unmount: POST /close + tear down xterm + pusher.
 */
export function CubeTerminalClient({
  cubeId,
  cubeName,
  spaceId,
  cubeStatus,
  cubeTransferState,
  pusherClientConfig,
}: CubeTerminalClientProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const pusherRef = useRef<PusherClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Cube-state preflight: derived from props, no effect needed. If the cube
  // isn't running OR is mid-transfer, we never start an xterm or open a
  // session at all — just render the error state.
  const preflightError: string | null =
    cubeStatus === "running"
      ? cubeTransferState === "idle"
        ? null
        : "Cube is mid-transfer. Try again once it settles."
      : "Cube is not running. Wake the cube first.";

  const [state, setState] = useState<ConnState>(
    preflightError
      ? { kind: "error", message: preflightError }
      : { kind: "opening" }
  );
  // Bumped to remount the connection effect for a one-shot auto-retry
  // after a `browser_did_not_join_within_*` teardown — the failure mode
  // where the bridge subscribed before the browser was visible to
  // Soketi's presence roster. A fresh session almost always succeeds
  // because by the time the second bridge job runs the browser side is
  // fully warm. We limit to a single retry to avoid spinning when
  // something is fundamentally broken; further failures surface to the
  // user as `disconnected` so they can click Reload manually.
  const [retryKey, setRetryKey] = useState(0);
  const retryAttemptedRef = useRef(false);

  const closeSession = useCallback(async () => {
    if (!sessionIdRef.current) {
      return;
    }
    try {
      await fetch(
        `/api/spaces/${spaceId}/cubes/${cubeId}/terminal-sessions/${sessionIdRef.current}/close`,
        { method: "POST" }
      );
    } catch {
      // best-effort
    }
  }, [cubeId, spaceId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryKey is a deliberate remount trigger — bumping it forces the cleanup + re-init of the entire pusher subscription so a one-shot auto-retry after `browser_did_not_join_within_*` lands on a fresh session.
  useEffect(() => {
    if (preflightError) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const term = new Terminal({
      fontFamily:
        '"JetBrains Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      convertEol: true,
      scrollback: 5000,
      theme: {
        background: "#000000",
        foreground: "#e5e5e5",
        cursor: "#7dd3fc",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const cols = term.cols;
    const rows = term.rows;

    const writeBanner = (line: string, color = "37") => {
      term.write(`\x1b[${color}m${line}\x1b[0m\r\n`);
    };
    writeBanner(`Krova — connecting to ${cubeName}…`, "90");

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // ignore
      }
    });
    ro.observe(container);

    let stopped = false;
    let pusherClient: PusherClient | null = null;
    let unbindHandlers: (() => void) | null = null;

    (async () => {
      try {
        const openRes = await fetch(
          `/api/spaces/${spaceId}/cubes/${cubeId}/terminal-sessions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cols, rows }),
          }
        );
        if (!openRes.ok) {
          const errBody = await openRes.json().catch(() => ({}));
          throw new Error(
            errBody?.message ||
              errBody?.error ||
              `Open session failed (${openRes.status})`
          );
        }
        const resp = (await openRes.json()) as OpenSessionResponse;

        if (stopped) {
          return;
        }
        sessionIdRef.current = resp.sessionId;
        setState({ kind: "connecting", sessionId: resp.sessionId });

        // Match the API surface used by `hooks/use-pusher.ts` so the
        // terminal page and the rest of the dashboard authenticate
        // through exactly the same code path. `channelAuthorization` is
        // the pusher-js 8.x canonical config; `authEndpoint` is the
        // legacy alias and still works, but using the same key shape
        // here removes a debugging variable.
        pusherClient = new PusherClient(pusherClientConfig.key, {
          cluster: pusherClientConfig.cluster || "default",
          ...(pusherClientConfig.host
            ? {
                wsHost: pusherClientConfig.host,
                wsPort: pusherClientConfig.port ?? 443,
                wssPort: pusherClientConfig.port ?? 443,
                forceTLS: true,
                disableStats: true,
                enabledTransports: ["ws" as const, "wss" as const],
              }
            : {}),
          channelAuthorization: {
            endpoint: "/api/pusher/auth",
            transport: "ajax",
          },
        });
        pusherRef.current = pusherClient;

        const channel = pusherClient.subscribe(resp.channelName);

        channel.bind("pusher:subscription_succeeded", () => {
          setState({ kind: "connected", sessionId: resp.sessionId });
          // Reset the auto-retry budget on a clean connect. If this
          // session later disconnects, the customer gets one more
          // automatic retry — but only once per healthy session.
          retryAttemptedRef.current = false;
          writeBanner(
            "Connected. Ctrl-D or close the tab to end the session.",
            "32"
          );
        });

        channel.bind("pusher:subscription_error", (err: unknown) => {
          const msg = formatPusherError(err);
          console.error("[cube-terminal] pusher subscription_error:", err);
          setState({ kind: "error", message: `Connection refused: ${msg}` });
          writeBanner(`Connection refused: ${msg}`, "31");
        });

        const onStdout = (data: { b64?: string }) => {
          if (!data?.b64) {
            return;
          }
          const bytes = Uint8Array.from(atob(data.b64), (c) => c.charCodeAt(0));
          term.write(bytes);
        };
        channel.bind("stdout", onStdout);

        const onBridgeEnded = (data: { reason?: string }) => {
          const reason = data?.reason ?? "unknown";
          // One-shot auto-retry for the historically flaky timeout
          // teardown — by the time the second bridge job runs, the
          // browser side is already warm and the new bridge picks up
          // the member instantly. Skipped if we've already retried, if
          // the page is unmounting, or if the failure is anything else
          // (real cube errors should surface to the user, not silently
          // loop).
          const isJoinTimeout = /^browser_did_not_join_within_/.test(reason);
          if (isJoinTimeout && !retryAttemptedRef.current && !stopped) {
            retryAttemptedRef.current = true;
            writeBanner(
              `\r\n— session ended (${reason}). Reconnecting… —`,
              "33"
            );
            setState({ kind: "opening" });
            // Bump the retryKey on the next tick so the cleanup of this
            // effect runs first (unsubscribes, closes the now-dead
            // session) before the effect re-mounts with a fresh one.
            setTimeout(() => setRetryKey((k) => k + 1), 0);
            return;
          }
          writeBanner(`\r\n— session ended (${reason}) —`, "33");
          setState({ kind: "disconnected", reason });
        };
        channel.bind("bridge.ended", onBridgeEnded);

        const onExit = (data: { exitCode?: number }) => {
          writeBanner(
            `\r\n— shell exited (code ${data?.exitCode ?? "?"}) —`,
            "33"
          );
        };
        channel.bind("exit", onExit);

        const onXtermData = term.onData((data) => {
          if (stopped) {
            return;
          }
          const b64 = btoa(
            String.fromCharCode(...new TextEncoder().encode(data))
          );
          channel.trigger("client-stdin", { b64 });
        });

        const onXtermResize = term.onResize(({ cols: c, rows: r }) => {
          if (stopped) {
            return;
          }
          channel.trigger("client-resize", { cols: c, rows: r });
        });

        unbindHandlers = () => {
          channel.unbind("stdout", onStdout);
          channel.unbind("bridge.ended", onBridgeEnded);
          channel.unbind("exit", onExit);
          onXtermData.dispose();
          onXtermResize.dispose();
        };
      } catch (err) {
        if (stopped) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "error", message });
        writeBanner(`Failed to open session: ${message}`, "31");
      }
    })();

    return () => {
      stopped = true;
      try {
        ro.disconnect();
      } catch {
        // ignore
      }
      unbindHandlers?.();
      try {
        if (pusherClient && sessionIdRef.current) {
          pusherClient.unsubscribe(`presence-terminal-${sessionIdRef.current}`);
        }
        pusherClient?.disconnect();
      } catch {
        // ignore
      }
      void closeSession();
      try {
        term.dispose();
      } catch {
        // ignore
      }
    };
  }, [
    cubeId,
    cubeName,
    preflightError,
    pusherClientConfig,
    spaceId,
    closeSession,
    retryKey,
  ]);

  return (
    <div className="flex h-full w-full flex-col bg-black text-neutral-200">
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-950 px-3 py-2 text-xs">
        <div className="flex items-center gap-3">
          <span className="font-mono text-neutral-400">krova</span>
          <span className="font-mono text-neutral-200">{cubeName}</span>
          <StatusDot state={state} />
        </div>
        <button
          className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 transition-colors hover:bg-neutral-800"
          onClick={() => window.close()}
          type="button"
        >
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 bg-black p-2" ref={containerRef} />
    </div>
  );
}

function StatusDot({ state }: { state: ConnState }) {
  const labelByKind: Record<ConnState["kind"], string> = {
    opening: "Opening",
    connecting: "Connecting",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Error",
  };
  const colorByKind: Record<ConnState["kind"], string> = {
    opening: "bg-neutral-500",
    connecting: "bg-amber-400",
    connected: "bg-emerald-400",
    disconnected: "bg-neutral-500",
    error: "bg-red-500",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-neutral-400">
      <span className={`size-2 rounded-full ${colorByKind[state.kind]}`} />
      <span>{labelByKind[state.kind]}</span>
    </span>
  );
}
