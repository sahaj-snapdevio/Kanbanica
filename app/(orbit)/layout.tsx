import type { ReactNode } from "react";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { requireAdmin } from "@/lib/authz";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireAdmin();

  return (
    <div className="flex h-screen overflow-hidden bg-page">
      <AdminSidebar email={session.user.email} />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
