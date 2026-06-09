import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  ArrowRightIcon,
  CloudIcon,
  CodeIcon,
  LockKeyIcon,
  ShieldCheckIcon,
  StackIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { DiagramFleet } from "@/components/landing/diagram-fleet";
import { DiagramIsolation } from "@/components/landing/diagram-isolation";
import { DiagramNetworking } from "@/components/landing/diagram-networking";
import { Reveal } from "@/components/landing/reveal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PRODUCT_NAME } from "@/config/platform";
import { breadcrumbJsonLd, JsonLd } from "@/lib/seo/jsonld";
import { pageOpenGraph, pageTwitter } from "@/lib/seo/metadata";

export const metadata: Metadata = {
  title: "Security & isolation",
  description:
    "Own kernel per Cube, a per-cube jailer sandbox, no public IP, and Cloudflare-protected web traffic with always-on DDoS — the safest way to run a server.",
  alternates: { canonical: "/security" },
  openGraph: pageOpenGraph({
    url: "/security",
    title: `Security & isolation — ${PRODUCT_NAME}`,
    description:
      "Own kernel per Cube, per-cube jailer sandbox, no public IP, Cloudflare-protected web traffic with always-on DDoS mitigation.",
  }),
  twitter: pageTwitter({
    title: `Security & isolation — ${PRODUCT_NAME}`,
    description:
      "Own kernel per Cube, per-cube jailer sandbox, no public IP, Cloudflare-protected — VM-grade isolation.",
  }),
};

const apiSnippet = `curl -X POST https://krova.cloud/api/v1/spaces/$SPACE/cubes \\
  -H "X-API-KEY: $KROVA_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{
    "name": "web-1",
    "image": "ubuntu-24.04",
    "resources": { "vcpu": 2, "ramGb": 4, "diskGb": 40 },
    "sshPublicKey": "ssh-ed25519 AAAA...",
    "region": "eu-central"
  }'`;

