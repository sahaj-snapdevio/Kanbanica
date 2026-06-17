import { getAdminSession } from "@/lib/admin-auth";
import { redirect } from "next/navigation";

interface DashboardData {
  totalUsers: number;
  totalWorkspaces: number;
  totalTasks: number;
  openTickets: number;
  newSignupsToday: number;
  newSignupsThisMonth: number;
  recentActivity: Array<{
    id: string;
    action: string;
    actorId: string | null;
    actorEmail: string | null;
    entityType: string;
    entityId: string | null;
    description: string;
    createdAt: string;
  }>;
}

async function getDashboard(): Promise<DashboardData> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { headers } = await import("next/headers");
  const hdrs = await headers();
  const res = await fetch(`${base}/api/admin/dashboard`, {
    headers: { cookie: hdrs.get("cookie") ?? "" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to load dashboard");
  return res.json();
}

const STAT_CARDS = [
  { key: "totalUsers", label: "Total Users" },
  { key: "totalWorkspaces", label: "Total Workspaces" },
  { key: "totalTasks", label: "Total Tasks" },
  { key: "openTickets", label: "Open Tickets" },
  { key: "newSignupsToday", label: "Signups Today" },
  { key: "newSignupsThisMonth", label: "Signups This Month" },
] as const;

export default async function AdminDashboardPage() {
  const session = await getAdminSession();
  if (!session) redirect("/");

  let data: DashboardData;
  try {
    data = await getDashboard();
  } catch {
    return <div className="p-8 text-red-500">Failed to load dashboard data.</div>;
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Platform overview</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {STAT_CARDS.map(({ key, label }) => (
          <div key={key} className="rounded-lg border bg-card p-5 shadow-sm">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="text-3xl font-bold mt-1">{(data[key] as number).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Recent Activity</h2>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Time</th>
                <th className="text-left px-4 py-2 font-medium">Action</th>
                <th className="text-left px-4 py-2 font-medium">Actor</th>
                <th className="text-left px-4 py-2 font-medium">Entity</th>
              </tr>
            </thead>
            <tbody>
              {data.recentActivity.map((entry) => (
                <tr key={entry.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{entry.action}</td>
                  <td className="px-4 py-2 text-muted-foreground">{entry.actorEmail ?? entry.actorId ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {entry.entityType}
                    {entry.entityId ? ` / ${entry.entityId.slice(0, 8)}…` : ""}
                  </td>
                </tr>
              ))}
              {data.recentActivity.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    No activity yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
