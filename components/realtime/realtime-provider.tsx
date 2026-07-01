"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Realtime collaboration client.
 *
 * Opens a single SSE connection (the shared `/api/me/notifications/stream`) and,
 * when another member changes something in THIS workspace, re-pulls fresh data:
 *   - `router.refresh()` covers the server-rendered views (List, Board, sidebar);
 *   - subscribers (client-fetched views like Sprint) are notified to re-fetch.
 *
 * A refresh is auto-applied but DEFERRED while the user is busy (typing, an
 * overlay open, or mid-drag) or the tab is inactive, then flushed once idle.
 */

const DEBOUNCE_MS = 600;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

type RefetchHandler = () => void;

interface RealtimeContextValue {
  /** Subscribe a client-fetched view's re-fetch. Returns an unsubscribe fn. */
  subscribe: (handler: RefetchHandler) => () => void;
  /** Pause auto-refresh (e.g. during a drag). Returns a `resume` fn. */
  pause: () => () => void;
}

const RealtimeContext = React.createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const workspaceIdRef = React.useRef(workspaceId);
  workspaceIdRef.current = workspaceId;
  const routerRef = React.useRef(router);
  routerRef.current = router;

  const subscribersRef = React.useRef<Set<RefetchHandler>>(new Set());
  const interactionCountRef = React.useRef(0);

  // A single coalesced pending refresh: `pendingRef` is set on the first event
  // of a burst and stays set (ignoring further events) until it's flushed.
  const pendingRef = React.useRef(false);
  const pendingForRef = React.useRef<string | null>(null);
  const flushTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // True while a refresh must wait: inactive tab, active editing, an open
  // overlay we control, or an explicit drag pause.
  const shouldDefer = React.useCallback(() => {
    if (typeof document === "undefined") return false;
    if (document.hidden || !document.hasFocus()) return true;
    if (interactionCountRef.current > 0) return true;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
      return true;
    }
    // Specific shadcn/Radix overlays only (not a blanket [data-state="open"]):
    // Dialog, Dropdown Menu, Select/Command/slash menu, Popover/Date-picker.
    if (
      document.querySelector(
        '[role="dialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]',
      )
    ) {
      return true;
    }
    return false;
  }, []);

  const doRefresh = React.useCallback(() => {
    routerRef.current.refresh();
    for (const handler of subscribersRef.current) {
      try {
        handler();
      } catch {
        /* a bad subscriber must not break the others */
      }
    }
  }, []);

  const attemptFlush = React.useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (!pendingRef.current) return;
    if (shouldDefer()) return; // stay pending; a clearing event will retry
    if (pendingForRef.current !== workspaceIdRef.current) {
      // User navigated to a different workspace since the event — drop it.
      pendingRef.current = false;
      pendingForRef.current = null;
      return;
    }
    pendingRef.current = false;
    pendingForRef.current = null;
    doRefresh();
  }, [shouldDefer, doRefresh]);

  const requestRefresh = React.useCallback(
    (forWorkspace: string) => {
      if (pendingRef.current) return; // coalesce a burst into one refresh
      pendingRef.current = true;
      pendingForRef.current = forWorkspace;
      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(attemptFlush, DEBOUNCE_MS);
      }
    },
    [attemptFlush],
  );

  // SSE connection with exponential-backoff reconnect (survives laptop sleep).
  React.useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let delay = RECONNECT_MIN_MS;
    let closed = false;

    const connect = () => {
      es = new EventSource("/api/me/notifications/stream");
      es.onopen = () => {
        delay = RECONNECT_MIN_MS;
      };
      es.onmessage = (event) => {
        let data: { type?: string; v?: number; workspaceId?: string };
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (data.type !== "data_changed" || data.v !== 1) return;
        if (!data.workspaceId || data.workspaceId !== workspaceIdRef.current) return;
        requestRefresh(data.workspaceId);
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (closed) return;
        reconnectTimer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, RECONNECT_MAX_MS);
      };
    };
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [requestRefresh]);

  // Flush a deferred refresh once the user becomes idle again.
  React.useEffect(() => {
    const onMaybeIdle = () => attemptFlush();
    document.addEventListener("visibilitychange", onMaybeIdle);
    window.addEventListener("focus", onMaybeIdle);
    document.addEventListener("focusout", onMaybeIdle);
    return () => {
      document.removeEventListener("visibilitychange", onMaybeIdle);
      window.removeEventListener("focus", onMaybeIdle);
      document.removeEventListener("focusout", onMaybeIdle);
    };
  }, [attemptFlush]);

  const value = React.useMemo<RealtimeContextValue>(
    () => ({
      subscribe(handler) {
        subscribersRef.current.add(handler);
        return () => {
          subscribersRef.current.delete(handler);
        };
      },
      pause() {
        interactionCountRef.current += 1;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          interactionCountRef.current = Math.max(0, interactionCountRef.current - 1);
          attemptFlush();
        };
      },
    }),
    [attemptFlush],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/** Re-fetch a client-fetched view (e.g. Sprint) when a live change arrives. */
export function useRealtimeRefetch(handler: () => void) {
  const ctx = React.useContext(RealtimeContext);
  const handlerRef = React.useRef(handler);
  handlerRef.current = handler;
  React.useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe(() => handlerRef.current());
  }, [ctx]);
}

/**
 * Returns a `pause()` to bracket a drag: call it on drag start, then call the
 * returned `resume()` on drag end/cancel so a queued refresh applies afterward.
 */
export function useRealtimePause(): () => () => void {
  const ctx = React.useContext(RealtimeContext);
  return React.useCallback(() => ctx?.pause() ?? (() => {}), [ctx]);
}
