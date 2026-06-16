import { count, desc } from "drizzle-orm";
import { OrbitPageHeader } from "@/components/admin/orbit-page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ADMIN_ROLE } from "@/config/platform";
import { emailOutbox, user } from "@/db/schema";
import { db } from "@/lib/db";
import { getQueueSummary } from "@/lib/worker/queue-inspection";

export const metadata = {
  title: "Orbit",
};

export default async function OrbitPage() {
  const [[userCount], [emailCount], queues, recentUsers] = await Promise.all([
    db.select({ count: count() }).from(user),
    db.select({ count: count() }).from(emailOutbox),
    getQueueSummary(),
    db.select().from(user).orderBy(desc(user.createdAt)).limit(5),
  ]);

  return (
    <div>
      <OrbitPageHeader
        eyebrow="Admin"
        title="Overview"
        description="Operator surface for users, queues, email, and audit-ready admin actions."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatBlock label="Total Users" value={userCount.count} />
        <StatBlock label="Outbox Emails" value={emailCount.count} />
        <StatBlock label="Queue States" value={queues.length} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent Users</CardTitle>
          <CardDescription>The five most recently registered accounts.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {recentUsers.map((item) => (
              <div
                className="flex items-center gap-3 px-(--card-spacing) py-3"
                key={item.id}
              >
                <span className="grid size-8 shrink-0 place-items-center bg-muted font-black text-xs text-muted-foreground">
                  {(item.name ?? item.email).slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.email}</p>
                  {item.name && (
                    <p className="truncate text-muted-foreground text-xs">{item.name}</p>
                  )}
                </div>
                <Badge
                  className={item.role === ADMIN_ROLE ? "text-success" : undefined}
                  variant={item.role === ADMIN_ROLE ? "default" : "secondary"}
                >
                  {item.role}
                </Badge>
                <span className="hidden font-mono text-muted-foreground text-xs sm:block">
                  {item.id.slice(0, 8)}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border bg-card p-6">
      <p className="text-2xs font-semibold uppercase tracking-ui text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-black text-4xl tracking-normal">{value}</p>
    </div>
  );
}
