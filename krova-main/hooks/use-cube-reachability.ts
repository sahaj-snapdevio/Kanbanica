"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import type {
  CubeMetricsSnapshot,
  CubeReachabilitySnapshot,
} from "@/db/schema/cubes";
import { usePusherChannel, usePusherEvent } from "@/hooks/use-pusher";
import { fetcher } from "@/lib/fetcher";

export interface CubeLiveStatus {
  lastReachabilityAt: string | null;
  metrics: CubeMetricsSnapshot | null;
  reachability: CubeReachabilitySnapshot | null;
}

interface PusherReachabilityEvent {
  cubeId?: string;
  lastReachabilityAt?: string | null;
  metrics?: CubeMetricsSnapshot | null;
  reachability?: CubeReachabilitySnapshot | null;
}

interface CubeApiResponse {
  cube?: {
    reachabilityJsonb?: CubeReachabilitySnapshot | null;
    lastMetricsJsonb?: CubeMetricsSnapshot | null;
    lastReachabilityAt?: string | null;
  };
}

/**
 * Per-cube live-status hook — subscribes to the `cube.reachability` Pusher
 * event for snappy updates and falls back to a 60s SWR poll for missed
 * events. Pure observer: never mutates cube state.
 *
 * Mirrors the prop-resync pattern from `use-cube-status` so a router.refresh
 * (which re-runs the parent server component with fresh DB state) replaces
 * the in-memory snapshot without flashing stale data.
 */
export function useCubeReachability(
  cubeId: string,
  spaceId: string,
  initial: CubeLiveStatus
): CubeLiveStatus {
  const [prevInitial, setPrevInitial] = useState(initial);
  const [data, setData] = useState<CubeLiveStatus>(initial);

  if (
    prevInitial.lastReachabilityAt !== initial.lastReachabilityAt ||
    prevInitial.reachability !== initial.reachability ||
    prevInitial.metrics !== initial.metrics
  ) {
    setPrevInitial(initial);
    setData(initial);
  }

  const channel = usePusherChannel(`private-cube-${cubeId}`);

  const handleEvent = useCallback((eventData: unknown) => {
    const evt = eventData as PusherReachabilityEvent;
    setData((prev) => ({
      reachability:
        evt.reachability === undefined ? prev.reachability : evt.reachability,
      metrics: evt.metrics === undefined ? prev.metrics : evt.metrics,
      lastReachabilityAt:
        evt.lastReachabilityAt === undefined
          ? prev.lastReachabilityAt
          : evt.lastReachabilityAt,
    }));
  }, []);

  usePusherEvent(channel, "cube.reachability", handleEvent);

  // Polling fallback. The reachability cron writes every minute, so 60s is
  // the right cadence — anything faster is wasted work; anything slower lets
  // a missed Pusher event linger on screen.
  useSWR<CubeApiResponse>(`/api/spaces/${spaceId}/cubes/${cubeId}`, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    onSuccess: (response) => {
      const cube = response?.cube;
      if (!cube) {
        return;
      }
      setData((prev) => ({
        reachability:
          cube.reachabilityJsonb === undefined
            ? prev.reachability
            : cube.reachabilityJsonb,
        metrics:
          cube.lastMetricsJsonb === undefined
            ? prev.metrics
            : cube.lastMetricsJsonb,
        lastReachabilityAt:
          cube.lastReachabilityAt === undefined
            ? prev.lastReachabilityAt
            : cube.lastReachabilityAt,
      }));
    },
  });

  return data;
}
