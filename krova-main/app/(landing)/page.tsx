import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  ArrowRightIcon,
  CameraIcon,
  CheckIcon,
  CodeIcon,
  CubeIcon,
  GlobeIcon,
  LightningIcon,
  LockKeyIcon,
  MemoryIcon,
  ScalesIcon,
  ShieldCheckIcon,
  TerminalIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { HeroIsolation } from "@/components/landing/hero-isolation";
import { Reveal } from "@/components/landing/reveal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PRODUCT_NAME } from "@/config/platform";
import { auth } from "@/lib/auth";
import {
  MAX_SAVINGS,
  NAMED_COMPARE,
  NAMED_PROVIDERS,
} from "@/lib/landing/pricing-data";
import { getDefaultPlan } from "@/lib/plan/usage";
import { getLandingFaq } from "@/lib/seo/faq-data";
import {
  faqPageJsonLd,
  JsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
  websiteJsonLd,
} from "@/lib/seo/jsonld";
import { pageOpenGraph, pageTwitter } from "@/lib/seo/metadata";

export const metadata: Metadata = {
  title: {
    absolute: `${PRODUCT_NAME} — Hardware-isolated cloud servers with no public IP`,
  },
  description:
    "Run each app in its own hardware-isolated microVM — own kernel, per-cube sandbox, no public IP, Cloudflare-protected. Full root SSH, billed by the minute.",
  alternates: { canonical: "/" },
  openGraph: pageOpenGraph({
    url: "/",
    title: `${PRODUCT_NAME} — Hardware-isolated cloud servers with no public IP`,
    description:
      "Each Cube is a Firecracker microVM with its own kernel and a per-cube sandbox — no public IP, Cloudflare-protected web traffic, full root SSH, real 1:1 RAM & disk, billed by the minute.",
  }),
  twitter: pageTwitter({
    title: `${PRODUCT_NAME} — Hardware-isolated cloud servers with no public IP`,
    description:
      "Own kernel per Cube, per-cube sandbox, no public IP, Cloudflare-protected — less than half the price of AWS Lightsail, DigitalOcean, Vultr & Linode.",
  }),
};

