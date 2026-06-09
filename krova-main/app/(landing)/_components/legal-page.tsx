import Link from "next/link";
import type { ReactNode } from "react";

import { Separator } from "@/components/ui/separator";

interface LegalPageProps {
  children: ReactNode;
  intro?: ReactNode;
  lastUpdated: string;
  title: string;
}

export function LegalPage({
  title,
  lastUpdated,
  intro,
  children,
}: LegalPageProps) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Last updated: {lastUpdated}
        </p>
        {intro && (
          <div className="mt-6 text-base leading-relaxed text-muted-foreground">
            {intro}
          </div>
        )}
      </header>

      <Separator className="mb-10" />

      <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>

      <Separator className="my-10" />

      <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <Link className="transition-colors hover:text-foreground" href="/terms">
          Terms of Service
        </Link>
        <Separator className="h-3" orientation="vertical" />
        <Link
          className="transition-colors hover:text-foreground"
          href="/privacy"
        >
          Privacy Policy
        </Link>
        <Separator className="h-3" orientation="vertical" />
        <Link className="transition-colors hover:text-foreground" href="/aup">
          Acceptable Use Policy
        </Link>
        <Separator className="h-3" orientation="vertical" />
        <Link
          className="transition-colors hover:text-foreground"
          href="/cookies"
        >
          Cookie Policy
        </Link>
      </nav>
    </article>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="scroll-mt-20" id={id}>
      <h2 className="mb-3 text-xl font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function LegalSubheading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-5 mb-1.5 text-base font-semibold text-foreground">
      {children}
    </h3>
  );
}

export function LegalList({
  children,
  ordered = false,
}: {
  children: ReactNode;
  ordered?: boolean;
}) {
  const className = "ml-6 space-y-1.5 [&>li]:pl-1";
  return ordered ? (
    <ol className={`list-decimal ${className}`}>{children}</ol>
  ) : (
    <ul className={`list-disc ${className}`}>{children}</ul>
  );
}
