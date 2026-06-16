import { desc } from "drizzle-orm";
import { OrbitPageHeader } from "@/components/admin/orbit-page-header";
import { UserBanForm, UserRoleForm } from "@/components/orbit/user-actions";
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
import { ADMIN_ROLE } from "@/config/platform";
import { user } from "@/db/schema";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";

export const metadata = {
  title: "Users",
};

export default async function OrbitUsersPage() {
  const users = await db.select().from(user).orderBy(desc(user.createdAt));

  return (
    <div>
      <OrbitPageHeader
        eyebrow="Admin"
        title="User Management"
        description="Promote admins, disable accounts, and inspect basic account state."
      />

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>All registered accounts ordered by sign-up date.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-semibold">{item.email}</div>
                    <div className="text-muted-foreground text-xs">{item.name}</div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        item.role === ADMIN_ROLE
                          ? "text-success"
                          : undefined
                      }
                      variant={
                        item.role === ADMIN_ROLE ? "default" : "secondary"
                      }
                    >
                      {item.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={item.banned ? undefined : "text-success"}
                      variant={item.banned ? "destructive" : "default"}
                    >
                      {item.banned ? "banned" : "active"}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(item.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <UserRoleForm role={item.role} userId={item.id} />
                      <UserBanForm banned={item.banned} userId={item.id} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
