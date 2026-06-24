import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { AppShell } from "@/components/scaffold/app-shell";
import { PageHeader } from "@/components/scaffold/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ADMIN_ROLE } from "@/config/platform";
import { auditLogs, emailOutbox, user } from "@/db/schema";
import { requireSession } from "@/lib/authz";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";

export const metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const session = await requireSession();
  const [freshUser] = await db
    .select()
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  const [emails, audits] = await Promise.all([
    db.select().from(emailOutbox).orderBy(desc(emailOutbox.createdAt)).limit(5),
    db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorId, session.user.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(8),
  ]);

  return (
    <AppShell
      email={freshUser?.email ?? session.user.email}
      isAdmin={freshUser?.role === ADMIN_ROLE}
    >
      <PageHeader
        description="A clean authenticated starting point for your product UI."
        eyebrow="Workspace"
        title={`Welcome, ${freshUser?.name ?? freshUser?.email ?? session.user.email}`}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Authentication</CardTitle>
            <CardDescription>
              Email verification and magic-link login status.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge
              className={
                freshUser?.emailVerified ? "text-success" : "text-warning"
              }
            >
              {freshUser?.emailVerified ? "Verified" : "Magic-link ready"}
            </Badge>
            <p className="text-muted-foreground text-sm">
              Magic-link login is wired through Better Auth and the email
              outbox.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Role</CardTitle>
            <CardDescription>
              Your current access level in this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge
              className={
                freshUser?.role === ADMIN_ROLE ? "text-success" : undefined
              }
              variant={freshUser?.role === ADMIN_ROLE ? "default" : "secondary"}
            >
              {freshUser?.role ?? "user"}
            </Badge>
            <p className="text-muted-foreground text-sm">
              Promote admins with <code>pnpm make:admin user@example.com</code>.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Next Surface</CardTitle>
            <CardDescription>
              Replace this with your own product UI.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Replace this dashboard with your application logic while keeping
              the auth/admin/worker backbone.
            </p>
            <Button asChild size="sm" variant="secondary">
              <Link href="/dashboard/profile">Edit profile</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Email Outbox</CardTitle>
            <CardDescription>
              Latest transactional emails sent from this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {emails.map((email) => (
                  <TableRow key={email.id}>
                    <TableCell>{email.payload.subject}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          email.status === "sent"
                            ? "text-success"
                            : "text-warning"
                        }
                      >
                        {email.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(email.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent Audit</CardTitle>
            <CardDescription>
              Your recent account actions and security events.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audits.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.action}</TableCell>
                    <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
