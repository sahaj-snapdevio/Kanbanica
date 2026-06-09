"use client";

import { ShieldCheckIcon, SignOutIcon, UserIcon } from "@phosphor-icons/react";
import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth-client";

export function UserMenu({
  name,
  email,
  image,
  role,
}: {
  name: string;
  email: string;
  image: string | null;
  role: string | null;
}) {
  const isAdmin = role === "admin";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="size-8 rounded-full" size="icon" variant="ghost">
          <Avatar className="size-8">
            <AvatarImage alt={name} src={image || undefined} />
            <AvatarFallback className="text-xs">
              {name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">{email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserIcon className="size-4" />
            <span>Profile</span>
          </Link>
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/orbit/users">
              <ShieldCheckIcon className="size-4" />
              <span>Orbit Admin</span>
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            signOut({
              fetchOptions: {
                onSuccess: () => {
                  window.location.href = "/login";
                },
              },
            })
          }
        >
          <SignOutIcon className="size-4" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
