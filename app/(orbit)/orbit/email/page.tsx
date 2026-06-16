import { desc } from "drizzle-orm";
import { OrbitPageHeader } from "@/components/admin/orbit-page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { emailEvents, emailOutbox } from "@/db/schema";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";

export const metadata = {
  title: "Email",
};

export default async function OrbitEmailPage() {
  const [outbox, events] = await Promise.all([
    db
      .select()
      .from(emailOutbox)
      .orderBy(desc(emailOutbox.createdAt))
      .limit(50),
    db
      .select()
      .from(emailEvents)
      .orderBy(desc(emailEvents.receivedAt))
      .limit(50),
  ]);

  return (
    <div>
      <OrbitPageHeader
        eyebrow="Admin"
        title="Email"
        description="Transactional email queue and inbound delivery events."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Outbox</CardTitle>
            <CardDescription>Queued and delivered transactional emails.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outbox.map((email) => (
                  <TableRow key={email.id}>
                    <TableCell>{email.payload.to}</TableCell>
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
                    <TableCell>{email.attemptCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Events</CardTitle>
            <CardDescription>Inbound webhook events from your SMTP provider.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>{event.eventType}</TableCell>
                    <TableCell>{event.recipient ?? "-"}</TableCell>
                    <TableCell>{formatDateTime(event.receivedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
