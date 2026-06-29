import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { LOGO_PATH, PRODUCT_NAME } from "@/config/platform";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="force-light min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src={LOGO_PATH}
              alt={PRODUCT_NAME}
              width={150}
              height={32}
              className="h-7 w-auto object-contain"
              priority
            />
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">{children}</main>
    </div>
  );
}