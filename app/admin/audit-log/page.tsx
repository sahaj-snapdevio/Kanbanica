"use client";

import { useState } from "react";
import useSWR from "swr";
import { Input } from "@/components/ui/input";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function AdminAuditLogPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page) });
  if (search) params.set("search", search);

  const { data, isLoading } = useSWR(`/api/admin/audit-log?${params}`, fetcher);
  const logs: any[] = data?.logs ?? [];
  const total: number = data?.total ?? 0;
  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <p className="text-muted-foreground text-sm mt-1">{total.toLocaleString()} entries</p>
      </div>

      <Input
        placeholder="Search by action…"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        className="max-w-sm"
      />

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Timestamp</th>
              <th className="text-left px-4 py-2 font-medium">Action</th>
              <th className="text-left px-4 py-2 font-medium">Actor</th>
              <th className="text-left px-4 py-2 font-medium">Entity</th>
              <th className="text-left px-4 py-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No entries found</td></tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-2 text-muted-foreground whitespace-nowrap text-xs">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{log.action}</td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">{log.actorEmail ?? log.actorId ?? "—"}</td>
                  <td className="px-4 py-2 text-xs">
                    <span className="text-muted-foreground">{log.entityType}</span>
                    {log.entityId && <span className="text-muted-foreground"> / {log.entityId.slice(0, 8)}…</span>}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">{log.description}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded text-sm disabled:opacity-50">Previous</button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 border rounded text-sm disabled:opacity-50">Next</button>
        </div>
      )}
    </div>
  );
}
