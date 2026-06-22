import { getAdminSession } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

async function getAnalytics() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const hdrs = await headers();
  const res = await fetch(`${base}/api/admin/analytics/feature-usage`, {
    headers: { cookie: hdrs.get("cookie") ?? "" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to load analytics");
  return res.json();
}

export default async function AdminAnalyticsPage() {
  const session = await getAdminSession();
  if (!session) redirect("/");

  let data: any;
  try {
    data = await getAnalytics();
  } catch {
    return <div className="p-8 text-red-500">Failed to load analytics data.</div>;
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Platform usage statistics</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Tasks", value: data.totals?.tasks ?? 0 },
          { label: "Total Comments", value: data.totals?.comments ?? 0 },
          { label: "Total Spaces", value: data.totals?.spaces ?? 0 },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border bg-card p-6 text-center shadow-sm">
            <div className="text-4xl font-bold">{Number(value).toLocaleString()}</div>
            <div className="text-sm text-muted-foreground mt-2">{label}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Tasks Created — Last 30 Days</h2>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-left px-4 py-2 font-medium">Tasks Created</th>
              </tr>
            </thead>
            <tbody>
              {(data.tasksPerDay ?? []).length === 0 ? (
                <tr><td colSpan={2} className="px-4 py-4 text-center text-muted-foreground">No data</td></tr>
              ) : (data.tasksPerDay ?? []).map((row: any) => (
                <tr key={row.date} className="border-t">
                  <td className="px-4 py-2 text-muted-foreground">{row.date}</td>
                  <td className="px-4 py-2 font-medium">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
