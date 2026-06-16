import {
  revokeSessionAction,
  signOutOtherSessionsAction,
} from "@/app/actions/profile";
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
import { formatDateTime } from "@/lib/utils";

export interface SessionRow {
  createdAt: string;
  expiresAt: string;
  id: string;
  ipAddress: string | null;
  isCurrent: boolean;
  userAgent: string | null;
}

export function SessionsCard({ sessions }: { sessions: SessionRow[] }) {
  const otherSessionCount = sessions.filter(
    (session) => !session.isCurrent
  ).length;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Active Sessions</CardTitle>
          <CardDescription>
            Review signed-in devices and revoke anything you do not recognize.
          </CardDescription>
        </div>
        {otherSessionCount > 0 && (
          <form action={signOutOtherSessionsAction}>
            <Button type="submit" variant="secondary" size="sm">
              Sign out other sessions
            </Button>
          </form>
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Session</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => (
              <TableRow key={session.id}>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">
                        {session.userAgent
                          ? describeUserAgent(session.userAgent)
                          : "Unknown device"}
                      </span>
                      {session.isCurrent && (
                        <Badge className="text-success">Current</Badge>
                      )}
                    </div>
                    <span className="max-w-md truncate text-muted-foreground text-xs">
                      {session.userAgent ?? "No user agent recorded"}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {session.ipAddress ?? "-"}
                </TableCell>
                <TableCell>{formatDateTime(session.createdAt)}</TableCell>
                <TableCell>{formatDateTime(session.expiresAt)}</TableCell>
                <TableCell>
                  {session.isCurrent ? (
                    <span className="text-muted-foreground text-sm">Protected</span>
                  ) : (
                    <form action={revokeSessionAction}>
                      <input
                        name="sessionId"
                        type="hidden"
                        value={session.id}
                      />
                      <Button type="submit" variant="secondary" size="sm">
                        Revoke
                      </Button>
                    </form>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function describeUserAgent(userAgent: string) {
  const browser = /Firefox/i.test(userAgent)
    ? "Firefox"
    : /Edg/i.test(userAgent)
      ? "Edge"
      : /Chrome/i.test(userAgent)
        ? "Chrome"
        : /Safari/i.test(userAgent)
          ? "Safari"
          : "Browser";
  const os = /Windows/i.test(userAgent)
    ? "Windows"
    : /Macintosh|Mac OS X/i.test(userAgent)
      ? "macOS"
      : /iPhone|iPad/i.test(userAgent)
        ? "iOS"
        : /Android/i.test(userAgent)
          ? "Android"
          : /Linux/i.test(userAgent)
            ? "Linux"
            : "";

  return os ? `${browser} on ${os}` : browser;
}
