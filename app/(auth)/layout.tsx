import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left — branding panel (hidden on mobile) */}
      <div className="hidden lg:flex flex-col justify-between bg-muted/40 border-r p-10">
        <Link href="/" className="font-semibold text-lg tracking-tight">
          Kanbanica
        </Link>
        <blockquote className="space-y-2">
          <p className="text-lg leading-relaxed text-muted-foreground">
            "Kanbanica replaced three tools for us. Spaces keep every team organized, and
            sprints finally feel effortless."
          </p>
          <footer className="text-sm font-medium">Sarah Chen — CTO, Flowboard</footer>
        </blockquote>
      </div>

      {/* Right — form area */}
      <div className="flex flex-col items-center justify-center px-4 py-12">
        {/* Mobile logo */}
        <Link href="/" className="mb-8 font-semibold text-lg tracking-tight lg:hidden">
          Kanbanica
        </Link>
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
