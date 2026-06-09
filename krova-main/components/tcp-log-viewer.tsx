"use client";

import { useEffect, useRef, useState } from "react";

interface TcpLogViewerProps {
  cubeId: string;
  hostPort: number;
  mappingId: string;
  spaceId: string;
}

export function TcpLogViewer({
  spaceId,
  cubeId,
  mappingId,
  hostPort,
}: TcpLogViewerProps) {
  const [lines, setLines] = useState<{ id: number; content: string }[]>([]);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lineIdRef = useRef(0);

  useEffect(() => {
    const es = new EventSource(
      `/api/spaces/${spaceId}/cubes/${cubeId}/tcp-mappings/${mappingId}/logs`
    );

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.error) {
          setError(data.error);
          setConnected(false);
          es.close();
        } else if (data.line) {
          setLines((prev) => {
            const next = [
              ...prev,
              { id: ++lineIdRef.current, content: data.line as string },
            ];
            return next.length > 500 ? next.slice(-500) : next;
          });
        }
      } catch {
        // ignore
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
    };

    return () => {
      es.close();
    };
  }, [spaceId, cubeId, mappingId]);

  const lineCount = lines.length;
  useEffect(() => {
    if (lineCount > 0 && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lineCount]);

  return (
    <div className="mt-4 rounded-md border bg-muted/30">
      <div className="flex items-center justify-between border-b p-2 text-xs">
        <span className="text-muted-foreground">port {hostPort}</span>
        {connected ? (
          <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            Capturing
          </span>
        ) : (
          <span className="text-muted-foreground">Disconnected</span>
        )}
      </div>
      {error && (
        <p className="border-b p-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div
        className="max-h-[60vh] overflow-y-auto bg-background p-2 font-mono text-[11px] leading-relaxed"
        ref={containerRef}
      >
        {lines.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground">
            {connected ? "Waiting for TCP connections..." : "Disconnected"}
          </p>
        ) : (
          lines.map((line) => (
            <div className="whitespace-pre-wrap" key={line.id}>
              {line.content}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
