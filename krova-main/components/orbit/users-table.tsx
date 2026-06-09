"use client";

import { ShieldCheckIcon } from "@phosphor-icons/react";
import { format } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { FilterDropdown } from "@/components/filter-dropdown";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";

interface UserRow {
  createdAt: Date;
  email: string;
  id: string;
  name: string;
  role: string | null;
  spaceCount: number;
}

const ROLE_FILTER_OPTIONS = [
  { value: "all", label: "All users" },
  { value: "admin", label: "Admins" },
  { value: "user", label: "Customers" },
];

export function UsersTable({ users }: { users: UserRow[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRole = searchParams.get("role");
  const [roleFilter, setRoleFilter] = useState<string>(
    initialRole && ROLE_FILTER_OPTIONS.some((o) => o.value === initialRole)
      ? initialRole
      : "all"
  );

  const filtered = users.filter((u) => {
    if (roleFilter === "all") {
      return true;
    }
    if (roleFilter === "admin") {
      return u.role === "admin";
    }
    return u.role !== "admin";
  });

  return (
    <DataTable
      columns={[
        {
          id: "email",
          header: "Email",
          className: "font-medium",
          cell: (u) => u.email,
        },
        {
          id: "name",
          header: "Name",
          cell: (u) => u.name,
        },
        {
          id: "signed-up",
          header: "Signed Up",
          className: "text-muted-foreground",
          cell: (u) => format(u.createdAt, "MMM d, yyyy"),
        },
        {
          id: "spaces",
          header: "Spaces",
          numeric: true,
          cell: (u) => u.spaceCount,
        },
        {
          id: "role",
          header: "Role",
          cell: (u) =>
            u.role === "admin" ? (
              <Badge className="gap-1" variant="secondary">
                <ShieldCheckIcon className="size-3" weight="fill" />
                Admin
              </Badge>
            ) : null,
        },
      ]}
      data={filtered}
      emptyDescription={
        roleFilter === "all"
          ? "No users have signed up yet."
          : "Try adjusting your filter."
      }
      emptyTitle="No users found"
      onRowClick={(u) => router.push(`/orbit/users/${u.id}`)}
      rowKey={(u) => u.id}
      searchAccessor={(u) => `${u.email} ${u.name}`}
      searchPlaceholder="Search users..."
      toolbarRight={
        <FilterDropdown
          label="Role"
          onChange={setRoleFilter}
          options={ROLE_FILTER_OPTIONS}
          value={roleFilter}
        />
      }
    />
  );
}
