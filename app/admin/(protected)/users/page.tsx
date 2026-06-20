"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function useDebounce<T>(value: T, delay: number): T {
  const [dv, setDv] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDv(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return dv;
}

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "banned", label: "Banned" },
];

export default function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 300);

  const params = new URLSearchParams({ page: String(page), status });
  if (debouncedSearch) params.set("search", debouncedSearch);

  const { data, isLoading } = useSWR(`/api/admin/users?${params}`, fetcher);

  const users: any[] = data?.users ?? [];
  const total: number = data?.total ?? 0;
  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-muted-foreground text-sm mt-1">{total.toLocaleString()} total users</p>
      </div>

      <div className="flex gap-4 items-center">
        <Input
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="max-w-sm"
        />
        <div className="flex gap-1 border rounded-md p-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setStatus(tab.key); setPage(1); }}
              className={`px-3 py-1 text-sm rounded transition-colors ${status === tab.key ? "bg-foreground text-background" : "hover:bg-muted"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Email</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Role</th>
              <th className="text-left px-4 py-2 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No users found</td></tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-t hover:bg-muted/30 cursor-pointer">
                  <td className="px-4 py-2">
                    <Link href={`/admin/users/${u.id}`} className="hover:underline font-medium">
                      {u.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-2">
                    {u.banned ? (
                      <Badge variant="destructive">Banned</Badge>
                    ) : (
                      <Badge variant="secondary">Active</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {u.role === "admin" ? <Badge>Admin</Badge> : <span className="text-muted-foreground">User</span>}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded text-sm disabled:opacity-50">
            Previous
          </button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 border rounded text-sm disabled:opacity-50">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