export default async function LandingPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  // Free-credit figure comes from the default plan so an Orbit edit flows here
  // without a redeploy (plan-cached, 60s).
  const defaultPlan = await getDefaultPlan();
  const creditGrant = Number.parseFloat(defaultPlan.includedCreditUsd);

  const productName = PRODUCT_NAME;
  const isAdmin =
    (session?.user as { role?: string | null } | undefined)?.role === "admin";
  const primaryHref = session ? "/post-auth" : "/signup";
  const primaryLabel = session
    ? "Go to Dashboard"
    : `Start with $${creditGrant} free`;

  const faqItems = getLandingFaq(creditGrant);

  return (
    <div>
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={websiteJsonLd()} />
      <JsonLd
        data={softwareApplicationJsonLd({
          description: `${productName} is a managed cloud platform that runs lightweight Firecracker microVMs (Cubes) — the same isolation technology behind AWS Lambda — on dedicated bare-metal servers. Each Cube gets its own kernel, a per-cube jailer sandbox, no public IP, Cloudflare-protected web traffic, full root SSH, snapshots, and transparent per-minute billing.`,
          startingPriceUsd: 0,
        })}
      />
      <JsonLd data={faqPageJsonLd(faqItems)} />

      {/* Announcement bar */}
      <Link
        className="group relative block overflow-hidden border-b bg-primary/5 transition-colors hover:bg-primary/10"
        href="/security"
      >
        <span className="krova-sheen pointer-events-none absolute inset-0" />
        <span className="relative mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-center text-xs sm:text-sm">
          <Badge className="shrink-0 text-[10px]" variant="secondary">
            New
          </Badge>
          <span className="text-muted-foreground">
            Every Cube now runs in a hardened per-cube sandbox — VM-grade
            isolation, fleet-wide.
          </span>
          <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>

      {/* Hero — asymmetric split */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:items-center lg:gap-8 lg:px-8">
          <div>
            <Badge className="mb-5" variant="secondary">
              Secure by architecture
            </Badge>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Your own server.{" "}
              <span className="text-primary">Your own kernel.</span> No public
              IP.
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
              Every Cube is a hardware-isolated microVM with its{" "}
              <span className="text-foreground">own kernel</span> and a{" "}
              <span className="text-foreground">per-cube sandbox</span> — never
              a shared kernel like a container. It has{" "}
              <span className="text-foreground">no public IP</span> to scan, web
              traffic is Cloudflare-protected, and you still get full root SSH —
              at{" "}
              <span className="font-semibold text-foreground">
                up to {MAX_SAVINGS}% less
              </span>{" "}
              than Lightsail, DigitalOcean, Vultr, and Linode.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href={primaryHref}>
                  {primaryLabel}
                  <ArrowRightIcon className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/security">See how isolation works</Link>
              </Button>
              {isAdmin && (
                <Button asChild size="lg" variant="outline">
                  <Link href="/orbit/users">Open Orbit Admin</Link>
                </Button>
              )}
            </div>
            {!session && (
              <p className="mt-4 text-sm text-muted-foreground">
                ${creditGrant} free credit on sign-up. No credit card required.
              </p>
            )}
            <div className="mt-8 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {[
                "Own kernel per Cube",
                "Per-cube sandbox",
                "Cloudflare-protected",
                "Billed by the minute",
              ].map((chip) => (
                <span className="flex items-center gap-1.5" key={chip}>
                  <CheckIcon
                    className="h-3.5 w-3.5 text-primary"
                    weight="bold"
                  />
                  {chip}
                </span>
              ))}
            </div>
          </div>

          <Reveal className="mx-auto w-full max-w-md lg:max-w-none">
            <HeroIsolation />
          </Reveal>
        </div>
      </section>

      {/* Three pillars */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="grid gap-px overflow-hidden border bg-border sm:grid-cols-3">
            <Pillar
              body="Each Cube runs its own kernel behind a hardware boundary, with a per-cube jailer sandbox. Never a shared kernel."
              href="/security"
              icon={ShieldCheckIcon}
              index={0}
              title="Isolated by hardware"
            />
            <Pillar
              body="No public IP to scan or attack. Only the ports you open are reachable, every one IP-allowlistable. Web traffic rides Cloudflare's edge."
              href="/security"
              icon={LockKeyIcon}
              index={1}
              title="Nothing exposed"
            />
            <Pillar
              body="Every GB of RAM and disk is reserved 1:1 on the host — never oversold, never thin-provisioned. Billed by the minute."
              href="/pricing"
              icon={ScalesIcon}
              index={2}
              title="No overselling"
            />
          </div>
        </div>
      </section>

      <div className="border-t" />

      {/* What is a Cube? */}
      <section>
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <Reveal>
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center bg-primary/10">
                <CubeIcon className="h-6 w-6 text-primary" weight="duotone" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  What is a Cube?
                </h2>
                <div className="mt-6 space-y-4 text-muted-foreground">
                  <p>
                    A Cube is a lightweight microVM — built on{" "}
                    <strong className="text-foreground">Firecracker</strong>,
                    the same isolation technology behind AWS Lambda and Fargate.
                    Each Cube boots{" "}
                    <strong className="text-foreground">its own kernel</strong>{" "}
                    in complete isolation from every other Cube — never the
                    shared kernel a container hands every tenant on the box.
                  </p>
                  <p>
                    Firecracker gives you the isolation of a virtual machine
                    with the speed of a container — but on its own it&apos;s
                    just a hypervisor.{" "}
                    <strong className="text-foreground">
                      {productName} is the platform on top
                    </strong>
                    : one-click or one-API-call provisioning, per-minute
                    billing, custom domains with automatic HTTPS, snapshots, and
                    team access — VM-grade isolation without running the
                    hypervisor yourself.
                  </p>
                  <p>
                    <Link
                      className="text-primary hover:underline"
                      href="/security"
                    >
                      See exactly how the isolation works →
                    </Link>
                  </p>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <div className="border-t" />

      {/* Capabilities */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Everything that ships with every Cube
            </h2>
            <p className="mt-4 text-muted-foreground">
              Simple but not simplistic. Real VMs, real isolation, real control.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: TerminalIcon,
                title: "Full root SSH access",
                items: [
                  "Your SSH key baked in at creation",
                  "Run any software — no restrictions",
                  "Full systemd, package managers, kernel modules",
                ],
              },
              {
                icon: GlobeIcon,
                title: "Networking & domains",
                items: [
                  "Custom domains routed through Cloudflare for SaaS",
                  "Automatic HTTPS — no certificates to manage",
                  "TCP port forwarding with IP whitelists",
                ],
              },
              {
                icon: CameraIcon,
                title: "Snapshots & backups",
                items: [
                  "Live snapshots — no downtime",
                  "Restore to roll back instantly",
                  "Pre-deletion backups for exact replicas",
                ],
              },
              {
                icon: UsersThreeIcon,
                title: "Teams & permissions",
                items: [
                  "Spaces to organize by project or team",
                  "Granular per-Cube access control",
                  "Per-Space credit balance and billing",
                ],
              },
              {
                icon: LightningIcon,
                title: "Sleep & wake",
                items: [
                  "Pause to stop compute billing instantly",
                  "Wake in under a second",
                  "Auto-sleep when credits run out",
                ],
              },
              {
                icon: CodeIcon,
                title: "API & automation",
                items: [
                  "Full v1 REST API for the whole lifecycle",
                  "Scoped API keys + idempotency",
                  "Outbound webhooks on every change",
                ],
              },
            ].map((cap, i) => (
              <Reveal delay={i * 70} key={cap.title}>
                <CapabilityCard
                  icon={cap.icon}
                  items={cap.items}
                  title={cap.title}
                />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <div className="border-t" />

      {/* Hardware promises */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Premium hardware. Included.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Every Cube runs on dedicated bare-metal servers from our
              infrastructure partners — no add-ons, no per-Cube bandwidth
              meters, no surprise bills.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-2 gap-6 sm:grid-cols-4">
            {[
              {
                icon: MemoryIcon,
                title: "ECC RAM",
                subtitle:
                  "Host servers ship with server-grade ECC memory that catches bit flips before they corrupt your data.",
              },
              {
                icon: LightningIcon,
                title: "Mirrored SSDs",
                subtitle:
                  "Host disks are enterprise NVMe SSDs in RAID 1, so a single drive failure does not take a Cube down.",
              },
              {
                icon: GlobeIcon,
                title: "10 Gbps network",
                subtitle:
                  "Each host server has a 10 Gbps port and 100 TB of upstream traffic included per month, shared across the Cubes on it.",
              },
              {
                icon: ShieldCheckIcon,
                title: "DDoS protection",
                subtitle:
                  "Provider-grade network mitigation at the host, plus Cloudflare edge protection on every custom domain.",
              },
            ].map((hw, i) => (
              <Reveal delay={i * 70} key={hw.title}>
                <HardwarePromise
                  icon={hw.icon}
                  subtitle={hw.subtitle}
                  title={hw.title}
                />
              </Reveal>
            ))}
          </div>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Hardware specifications are provided by our bare-metal hosts. We
            don&apos;t meter or rate-limit your traffic — but if a server&apos;s
            shared 100 TB pool runs hot, we&apos;ll let you know.
          </p>
        </div>
      </section>

      <div className="border-t" />

      {/* Named-provider comparison */}
      <section className="bg-muted/30">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              How {productName} compares
            </h2>
            <p className="mt-4 text-muted-foreground">
              Same class of hardware. Stronger isolation. Nothing exposed. Less
              than half the bill. Every figure below is current and real.
            </p>
          </div>

          <div className="mt-10 overflow-x-auto border bg-card">
            <table className="w-full min-w-180 text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium sm:p-4" />
                  {NAMED_PROVIDERS.map((name, i) => (
                    <th
                      className={`p-3 text-center sm:p-4 ${
                        i === 0
                          ? "font-bold text-primary"
                          : "font-medium text-muted-foreground"
                      }`}
                      key={name}
                    >
                      {i === 0 ? productName : name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {NAMED_COMPARE.map((row) => (
                  <tr className="border-b last:border-0" key={row.label}>
                    <td className="p-3 font-medium sm:p-4">{row.label}</td>
                    {row.values.map((val, i) => (
                      <td
                        className={`p-3 text-center sm:p-4 ${
                          i === 0
                            ? "font-medium text-primary"
                            : "text-muted-foreground"
                        }`}
                        key={`${row.label}-${NAMED_PROVIDERS[i]}`}
                      >
                        {val}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 text-center">
            <Button asChild variant="outline">
              <Link href="/pricing">
                See full pricing
                <ArrowRightIcon className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="border-t" />

      {/* Who is it for? */}
      <section>
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Who is {productName} for?
          </h2>

          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            <AudienceBlock
              description="A server for your side project or API without AWS complexity. Pay by the minute, not by the month."
              title="Solo developers"
            />
            <AudienceBlock
              description="Untrusted or regulated workloads that need real isolation — own kernel, per-cube sandbox, no exposed IP. Multi-tenant-safe by design."
              title="Security-conscious teams"
            />
            <AudienceBlock
              description="Isolated environments per client. Create, demo, and tear down in seconds — by hand or by API. Restore any project from backup."
              title="Agencies & freelancers"
            />
            <AudienceBlock
              description="Cheap, isolated Linux environments that boot instantly. Perfect for labs, fleets, and learning."
              title="Educators & students"
            />
          </div>
        </div>
      </section>

      <div className="border-t" />

      {/* FAQ */}
      <section>
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Frequently asked questions
          </h2>

          <div className="mt-10 space-y-8">
            {faqItems.map((item) => (
              <FaqItem
                answer={item.answer}
                key={item.question}
                question={item.question}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Stop exposing servers. Start building.
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              {session
                ? "Open your dashboard and launch a Cube. The whole thing takes under a minute."
                : `Create your free account and we'll drop $${creditGrant} of credit in. Launch a Cube and SSH in — the whole thing takes under a minute, no card required.`}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href={primaryHref}>
                  {session
                    ? "Go to Dashboard"
                    : `Claim your $${creditGrant} credit`}
                  <ArrowRightIcon className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/pricing">View pricing</Link>
              </Button>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}

function Pillar({
  icon: Icon,
  title,
  body,
  href,
  index,
}: {
  icon: PhosphorIcon;
  title: string;
  body: string;
  href: string;
  index: number;
}) {
  return (
    <Reveal delay={index * 90}>
      <Link
        className="group flex h-full flex-col bg-background p-6 transition-colors hover:bg-muted/40"
        href={href}
      >
        <div className="flex h-10 w-10 items-center justify-center bg-primary/10">
          <Icon className="h-5 w-5 text-primary" weight="duotone" />
        </div>
        <h3 className="mt-4 flex items-center gap-1.5 font-semibold">
          {title}
          <ArrowRightIcon className="h-3.5 w-3.5 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
      </Link>
    </Reveal>
  );
}

function CapabilityCard({
  icon: Icon,
  title,
  items,
}: {
  icon: PhosphorIcon;
  title: string;
  items: string[];
}) {
  return (
    <div className="flex h-full flex-col border bg-card p-6">
      <div className="mb-3 flex h-10 w-10 items-center justify-center bg-primary/10">
        <Icon className="h-5 w-5 text-primary" weight="duotone" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li className="flex items-start gap-2" key={item}>
            <CheckIcon
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
              weight="bold"
            />
            <span className="text-sm text-muted-foreground">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AudienceBlock({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="border-l-2 border-primary/30 pl-6">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <div>
      <h3 className="font-semibold">{question}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {answer}
      </p>
    </div>
  );
}

function HardwarePromise({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: PhosphorIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex h-full flex-col items-center text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center bg-primary/10">
        <Icon className="h-6 w-6 text-primary" weight="duotone" />
      </div>
      <p className="font-semibold">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {subtitle}
      </p>
    </div>
  );
}
