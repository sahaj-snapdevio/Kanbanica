"use client";

import { ListIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const NAV_LINKS = [
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs/api", label: "Docs" },
];

/**
 * Mobile navigation (under `md`). The desktop header hides the Security /
 * Pricing / Docs links and the auth buttons on small screens, so without this
 * a phone user could only see the logo + nothing actionable. This hamburger
 * opens a sheet with every nav destination; each link closes the sheet on tap.
 */
export function MobileNav({
  authed,
  dashboardHref,
}: {
  authed: boolean;
  dashboardHref: string;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          aria-label="Open menu"
          className="md:hidden"
          size="icon"
          variant="ghost"
        >
          <ListIcon className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-72" side="right">
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col px-4">
          {NAV_LINKS.map((link) => (
            <SheetClose asChild key={link.href}>
              <Link
                className="border-b py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                href={link.href}
              >
                {link.label}
              </Link>
            </SheetClose>
          ))}
        </nav>
        <Separator className="my-4" />
        <div className="flex flex-col gap-2 px-4">
          {authed ? (
            <SheetClose asChild>
              <Button asChild className="w-full">
                <Link href={dashboardHref}>Dashboard</Link>
              </Button>
            </SheetClose>
          ) : (
            <>
              <SheetClose asChild>
                <Button asChild className="w-full" variant="outline">
                  <Link href="/login">Log in</Link>
                </Button>
              </SheetClose>
              <SheetClose asChild>
                <Button asChild className="w-full">
                  <Link href="/signup">Sign up</Link>
                </Button>
              </SheetClose>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
