"use client";

import PusherClient, { type Channel } from "pusher-js";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

let pusherInstance: PusherClient | null = null;
let _pusherConfig: {
  key: string;
  cluster: string;
  host?: string;
  port?: number;
} | null = null;

/**
 * Initialize the Pusher client config. Must be called before any hooks.
 * Called by DashboardShell with config from the server (DB → layout → shell).
 */
export function initPusherConfig(config: {
  key: string;
  cluster: string;
  host?: string;
  port?: number;
}) {
  // Only reinitialize if config actually changed
  if (
    _pusherConfig?.key === config.key &&
    _pusherConfig?.cluster === config.cluster &&
    _pusherConfig?.host === config.host &&
    _pusherConfig?.port === config.port
  ) {
    return;
  }

  _pusherConfig = config;

  // Disconnect existing instance if config changed
  if (pusherInstance) {
    pusherInstance.disconnect();
    pusherInstance = null;
  }
}

function getPusherClient(): PusherClient | null {
  if (!pusherInstance) {
    if (!_pusherConfig) {
      return null;
    }

    // Soketi mode: use custom wsHost/wsPort. Pusher cloud mode: use cluster.
    const options = _pusherConfig.host
      ? {
          wsHost: _pusherConfig.host,
          wsPort: _pusherConfig.port ?? 443,
          wssPort: _pusherConfig.port ?? 443,
          forceTLS: true,
          disableStats: true,
          enabledTransports: ["ws" as const, "wss" as const],
          cluster: _pusherConfig.cluster || "default",
          channelAuthorization: {
            endpoint: "/api/pusher/auth",
            transport: "ajax" as const,
          },
        }
      : {
          cluster: _pusherConfig.cluster,
          channelAuthorization: {
            endpoint: "/api/pusher/auth",
            transport: "ajax" as const,
          },
        };

    pusherInstance = new PusherClient(_pusherConfig.key, options);
  }
  return pusherInstance;
}

export function usePusherChannel(channelName: string): Channel | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const pusher = getPusherClient();
      if (!pusher) {
        return () => {};
      }
      const ch = pusher.subscribe(channelName);
      ch.bind("pusher:subscription_succeeded", onStoreChange);

      return () => {
        ch.unbind("pusher:subscription_succeeded", onStoreChange);
        pusher.unsubscribe(channelName);
      };
    },
    [channelName]
  );

  const getSnapshot = useCallback(() => {
    const pusher = getPusherClient();
    if (!pusher) {
      return null;
    }
    return pusher.channel(channelName) ?? null;
  }, [channelName]);

  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

export function usePusherEvent(
  channel: Channel | null,
  eventName: string,
  callback: (data: unknown) => void
) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!channel) {
      return;
    }

    const handler = (data: unknown) => {
      callbackRef.current(data);
    };

    channel.bind(eventName, handler);

    return () => {
      channel.unbind(eventName, handler);
    };
  }, [channel, eventName]);
}

export { getPusherClient };
