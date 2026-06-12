"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"
import Autoplay from "embla-carousel-autoplay"
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ChartLineUpIcon,
  ShieldCheckIcon,
  LightningIcon,
  UsersIcon,
  StarIcon,
  EnvelopeIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext } from "@/components/ui/carousel"
import { cn } from "@/lib/utils"

// ─── Data ────────────────────────────────────────────────────────────────────

const features = [
  {
    icon: LightningIcon,
    title: "Lightning Fast",
    description: "Optimised for speed at every layer — from database queries to edge-cached responses.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Secure by Default",
    description: "Magic-link auth, row-level security, and encrypted secrets out of the box.",
  },
  {
    icon: ChartLineUpIcon,
    title: "Built-in Analytics",
    description: "Track every event that matters with a zero-config analytics pipeline.",
  },
  {
    icon: UsersIcon,
    title: "Team Collaboration",
    description: "Invite team members, assign roles, and manage permissions without writing a line of code.",
  },
  {
    icon: StarIcon,
    title: "First-class DX",
    description: "TypeScript end-to-end, hot reload, and a pre-wired component library ready to ship.",
  },
  {
    icon: CheckCircleIcon,
    title: "Always Reliable",
    description: "99.99 % uptime SLA backed by auto-scaling infrastructure and automated backups.",
  },
]

const testimonials = [
  {
    name: "Sarah Chen",
    role: "CTO, Flowboard",
    initials: "SC",
    body: "We went from zero to production in a single weekend. The auth and billing integrations alone saved us three weeks of work.",
  },
  {
    name: "Marcus Rivera",
    role: "Indie Hacker",
    initials: "MR",
    body: "I've tried every SaaS boilerplate out there. This is the first one where I didn't have to rip half of it out on day one.",
  },
  {
    name: "Priya Nair",
    role: "Engineering Lead, Stackd",
    initials: "PN",
    body: "The component library is genuinely beautiful. Our designers were happy, which almost never happens with open-source UI.",
  },
  {
    name: "Tom Wallace",
    role: "Founder, Loopback",
    initials: "TW",
    body: "Shipped our MVP in 4 days. The magic-link auth and Postgres setup worked perfectly from the first deploy.",
  },
]

const plans = [
  {
    name: "Starter",
    price: "$0",
    description: "Perfect for side-projects and early validation.",
    features: ["3 projects", "1 team member", "5 GB storage", "Community support"],
    cta: "Get started free",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$29",
    description: "For growing teams that need more power.",
    features: ["Unlimited projects", "10 team members", "100 GB storage", "Priority support", "Custom domains", "Advanced analytics"],
    cta: "Start free trial",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "For large organisations with custom requirements.",
    features: ["Everything in Pro", "Unlimited members", "SSO & SAML", "SLA guarantee", "Dedicated support", "Custom contracts"],
    cta: "Contact sales",
    highlighted: false,
  },
]

const faqs = [
  {
    q: "Do I need a credit card to sign up?",
    a: "No. The Starter plan is completely free and requires no payment details. You only need a card when you upgrade to Pro.",
  },
  {
    q: "Can I self-host this?",
    a: "Yes. The entire codebase is open-source and documented for self-hosting on any platform that runs Node.js and PostgreSQL.",
  },
  {
    q: "How does magic-link authentication work?",
    a: "We send a one-time sign-in link to your email. Clicking it logs you in instantly — no passwords to remember or reset.",
  },
  {
    q: "What happens when I exceed my plan limits?",
    a: "We'll notify you before you hit any limits and give you a grace period. We never cut off access without warning.",
  },
  {
    q: "Is my data encrypted?",
    a: "All data is encrypted at rest (AES-256) and in transit (TLS 1.3). Backups are taken every hour and retained for 30 days.",
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

// radix-sera Badge is text-only — use this pill span for section labels on landing page
function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border border-foreground/15 bg-muted px-3 py-1 text-xs font-semibold tracking-wide uppercase text-muted-foreground",
      className
    )}>
      {children}
    </span>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <span className="font-semibold tracking-tight">My SaaS App</span>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
          <a href="#features" className="hover:text-foreground transition-colors">Features</a>
          <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
          <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/login">Get started</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}

function HeroSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24 text-center">
      <SectionLabel className="mb-6">Now in public beta</SectionLabel>
      <h1 className="mb-4 mt-4 text-4xl font-bold tracking-tight sm:text-6xl">
        Ship your SaaS{" "}
        <span className="text-muted-foreground">in days, not months</span>
      </h1>
      <p className="mx-auto mb-8 max-w-xl text-lg text-muted-foreground">
        A production-ready Next.js starter with auth, billing, database, and a
        full component library — so you can focus on what makes your product unique.
      </p>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <Button size="lg" asChild>
          <Link href="/login">
            Start building free <ArrowRightIcon className="ml-1 size-4" />
          </Link>
        </Button>
        <Button size="lg" variant="outline" asChild>
          <a href="#features">See what's included</a>
        </Button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">No credit card required · Free forever on Starter</p>
    </section>
  )
}

function FeaturesSection() {
  return (
    <section id="features" className="bg-muted/40 py-20">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mb-12 text-center">
          <SectionLabel className="mb-4">Features</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight">Everything you need to launch</h2>
          <p className="mt-2 text-muted-foreground">Built on proven open-source tools. No vendor lock-in.</p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, description }) => (
            <Card key={title}>
              <CardHeader>
                <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                  <Icon className="size-5 text-primary" weight="duotone" />
                </div>
                <CardTitle className="normal-case tracking-normal text-sm font-semibold">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>{description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

function TabsShowcase() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20">
      <div className="mb-10 text-center">
        <SectionLabel className="mb-4">How it works</SectionLabel>
        <h2 className="mt-4 text-3xl font-bold tracking-tight">Set up in three steps</h2>
      </div>
      <Tabs defaultValue="clone" className="mx-auto max-w-2xl">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="clone">1. Clone</TabsTrigger>
          <TabsTrigger value="configure">2. Configure</TabsTrigger>
          <TabsTrigger value="deploy">3. Deploy</TabsTrigger>
        </TabsList>
        <TabsContent value="clone">
          <Card>
            <CardHeader>
              <CardTitle className="normal-case tracking-normal text-base">Clone the repo</CardTitle>
              <CardDescription>One command gets you everything — app, workers, and migrations.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="rounded-md bg-muted p-4 text-sm font-mono overflow-x-auto">
                {`git clone https://github.com/your-org/my-saas-app\ncd my-saas-app\npnpm install`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="configure">
          <Card>
            <CardHeader>
              <CardTitle className="normal-case tracking-normal text-base">Configure your environment</CardTitle>
              <CardDescription>Copy the example env file and fill in your secrets.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="rounded-md bg-muted p-4 text-sm font-mono overflow-x-auto">
                {`cp .env.example .env\n# Add DATABASE_URL, APP_SECRET,\n# SMTP credentials, S3 keys…\npnpm db:push`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="deploy">
          <Card>
            <CardHeader>
              <CardTitle className="normal-case tracking-normal text-base">Deploy to production</CardTitle>
              <CardDescription>Push to Vercel, Railway, or any Node host with a single command.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="rounded-md bg-muted p-4 text-sm font-mono overflow-x-auto">
                {`vercel deploy --prod\n# or\nrailway up`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </section>
  )
}

function TestimonialsCarousel() {
  return (
    <section className="bg-muted/40 py-20">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mb-10 text-center">
          <SectionLabel className="mb-4">Testimonials</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight">Loved by builders</h2>
        </div>
        <Carousel
          opts={{ loop: true, align: "start" }}
          plugins={[Autoplay({ delay: 4000 })]}
          className="px-12"
        >
          <CarouselContent>
            {testimonials.map((t) => (
              <CarouselItem key={t.name} className="sm:basis-1/2 lg:basis-1/3">
                <div className="flex h-full flex-col gap-5 rounded-xl border bg-card p-6 shadow-sm">
                  {/* Stars */}
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <StarIcon key={i} className="size-4 text-amber-400" weight="fill" />
                    ))}
                  </div>

                  {/* Quote */}
                  <p className="flex-1 text-sm leading-relaxed text-foreground/80">
                    "{t.body}"
                  </p>

                  {/* Author */}
                  <div className="flex items-center gap-3 pt-1 border-t border-border">
                    <Avatar>
                      <AvatarFallback>{t.initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{t.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{t.role}</p>
                    </div>
                  </div>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </div>
    </section>
  )
}

function PricingSection() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-4 py-20">
      <div className="mb-12 text-center">
        <SectionLabel className="mb-4">Pricing</SectionLabel>
        <h2 className="mt-4 text-3xl font-bold tracking-tight">Simple, transparent pricing</h2>
        <p className="mt-2 text-muted-foreground">Start free. Scale when you're ready.</p>
      </div>
      <div className="grid gap-6 sm:grid-cols-3">
        {plans.map((plan) => (
          <div key={plan.name} className="relative pt-4">
            {plan.highlighted && (
              <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10">
                <SectionLabel>Most popular</SectionLabel>
              </div>
            )}
            <Card className={plan.highlighted ? "border-primary ring-1 ring-primary h-full" : "h-full"}>
            <CardHeader>
              <CardTitle className="normal-case tracking-normal text-base">{plan.name}</CardTitle>
              <div className="flex items-end gap-1 pt-1">
                <span className="text-3xl font-bold">{plan.price}</span>
                {plan.price !== "Custom" && <span className="text-muted-foreground text-sm mb-1">/mo</span>}
              </div>
              <CardDescription>{plan.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <CheckCircleIcon className="size-4 text-primary shrink-0" weight="fill" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                className="w-full"
                variant={plan.highlighted ? "default" : "outline"}
                asChild
              >
                <Link href="/login">{plan.cta}</Link>
              </Button>
            </CardContent>
          </Card>
          </div>
        ))}
      </div>
    </section>
  )
}

function FaqSection() {
  const half = Math.ceil(faqs.length / 2)
  const left = faqs.slice(0, half)
  const right = faqs.slice(half)

  return (
    <section id="faq" className="bg-muted/40 py-24">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mb-14 text-center">
          <SectionLabel className="mb-4">FAQ</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Common questions</h2>
          <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
            Can't find what you're looking for?{" "}
            <a href="mailto:support@example.com" className="underline underline-offset-4 hover:text-foreground transition-colors">
              Reach out to support
            </a>
            .
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
          {[left, right].map((group, gi) => (
            <div key={gi} className="space-y-3">
              {group.map((faq, i) => (
                <div key={i} className="rounded-lg border bg-card shadow-sm overflow-hidden">
                  <Accordion type="single" collapsible>
                    <AccordionItem value="item" className="border-b-0">
                      <AccordionTrigger className="px-5 py-4 text-sm font-semibold hover:no-underline">
                        {faq.q}
                      </AccordionTrigger>
                      <AccordionContent className="pt-2 px-5 pb-2 text-sm leading-relaxed text-muted-foreground">
                        {faq.a}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function NewsletterSection() {
  const [email, setEmail] = React.useState("")
  const [loading, setLoading] = React.useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    await new Promise((r) => setTimeout(r, 800))
    setLoading(false)
    setEmail("")
    toast.success("You're on the list!", { description: "We'll notify you about updates and launches." })
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-20">
      <Card className="bg-primary text-primary-foreground border-0">
        <CardContent className="py-12 text-center space-y-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">Stay in the loop</h2>
            <p className="text-primary-foreground/70 text-sm">
              Get product updates, tutorials, and early-access announcements straight to your inbox.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="mx-auto flex max-w-sm gap-2">
            <div className="relative flex-1">
              <EnvelopeIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9 bg-background text-foreground"
                required
              />
            </div>
            <Button type="submit" variant="secondary" disabled={loading}>
              {loading ? "Subscribing…" : "Subscribe"}
            </Button>
          </form>
          <p className="text-xs text-primary-foreground/50">No spam. Unsubscribe any time.</p>
        </CardContent>
      </Card>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t bg-muted/20">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <span className="font-semibold">My SaaS App</span>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
            <a href="#" className="hover:text-foreground transition-colors">Terms</a>
            <Link href="/login" className="hover:text-foreground transition-colors">Sign in</Link>
          </div>
        </div>
        <Separator className="my-6" />
        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} My SaaS App. All rights reserved.
        </p>
      </div>
    </footer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <HeroSection />
      <FeaturesSection />
      <TabsShowcase />
      <TestimonialsCarousel />
      <PricingSection />
      <FaqSection />
      <NewsletterSection />
      <Footer />
    </div>
  )
}