export default function SecurityPage() {
  const productName = PRODUCT_NAME;

  return (
    <div>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Security", path: "/security" },
        ])}
      />

      {/* Header */}
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <Badge className="mb-4" variant="secondary">
            Security
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            The most isolated way to run a real server
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Every Cube is a hardware-isolated microVM with its own kernel and a
            per-cube sandbox, no public IP of its own, and Cloudflare-protected
            web traffic. Here&apos;s exactly how that works — and why it&apos;s
            safer than a container or a typical VPS.
          </p>
        </div>
      </section>

      {/* Isolation deep-dive */}
      <section className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-10">
            <div>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Its own kernel. A sandbox around every Cube.
              </h2>
              <p className="mt-4 text-muted-foreground">
                A container shares one kernel across every tenant on the host —
                a single kernel bug can expose all of them. {productName} is the
                opposite by design.
              </p>
              <div className="mt-8 space-y-6">
                <FeaturePoint
                  body="Every Cube boots its own kernel — never shared with another tenant or the host. One Cube's kernel bug can't reach yours."
                  icon={StackIcon}
                  title="Its own kernel, per Cube"
                />
                <FeaturePoint
                  body="Each Cube's hypervisor runs inside a jailer sandbox — its own unprivileged user, chroot, and PID namespace. A hypervisor escape lands in that sandbox, not as root on the host."
                  icon={ShieldCheckIcon}
                  title="Per-cube jailer sandbox"
                />
                <FeaturePoint
                  body="Hardware-enforced KVM isolation (the same technology behind AWS Lambda), the most restrictive seccomp filters, and cross-VM memory-dedup side channels disabled."
                  icon={LockKeyIcon}
                  title="Hardware boundary, hardened host"
                />
              </div>
            </div>
            <Reveal className="border bg-card p-5 sm:p-8">
              <DiagramIsolation />
            </Reveal>
          </div>
        </div>
      </section>

      {/* No-exposure networking */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-10">
            <Reveal className="order-2 border bg-card p-5 sm:p-8 lg:order-1">
              <DiagramNetworking />
            </Reveal>
            <div className="order-1 lg:order-2">
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                No public IP. Nothing to attack.
              </h2>
              <p className="mt-4 text-muted-foreground">
                Every other host hands your server a public IP — a fixed address
                the whole internet can scan and hammer. {productName}{" "}
                doesn&apos;t.
              </p>
              <div className="mt-8 space-y-6">
                <FeaturePoint
                  body="Your Cube has no public IP of its own. It lives on a private, NAT'd network — there's simply no address out there for botnets to find and probe."
                  icon={LockKeyIcon}
                  title="No public IP, period"
                />
                <FeaturePoint
                  body="Web traffic on your custom domains is served entirely through Cloudflare's global edge: TLS, a hidden origin, and always-on, unmetered DDoS protection across layers 3, 4, and 7 on a 330+ city network."
                  icon={CloudIcon}
                  title="Cloudflare-protected, DDoS-absorbed"
                />
                <FeaturePoint
                  body="Nothing inbound is reachable unless you explicitly open a port, and every mapping can be locked to an IP allowlist behind a stateful default-deny firewall. Hosts add provider-grade network DDoS mitigation on top."
                  icon={ShieldCheckIcon}
                  title="Only what you open"
                />
              </div>
            </div>
          </div>

          <Reveal className="mt-10 border bg-card p-6 sm:p-8">
            <h3 className="font-semibold">
              &ldquo;Wait — don&apos;t I need a public IP?&rdquo;
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              For almost anything you&apos;d run on a server, no — and not
              having one is the upgrade. What makes your app reachable is your
              domain and the ports you choose to expose, not a fixed address
              bolted to the whole machine. Your websites and APIs go out
              worldwide over HTTPS through Cloudflare; SSH, databases, and any
              other TCP service open through an IP-allowlistable port mapping,
              on demand. You get inbound access to exactly what you expose —
              without the public address the rest of the internet would spend
              all day scanning and attacking. Fewer doors, and all of them
              yours.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Programmatic */}
      <section className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-10">
            <div>
              <Badge className="mb-4" variant="secondary">
                Automation
              </Badge>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Provision with code. Run as many as you need.
              </h2>
              <p className="mt-4 text-muted-foreground">
                Forget the AWS dance — VPC, subnet, security group, AMI, key
                pair, IAM role, launch template. A {productName} Cube is one API
                call. Loop it to stand up as many as you want; each boots in
                milliseconds. No artificial cap — concurrency is unlimited on
                higher plans.
              </p>
              <div className="mt-6 overflow-hidden border bg-card">
                <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
                  <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
                  <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
                  <span className="ml-2 text-xs text-muted-foreground">
                    create-cube.sh
                  </span>
                </div>
                <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-muted-foreground">
                  <code>{apiSnippet}</code>
                </pre>
              </div>
              <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                {[
                  "Full v1 REST API",
                  "Idempotency keys",
                  "cloud-init user-data",
                  "OpenAPI spec",
                ].map((chip) => (
                  <span className="flex items-center gap-1.5" key={chip}>
                    <CodeIcon
                      className="h-3.5 w-3.5 text-primary"
                      weight="bold"
                    />
                    {chip}
                  </span>
                ))}
              </div>
              <p className="mt-6 text-sm">
                <Link className="text-primary hover:underline" href="/docs/api">
                  Read the API reference →
                </Link>
              </p>
            </div>
            <Reveal className="border bg-card p-5 sm:p-8">
              <DiagramFleet />
            </Reveal>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6 sm:py-24 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Run it where nothing&apos;s exposed.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Spin up a hardware-isolated Cube with no public IP and full root SSH
            in under a minute.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/signup">
                Start free
                <ArrowRightIcon className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/pricing">View pricing</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function FeaturePoint({
  icon: Icon,
  title,
  body,
}: {
  icon: PhosphorIcon;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-primary/10">
        <Icon className="h-5 w-5 text-primary" weight="duotone" />
      </div>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
    </div>
  );
}
