"use client";

import {
  BarChart3,
  BookOpen,
  Building2,
  LayoutDashboard,
  LogOut,
  ScrollText,
  TicketCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PRODUCT_NAME } from "@/config/platform";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/workspaces", label: "Workspaces", icon: Building2 },
  { href: "/admin/tickets", label: "Support Tickets", icon: TicketCheck },
  { href: "/admin/help-center", label: "Help Center", icon: BookOpen },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
];

interface AdminSidebarProps {
  email?: string;
}

export function AdminSidebar({ email }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/admin/login");
  }

  return (
    <aside className="w-60 shrink-0 bg-slate-950 text-slate-100 flex flex-col h-full border-r border-slate-800">
      <div className="px-4 py-5 border-b border-slate-800 flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-emerald-400 to-emerald-600 shadow-md shadow-emerald-500/30">
          <svg
            className="h-4 w-4 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
            />
          </svg>
        </div>
        <div>
          <div className="text-2xs font-semibold text-slate-500 uppercase tracking-wider">
            {PRODUCT_NAME}
          </div>
          <div className="text-sm font-bold leading-tight">Admin Console</div>
        </div>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href);
          return (
            <Link
              className={cn(
                "relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-emerald-500/10 text-emerald-300 font-medium"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-white"
              )}
              href={item.href}
              key={item.href}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-emerald-400" />
              )}
              <Icon
                className={cn(
                  "w-4 h-4 shrink-0",
                  isActive && "text-emerald-400"
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-2 py-4 border-t border-slate-800 space-y-2">
        {email && (
          <div className="px-3 text-xs text-slate-500 truncate" title={email}>
            {email}
          </div>
        )}
        <button
          className="flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          onClick={handleSignOut}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
