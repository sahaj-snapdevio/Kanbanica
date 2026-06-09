"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import type { CubeStatusValue } from "@/db/schema/types";
import { usePusherChannel, usePusherEvent } from "@/hooks/use-pusher";
import { fetcher } from "@/lib/fetcher";

interface CubeStatusData {
  internalIp: string | null;
  status: CubeStatusValue;
}

interface CubeApiResponse {
  cube?: {
    status?: CubeStatusValue;
    internalIp?: string | null;
  };
}

interface LifecycleUpdateEvent {
  internalIp?: string | null;
  status?: CubeStatusValue;
}

export function useCubeStatus(
  cubeId: string,
  initialStatus: CubeStatusValue,
  initialIp?: string | null,
  spaceId?: string
): CubeStatusData {
  // Track previous server-rendered props to only sync when they actually change
  // (e.g. after router.refresh()), not when WebSocket updates differ from stale props.
  // Uses useState instead of useRef to be compatible with the React Compiler.
  const [prevProps, setPrevProps] = useState({
    status: initialStatus,
    ip: initialIp ?? null,
  });
  const [data, setData] = useState<CubeStatusData>({
    status: initialStatus,
    internalIp: initialIp ?? null,
  });

  if (
    prevProps.status !== initialStatus ||
    prevProps.ip !== (initialIp ?? null)
  ) {
    setPrevProps({ status: initialStatus, ip: initialIp ?? null });
    setData({ status: initialStatus, internalIp: initialIp ?? null });
  }

  const channel = usePusherChannel(`private-cube-${cubeId}`);

  const handleUpdate = useCallback((eventData: unknown) => {
    const update = eventData as LifecycleUpdateEvent;
    setData((prev) => ({
      status: update.status ?? prev.status,
      internalIp:
        update.internalIp === undefined ? prev.internalIp : update.internalIp,
    }));
  }, []);

  usePusherEvent(channel, "lifecycle.update", handleUpdate);

  // Reconcile + polling fallback. Pusher events can miss for many reasons
  // (channel auth race during cube creation, transient disconnect, browser
  // background-throttling, etc.). Without a poll, a missed `lifecycle.update`
  // means the operator sees stale status until they reload the tab.
  //
  // Strategy:
  //   - Poll every 4s while the cube is in a TRANSIENT state (pending,
  //     booting, stopping). These are short windows where status changes
  //     fast and missing the event leaves the UI stuck.
  //   - Slow poll every 30s while in a STABLE state, as a safety net for
  //     missed Pusher events on long-running boxes (cube failure, manual
  //     server intervention, etc.).
  //   - Pusher events still drive the snappy real-time updates; polling is
  //     just a backstop.
  const transientStates: CubeStatusValue[] = ["pending", "booting", "stopping"];
  const isTransient = transientStates.includes(data.status);
  const shouldFetch = !!spaceId;
  useSWR<CubeApiResponse>(
    shouldFetch ? `/api/spaces/${spaceId}/cubes/${cubeId}` : null,
    fetcher,
    {
      refreshInterval: isTransient ? 4000 : 30_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      onSuccess: (response) => {
        const cube = response?.cube;
        if (!cube) {
          return;
        }
        setData((prev) => ({
          status: cube.status ?? prev.status,
          internalIp:
            cube.internalIp === undefined ? prev.internalIp : cube.internalIp,
        }));
      },
    }
  );

  return data;
}
