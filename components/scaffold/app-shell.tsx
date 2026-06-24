import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { PRODUCT_NAME } from "@/config/platform";

const navLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/profile", label: "Profile" },
];

export function AppShell({
  children,
  email,
  isAdmin = false,
}: {
  children: ReactNode;
  email: string;
  isAdmin?: boolean;
}) {
  return (
    <div className="min-h-screen bg-page text-foreground">
      <header className="border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-3 sm:px-6">
          <Link className="flex items-center gap-3" href="/dashboard">
            <span className="grid size-9 place-items-center rounded-none bg-primary font-black text-primary-foreground text-xs">
              KR
            </span>
            <span className="font-black tracking-normal">{PRODUCT_NAME}</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <Link
                className="rounded-none px-3 py-2 text-xs font-semibold uppercase tracking-ui text-muted-foreground hover:bg-muted hover:text-foreground"
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {isAdmin && (
              <Button asChild size="sm" variant="outline">
                <Link href="/orbit">Admin Panel</Link>
              </Button>
            )}
            <span className="hidden max-w-56 truncate text-muted-foreground text-sm sm:block">
              {email}
            </span>
            <form action={logoutAction}>
              <Button size="sm" type="submit" variant="secondary">
                Sign out
              </Button>
            </form>
          </div>
        </div>

        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-3 md:hidden">
          {navLinks.map((link) => (
            <Link
              className="rounded-none px-3 py-2 text-xs font-semibold uppercase tracking-ui text-muted-foreground hover:bg-muted hover:text-foreground"
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
          {isAdmin && (
            <Link
              className="rounded-none px-3 py-2 text-xs font-semibold uppercase tracking-ui text-muted-foreground hover:bg-muted hover:text-foreground"
              href="/orbit"
            >
              Admin Panel
            </Link>
          )}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
