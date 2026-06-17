"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function useDebounce<T>(value: T, delay: number): T {
  const [dv, setDv] = useState(value);
  useState(() => {
    const t = setTimeout(() => setDv(value), delay);
    return () => clearTimeout(t);
  });
  return dv;
}

export default function AdminWorkspacesPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // manual debounce
  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
    clearTimeout((handleSearch as any)._t);
    (handleSearch as any)._t = setTimeout(() => setDebouncedSearch(val), 300);
  };

  const params = new URLSearchParams({ page: String(page) });
  if (debouncedSearch) params.set("search", debouncedSearch);

  const { data, isLoading } = useSWR(`/api/admin/workspaces?${params}`, fetcher);
  const workspaces: any[] = data?.workspaces ?? [];
  const total: number = data?.total ?? 0;
  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Workspaces</h1>
        <p className="text-muted-foreground text-sm mt-1">{total.toLocaleString()} total workspaces</p>
      </div>

      <Input placeholder="Search by name…" value={search} onChange={(e) => handleSearch(e.target.value)} className="max-w-sm" />

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Owner</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : workspaces.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No workspaces found</td></tr>
            ) : (
              workspaces.map((w) => (
                <tr key={w.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-2">
                    <Link href={`/admin/workspaces/${w.id}`} className="hover:underline font-medium">{w.name}</Link>
                    <div className="text-xs text-muted-foreground">{w.slug}</div>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{w.ownerEmail ?? w.createdBy}</td>
                  <td className="px-4 py-2">
                    <Badge variant={w.status === "ACTIVE" ? "secondary" : "destructive"}>{w.status}</Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{new Date(w.createdAt).toLocaleDateString()}</td>
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
