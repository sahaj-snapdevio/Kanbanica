"use client";

import { use, useState } from "react";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, mutate } = useSWR(`/api/admin/users/${id}`, fetcher);
  const [loading, setLoading] = useState(false);

  const u = data?.user;
  const sessions: any[] = data?.sessions ?? [];
  const workspaces: any[] = data?.workspaces ?? [];

  async function handleBan() {
    setLoading(true);
    await fetch(`/api/admin/users/${id}/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await mutate();
    setLoading(false);
  }

  async function handleUnban() {
    setLoading(true);
    await fetch(`/api/admin/users/${id}/unban`, { method: "POST" });
    await mutate();
    setLoading(false);
  }

  async function handleImpersonate() {
    const res = await fetch(`/api/admin/users/${id}/impersonate`, {
      method: "POST",
    });
    if (res.ok) {
      window.location.href = "/";
    }
  }

  if (!u) {
    return <div className="p-8 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{u.name}</h1>
          <p className="text-muted-foreground">{u.email}</p>
        </div>
        <div className="flex gap-2">
          {u.banned ? (
            <Button disabled={loading} onClick={handleUnban} variant="outline">
              Unban
            </Button>
          ) : (
            <Button
              disabled={loading}
              onClick={handleBan}
              variant="destructive"
            >
              Ban User
            </Button>
          )}
          <Button onClick={handleImpersonate} variant="outline">
            Impersonate
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Status",
            value: u.banned ? (
              <Badge variant="destructive">Banned</Badge>
            ) : (
              <Badge variant="secondary">Active</Badge>
            ),
          },
          {
            label: "Role",
            value: u.role === "admin" ? <Badge>Admin</Badge> : "User",
          },
          { label: "Email Verified", value: u.emailVerified ? "Yes" : "No" },
          {
            label: "Joined",
            value: new Date(u.createdAt).toLocaleDateString(),
          },
        ].map(({ label, value }) => (
          <div className="border rounded-lg p-4" key={label}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 font-medium">{value}</div>
          </div>
        ))}
      </div>

      {u.banReason && (
        <div className="border border-destructive/30 bg-destructive/5 rounded-lg p-4">
          <div className="text-sm font-medium text-destructive">Ban Reason</div>
          <div className="text-sm mt-1">{u.banReason}</div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-3">
          Workspaces ({workspaces.length})
        </h2>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Workspace</th>
                <th className="text-left px-4 py-2 font-medium">Role</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-4 text-center text-muted-foreground"
                    colSpan={4}
                  >
                    No workspaces
                  </td>
                </tr>
              ) : (
                workspaces.map((w) => (
                  <tr className="border-t" key={w.workspaceId}>
                    <td className="px-4 py-2 font-medium">{w.workspaceName}</td>
                    <td className="px-4 py-2">{w.role}</td>
                    <td className="px-4 py-2">{w.status}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {w.joinedAt
                        ? new Date(w.joinedAt).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">
          Active Sessions ({sessions.length})
        </h2>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Created</th>
                <th className="text-left px-4 py-2 font-medium">Expires</th>
                <th className="text-left px-4 py-2 font-medium">IP</th>
                <th className="text-left px-4 py-2 font-medium">
                  Impersonated By
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-4 text-center text-muted-foreground"
                    colSpan={4}
                  >
                    No active sessions
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr className="border-t" key={s.id}>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(s.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(s.expiresAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {s.ipAddress ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {s.impersonatedBy ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
