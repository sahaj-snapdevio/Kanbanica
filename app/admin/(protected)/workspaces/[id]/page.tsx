"use client";

import { useRouter } from "next/navigation";
import { use, useState } from "react";
import useSWR from "swr";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function AdminWorkspaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data } = useSWR(`/api/admin/workspaces/${id}`, fetcher);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const ws = data?.workspace;
  const members: any[] = data?.members ?? [];
  const stats = data?.stats ?? { spaces: 0, tasks: 0, comments: 0 };

  async function handleForceDelete() {
    if (confirmName !== ws?.name) {
      return;
    }
    setDeleting(true);
    const res = await fetch(`/api/admin/workspaces/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Force deleted by admin" }),
    });
    if (res.ok) {
      router.push("/admin/workspaces");
    } else {
      setDeleting(false);
    }
  }

  if (!ws) {
    return <div className="p-8 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{ws.name}</h1>
          <p className="text-muted-foreground text-sm">/{ws.slug}</p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">Force Delete</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Force Delete Workspace</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete <strong>{ws.name}</strong> and all
                its data. Type the workspace name to confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={ws.name}
              value={confirmName}
            />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90"
                disabled={confirmName !== ws.name || deleting}
                onClick={handleForceDelete}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Spaces", value: stats.spaces },
          { label: "Tasks", value: stats.tasks },
          { label: "Comments", value: stats.comments },
        ].map(({ label, value }) => (
          <div className="border rounded-lg p-4 text-center" key={label}>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-sm text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">
          Members ({members.length})
        </h2>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Email</th>
                <th className="text-left px-4 py-2 font-medium">Role</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-4 text-center text-muted-foreground"
                    colSpan={4}
                  >
                    No members
                  </td>
                </tr>
              ) : (
                members.map((m) => (
                  <tr className="border-t" key={m.id}>
                    <td className="px-4 py-2">{m.userName ?? "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {m.userEmail ?? m.email ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="secondary">{m.role}</Badge>
                    </td>
                    <td className="px-4 py-2">{m.status}</td>
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
