import {
  GaugeIcon,
  SignInIcon,
  UserPlusIcon,
} from "@phosphor-icons/react/dist/ssr";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { CookieSettingsLink } from "@/components/cookie-settings-link";
import { MobileNav } from "@/components/landing/mobile-nav";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { UserMenu } from "@/components/user-menu";
import { LOGO_PATH, PLATFORM_EMAILS, PRODUCT_NAME } from "@/config/platform";
import { auth } from "@/lib/auth";

export default async function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user as
    | {
        id: string;
        name: string;
        email: string;
        image: string | null;
        role?: string | null;
      }
    | undefined;
  const role = user?.role ?? null;
  const dashboardHref = "/post-auth";

  const productName = PRODUCT_NAME;

  return (
    <div className="flex min-h-svh flex-col">
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link className="flex items-center gap-2" href="/">
            <Image
              alt={productName}
              className="h-7 w-auto object-contain"
              height={646}
              priority
              src={LOGO_PATH}
              width={1000}
            />
            <span className="text-lg font-semibold tracking-tight">
              {productName}
            </span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm md:flex">
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/security"
            >
              Security
            </Link>
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/pricing"
            >
              Pricing
            </Link>
            <Link
              className="text-muted-foreground transition-colors hover:text-foreground"
              href="/docs/api"
            >
              Docs
            </Link>
          </nav>

          <nav className="hidden items-center gap-2 md:flex">
            {session && user ? (
              <>
                <Button asChild size="sm">
                  <Link href={dashboardHref}>
                    <GaugeIcon className="mr-1.5 h-4 w-4" />
                    Dashboard
                  </Link>
                </Button>
                <UserMenu
                  email={user.email}
                  image={user.image}
                  name={user.name}
                  role={role}
                />
              </>
            ) : (
              <>
                <Button asChild size="sm" variant="ghost">
                  <Link href="/login">
                    <SignInIcon className="mr-1.5 h-4 w-4" />
                    Log in
                  </Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/signup">
                    <UserPlusIcon className="mr-1.5 h-4 w-4" />
                    Sign up
                  </Link>
                </Button>
              </>
            )}
          </nav>

          <MobileNav
            authed={!!(session && user)}
            dashboardHref={dashboardHref}
          />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="border-t bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-4 py-8 sm:flex-row">
            <div className="flex flex-col items-center gap-1 text-sm text-muted-foreground sm:items-start">
              <div className="flex items-center gap-2">
                <Image
                  alt={productName}
                  className="h-4 w-auto object-contain"
                  height={646}
                  src={LOGO_PATH}
                  width={1000}
                />
                <span>
                  &copy; {new Date().getFullYear()} {productName}. Built with
                  &#9829;
                </span>
              </div>
              <a
                className="text-xs transition-colors hover:text-foreground"
                href={`mailto:${PLATFORM_EMAILS.support}`}
              >
                Contact: {PLATFORM_EMAILS.support}
              </a>
            </div>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              <a
                className="transition-colors hover:text-foreground"
                href="/llms.txt"
              >
                llms.txt
              </a>
              <Separator className="h-4" orientation="vertical" />
              <Link
                className="transition-colors hover:text-foreground"
                href="/docs/api"
              >
                API
              </Link>
              {session ? (
                <>
                  {role === "admin" && (
                    <>
                      <Separator className="h-4" orientation="vertical" />
                      <Link
                        className="transition-colors hover:text-foreground"
                        href="/orbit/users"
                      >
                        Orbit Admin
                      </Link>
                    </>
                  )}
                  <Separator className="h-4" orientation="vertical" />
                  <Link
                    className="transition-colors hover:text-foreground"
                    href={dashboardHref}
                  >
                    Dashboard
                  </Link>
                </>
              ) : (
                <>
                  <Separator className="h-4" orientation="vertical" />
                  <Link
                    className="transition-colors hover:text-foreground"
                    href="/login"
                  >
                    Log in
                  </Link>
                  <Separator className="h-4" orientation="vertical" />
                  <Link
                    className="transition-colors hover:text-foreground"
                    href="/signup"
                  >
                    Sign up
                  </Link>
                </>
              )}
            </nav>
          </div>
          <div className="border-t">
            <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 py-4 text-xs text-muted-foreground">
              <Link
                className="transition-colors hover:text-foreground"
                href="/terms"
              >
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
              <Link
                className="transition-colors hover:text-foreground"
                href="/aup"
              >
                Acceptable Use
              </Link>
              <Separator className="h-3" orientation="vertical" />
              <Link
                className="transition-colors hover:text-foreground"
                href="/cookies"
              >
                Cookies
              </Link>
              <Separator className="h-3" orientation="vertical" />
              <CookieSettingsLink className="transition-colors hover:text-foreground" />
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
