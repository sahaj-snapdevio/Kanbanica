"use client";

import { useCallback, useState } from "react";
import type { CubeStatusValue } from "@/db/schema/types";
import { usePusherChannel, usePusherEvent } from "@/hooks/use-pusher";

interface CubeStatusChangeEvent {
  cubeId: string;
  status: CubeStatusValue;
}

/**
 * Subscribe to a single space-level Pusher channel and track Cube status
 * changes for all Cubes in the space. Returns a map of cubeId → latest status.
 */
export function useSpaceCubeStatuses(spaceId: string) {
  const [statuses, setStatuses] = useState<Record<string, CubeStatusValue>>({});

  const channel = usePusherChannel(`private-space-${spaceId}`);

  const handleStatusChange = useCallback((data: unknown) => {
    const event = data as CubeStatusChangeEvent;
    if (event.cubeId && event.status) {
      setStatuses((prev) => {
        if (prev[event.cubeId] === event.status) {
          return prev;
        }
        return { ...prev, [event.cubeId]: event.status };
      });
    }
  }, []);

  usePusherEvent(channel, "cube.status-change", handleStatusChange);

  return statuses;
}
