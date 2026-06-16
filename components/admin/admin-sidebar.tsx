"use client";

import {
  ChartBar,
  Envelope,
  ArrowLeft,
  SignOut,
  Stack,
  Users,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { PRODUCT_NAME } from "@/config/platform";

const navItems = [
  { href: "/orbit", label: "Overview", icon: ChartBar, exact: true },
  { href: "/orbit/users", label: "Users", icon: Users, exact: false },
  { href: "/orbit/queues", label: "Queues", icon: Stack, exact: false },
  { href: "/orbit/email", label: "Email", icon: Envelope, exact: false },
];

export function AdminSidebar({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
        <span className="grid size-9 shrink-0 place-items-center bg-sidebar-primary font-black text-sidebar-primary-foreground text-xs">
          KR
        </span>
        <div className="min-w-0">
          <p className="font-black text-sm leading-none">{PRODUCT_NAME}</p>
          <p className="mt-1 text-2xs font-semibold uppercase tracking-ui text-sidebar-foreground/40">
            Admin Panel
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-5">
        <p className="mb-2 px-3 text-2xs font-semibold uppercase tracking-ui text-sidebar-foreground/30">
          Navigation
        </p>
        <div className="space-y-0.5">
          {navItems.map(({ href, label, icon: Icon, exact }) => {
            const isActive = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 border-l-2 px-3 py-2.5 text-xs font-semibold uppercase tracking-ui transition-colors ${
                  isActive
                    ? "border-sidebar-foreground bg-sidebar-accent text-sidebar-foreground"
                    : "border-transparent text-sidebar-foreground/50 hover:border-sidebar-foreground/20 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
              >
                <Icon size={15} weight={isActive ? "fill" : "regular"} />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="space-y-2 border-t border-sidebar-border p-4">
        <p className="truncate px-1 text-2xs font-semibold uppercase tracking-ui text-sidebar-foreground/30">
          {email}
        </p>
        <Button
          asChild
          variant="secondary"
          size="sm"
          className="w-full justify-start gap-2"
        >
          <Link href="/dashboard">
            <ArrowLeft size={14} />
            Dashboard
          </Link>
        </Button>
        <form action={logoutAction}>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            className="w-full justify-start gap-2"
          >
            <SignOut size={14} />
            Sign out
          </Button>
        </form>
      </div>
    </aside>
  );
}
