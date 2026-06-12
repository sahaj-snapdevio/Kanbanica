"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowRight,
  CheckCircle2,
  LayoutList,
  Kanban,
  CalendarDays,
  Bell,
  Search,
  MessageSquare,
  Zap,
  Users,
  ChevronRight,
  Star,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

// --- Data --------------------------------------------------------------------

const features = [
  {
    icon: LayoutList,
    title: "Tasks & Subtasks",
    description: "Create tasks with rich descriptions, priorities, assignees, due dates, checklists, and nested subtasks. Everything your team needs in one place.",
  },
  {
    icon: Zap,
    title: "Sprints",
    description: "Run agile sprints with story points, burndown tracking, and automatic close logic. Keep your team moving in focused two-week cycles.",
  },
  {
    icon: Kanban,
    title: "Multiple Views",
    description: "Switch between List, Board, and Calendar views. Each view gives your team a different lens on the same work - no duplicate data entry.",
  },
  {
    icon: MessageSquare,
    title: "Comments & Activity",
    description: "Threaded comments, @mentions, emoji reactions, and a full activity timeline on every task. Your entire conversation history, always in context.",
  },
  {
    icon: Bell,
    title: "Smart Notifications",
    description: "In-app, email, and browser push notifications. Get alerted when tasks are assigned, comments are posted, or deadlines are approaching.",
  },
  {
    icon: Search,
    title: "Search & Filters",
    description: "Global search across all workspaces with Ctrl+K. Filter tasks by status, priority, assignee, due date, and tags - then save your filters.",
  },
]

const steps = [
  {
    number: "01",
    title: "Create your Workspace",
    description: "Your Workspace is your company or team's home. Give it a name, upload a logo, and you're ready in seconds.",
  },
  {
    number: "02",
    title: "Invite your team",
    description: "Invite teammates via email or a shareable link. Assign roles - Owner, Admin, Member, or Guest - per person.",
  },
  {
    number: "03",
    title: "Organise into Spaces & Lists",
    description: "Create Spaces for each department or project area. Inside each Space, create Lists to group related tasks together.",
  },
  {
    number: "04",
    title: "Start working",
    description: "Create tasks, assign them, set due dates, and track progress across List, Board, and Calendar views.",
  },
]

const testimonials = [
  {
    name: "Sarah Chen",
    role: "Engineering Lead, Flowboard",
    initials: "SC",
    body: "We switched from ClickUp and the onboarding took 20 minutes. The Board view is snappy, the permissions model is exactly what we needed for guest contractors.",
  },
  {
    name: "Marcus Rivera",
    role: "Product Manager, Stackd",
    initials: "MR",
    body: "Sprint planning used to take half a day. With Kanbanica's sprint view and story points, we're done in an hour. The burndown chart is a game-changer.",
  },
  {
    name: "Priya Nair",
    role: "Founder, Loopback",
    initials: "PN",
    body: "My Tasks view is something I didn't know I needed. Seeing every task assigned to me across every project in one place - with a due date grouping - is brilliant.",
  },
]

const faqs = [
  {
    q: "How is Kanbanica different from Jira or ClickUp?",
    a: "Kanbanica is built for teams that want the power of Jira and the usability of ClickUp - without the bloat. We focus on the core: tasks, sprints, views, and collaboration. No feature creep.",
  },
  {
    q: "How does magic link authentication work?",
    a: "You enter your email and we send a one-time sign-in link. Clicking it logs you in instantly. No passwords to create, remember, or reset. First-time users get an account created automatically.",
  },
  {
    q: "What is a Space?",
    a: "A Space is a logical grouping for a team or department inside your Workspace - like Engineering, Marketing, or HR. Each Space has its own Lists, members, and permissions.",
  },
  {
    q: "Can I control who sees what?",
    a: "Yes. Workspace roles (Owner, Admin, Member, Guest) control workspace-level access. Space permissions (Full Access, Edit, View) control everything inside a Space. Guests can only see Spaces they are explicitly invited to.",
  },
  {
    q: "What views are available?",
    a: "MVP ships with List View, Board View (Kanban), and My Tasks. Calendar View, Gantt, and Workload View are on the roadmap.",
  },
  {
    q: "Can I invite contractors or clients as guests?",
    a: "Yes. The Guest role gives scoped access to only the Spaces you invite them to. They can't see anything else in your Workspace.",
  },
  {
    q: "Is there a free plan?",
    a: "We're in early access. Sign up now and lock in founding member pricing before we launch paid plans.",
  },
]

// --- Helpers -----------------------------------------------------------------

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border border-primary/20 bg-primary/8 px-3 py-1 text-xs font-semibold tracking-wide uppercase text-primary",
      className
    )}>
      {children}
    </span>
  )
}

// --- Navbar ------------------------------------------------------------------

function Navbar() {
  const [scrolled, setScrolled] = React.useState(false)

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header className={cn(
      "sticky top-0 z-30 transition-all duration-200",
      scrolled
        ? "border-b border-border bg-white/95 backdrop-blur-sm shadow-sm"
        : "bg-transparent"
    )}>
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <span className="font-bold text-lg tracking-tight text-primary">Kanbanica</span>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
          <a href="#features" className="hover:text-foreground transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-foreground transition-colors">How it works</a>
          <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/sign-in">
              Get Started Free <ArrowRight className="ml-1 size-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  )
}

// --- Hero --------------------------------------------------------------------

function HeroSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-24 pt-20 text-center">
      <SectionLabel className="mb-6">Now in early access</SectionLabel>
      <h1 className="mt-4 mb-5 text-5xl font-bold tracking-tight text-foreground sm:text-6xl leading-tight">
        Project management{" "}
        <span className="text-primary">your team will actually use</span>
      </h1>
      <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground leading-relaxed">
        Kanbanica gives every team a shared home - Workspaces, Spaces, Lists, and Tasks - with sprints, board views, comments, and notifications built in.
      </p>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <Button size="lg" asChild className="h-11 px-6 text-base">
          <Link href="/sign-in">
            Get Started Free <ArrowRight className="ml-1.5 size-4" />
          </Link>
        </Button>
        <Button size="lg" variant="outline" asChild className="h-11 px-6 text-base">
          <a href="#features">See what is included</a>
        </Button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">No credit card required - Magic link sign-in</p>

      {/* Mock app preview */}
      <div className="mt-16 rounded-xl border border-border bg-[#f9fafb] shadow-xl overflow-hidden">
        <div className="flex items-center gap-1.5 border-b border-border bg-white px-4 py-3">
          <span className="size-3 rounded-full bg-[#ef4444]" />
          <span className="size-3 rounded-full bg-[#f59e0b]" />
          <span className="size-3 rounded-full bg-[#10b981]" />
          <span className="ml-3 text-xs text-muted-foreground font-medium">Kanbanica - Engineering / Backlog</span>
        </div>
        <div className="bg-[#f9fafb] p-6">
          <div className="flex gap-3 mb-4 border-b border-border pb-3">
            {["List", "Board", "Calendar"].map((v, i) => (
              <span key={v} className={cn(
                "px-3 py-1 rounded text-xs font-medium cursor-pointer",
                i === 0 ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"
              )}>{v}</span>
            ))}
          </div>
          <div className="space-y-2">
            {[
              { title: "Fix login redirect bug", status: "In Progress", priority: "High", assignee: "SC" },
              { title: "Design onboarding flow", status: "Review", priority: "Medium", assignee: "MR" },
              { title: "Write API documentation", status: "Todo", priority: "Low", assignee: "PN" },
              { title: "Set up CI/CD pipeline", status: "Todo", priority: "Urgent", assignee: "SC" },
            ].map((task) => (
              <div key={task.title} className="flex items-center gap-3 rounded-md border border-border bg-white px-4 py-2.5 text-sm">
                <span className="size-4 rounded border-2 border-border shrink-0" />
                <span className="flex-1 text-foreground font-medium truncate">{task.title}</span>
                <span className={cn("rounded px-2 py-0.5 text-xs font-medium shrink-0", {
                  "bg-[#6366f1]/10 text-[#6366f1]": task.status === "In Progress",
                  "bg-[#f59e0b]/10 text-[#f59e0b]": task.status === "Review",
                  "bg-[#e5e7eb] text-[#6b7280]": task.status === "Todo",
                })}>{task.status}</span>
                <span className={cn("rounded px-2 py-0.5 text-xs font-medium shrink-0 hidden sm:inline-block", {
                  "bg-[#ef4444]/10 text-[#ef4444]": task.priority === "Urgent",
                  "bg-[#f97316]/10 text-[#f97316]": task.priority === "High",
                  "bg-[#f59e0b]/10 text-[#f59e0b]": task.priority === "Medium",
                  "bg-[#3b82f6]/10 text-[#3b82f6]": task.priority === "Low",
                })}>{task.priority}</span>
                <Avatar className="size-6 shrink-0">
                  <AvatarFallback className="text-[10px] bg-primary/10 text-primary">{task.assignee}</AvatarFallback>
                </Avatar>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// --- Social Proof ------------------------------------------------------------

function SocialProofBar() {
  return (
    <div className="border-y border-border bg-[#f9fafb] py-4">
      <div className="mx-auto max-w-6xl px-6 text-center">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">500+ teams</span> already managing their work with Kanbanica
        </p>
      </div>
    </div>
  )
}

// --- Features ----------------------------------------------------------------

function FeaturesSection() {
  return (
    <section id="features" className="bg-[#f9fafb] py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center">
          <SectionLabel className="mb-4">Features</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight">Everything your team needs to ship</h2>
          <p className="mt-2 text-muted-foreground">No bolt-ons. No plugins. Everything in the box.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, description }) => (
            <Card key={title} className="border-border shadow-none hover:shadow-sm transition-shadow">
              <CardHeader className="pb-2">
                <div className="mb-2 flex size-9 items-center justify-center rounded-md bg-primary/10">
                  <Icon className="size-5 text-primary" />
                </div>
                <CardTitle className="text-sm font-semibold normal-case tracking-normal">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm leading-relaxed">{description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

// --- How It Works ------------------------------------------------------------

function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center">
          <SectionLabel className="mb-4">How it works</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight">Up and running in minutes</h2>
          <p className="mt-2 text-muted-foreground">No configuration required. Just sign in and start organising.</p>
        </div>

        <div className="mb-12 flex items-center justify-center gap-2 text-sm flex-wrap">
          {["Workspace", "Space", "List", "Task"].map((label, i, arr) => (
            <React.Fragment key={label}>
              <span className="rounded-md border border-border bg-[#f9fafb] px-3 py-1.5 font-medium text-foreground">{label}</span>
              {i < arr.length - 1 && <ChevronRight className="size-4 text-muted-foreground" />}
            </React.Fragment>
          ))}
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div key={step.number} className="rounded-xl border border-border bg-white p-6">
              <div className="mb-3 text-3xl font-bold text-primary/20">{step.number}</div>
              <h3 className="mb-2 text-sm font-semibold">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// --- Views Showcase ----------------------------------------------------------

function ViewsShowcaseSection() {
  return (
    <section className="bg-[#f9fafb] py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-10 text-center">
          <SectionLabel className="mb-4">Views</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight">See work your way</h2>
          <p className="mt-2 text-muted-foreground">Switch views without leaving the page. Your filters carry across.</p>
        </div>
        <Tabs defaultValue="list" className="mx-auto max-w-3xl">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="list" className="gap-1.5"><LayoutList className="size-3.5" />List</TabsTrigger>
            <TabsTrigger value="board" className="gap-1.5"><Kanban className="size-3.5" />Board</TabsTrigger>
            <TabsTrigger value="mytasks" className="gap-1.5"><CalendarDays className="size-3.5" />My Tasks</TabsTrigger>
          </TabsList>

          <TabsContent value="list">
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold normal-case tracking-normal">List View</CardTitle>
                <CardDescription>Default view - see all tasks as rows with inline editing.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {["Fix authentication bug", "Design dashboard layout", "Write unit tests", "Deploy to staging"].map((t, i) => (
                    <div key={t} className="flex items-center gap-3 rounded border border-border px-3 py-2 text-sm bg-[#f9fafb]">
                      <CheckCircle2 className={cn("size-4 shrink-0", i < 2 ? "text-primary" : "text-muted-foreground")} />
                      <span className={cn("flex-1", i < 2 ? "line-through text-muted-foreground" : "text-foreground")}>{t}</span>
                      <Users className="size-3.5 text-muted-foreground" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="board">
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold normal-case tracking-normal">Board View</CardTitle>
                <CardDescription>Kanban columns by status. Drag cards to change status.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Todo", tasks: ["Write tests", "Update docs"], color: "text-muted-foreground" },
                    { label: "In Progress", tasks: ["Fix auth bug", "Design layout"], color: "text-primary" },
                    { label: "Done", tasks: ["Deploy staging"], color: "text-[#10b981]" },
                  ].map((col) => (
                    <div key={col.label} className="rounded-md bg-[#f9fafb] p-2">
                      <p className={cn("mb-2 text-xs font-semibold px-1", col.color)}>{col.label}</p>
                      {col.tasks.map((t) => (
                        <div key={t} className="mb-1.5 rounded border border-border bg-white px-2.5 py-2 text-xs text-foreground shadow-sm">
                          {t}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="mytasks">
            <Card className="border-border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold normal-case tracking-normal">My Tasks</CardTitle>
                <CardDescription>All tasks assigned to you, across every project, grouped by due date.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { group: "Overdue", tasks: ["Update API docs"], color: "text-[#ef4444]" },
                    { group: "Due Today", tasks: ["Fix login bug", "Review PR #42"], color: "text-[#f59e0b]" },
                    { group: "This Week", tasks: ["Write sprint retrospective", "Onboard new member"], color: "text-foreground" },
                  ].map((g) => (
                    <div key={g.group}>
                      <p className={cn("mb-1.5 text-xs font-semibold", g.color)}>{g.group}</p>
                      {g.tasks.map((t) => (
                        <div key={t} className="flex items-center gap-2 rounded border border-border bg-[#f9fafb] px-3 py-1.5 text-xs text-foreground mb-1">
                          <CheckCircle2 className="size-3.5 text-muted-foreground" />
                          {t}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  )
}

// --- Testimonials ------------------------------------------------------------

function TestimonialsSection() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-10 text-center">
          <SectionLabel className="mb-4">Testimonials</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight">Teams love it</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          {testimonials.map((t) => (
            <div key={t.name} className="flex flex-col gap-4 rounded-xl border border-border bg-white p-6 shadow-sm">
              <div className="flex gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="size-4 fill-amber-400 text-amber-400" />
                ))}
              </div>
              <p className="flex-1 text-sm leading-relaxed text-foreground/80">&ldquo;{t.body}&rdquo;</p>
              <div className="flex items-center gap-3 border-t border-border pt-4">
                <Avatar className="size-8">
                  <AvatarFallback className="text-xs bg-primary/10 text-primary">{t.initials}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-semibold">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// --- FAQ ---------------------------------------------------------------------

function FaqSection() {
  return (
    <section id="faq" className="bg-[#f9fafb] py-20">
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-12 text-center">
          <SectionLabel className="mb-4">FAQ</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight">Common questions</h2>
          <p className="mt-2 text-muted-foreground">
            {"Can't find an answer? "}
            <a href="mailto:support@kanbanica.com" className="text-primary underline-offset-2 hover:underline">
              Reach out to support
            </a>
          </p>
        </div>
        <Accordion type="single" collapsible className="space-y-2">
          {faqs.map((faq, i) => (
            <AccordionItem key={i} value={`faq-${i}`} className="rounded-lg border border-border bg-white px-1 shadow-sm">
              <AccordionTrigger className="px-4 py-4 text-sm font-semibold hover:no-underline text-left">
                {faq.q}
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">
                {faq.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}

// --- Final CTA ---------------------------------------------------------------

function CtaBanner() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="rounded-2xl bg-primary px-8 py-14 text-center text-white">
          <h2 className="mb-3 text-3xl font-bold">Ready to get your team organised?</h2>
          <p className="mb-8 text-white/75 text-lg">Sign up in seconds. No credit card. No setup fees.</p>
          <Button size="lg" variant="secondary" asChild className="h-11 px-8 text-base font-semibold text-primary">
            <Link href="/sign-in">
              Start for free <ArrowRight className="ml-1.5 size-4" />
            </Link>
          </Button>
          <p className="mt-4 text-sm text-white/60">Magic link sign-in - No passwords</p>
        </div>
      </div>
    </section>
  )
}

// --- Footer ------------------------------------------------------------------

function Footer() {
  return (
    <footer className="border-t border-border bg-[#f9fafb]">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid gap-8 sm:grid-cols-4">
          <div className="sm:col-span-1">
            <span className="font-bold text-base text-primary">Kanbanica</span>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Project management for modern teams. Workspaces, Spaces, Lists, and Tasks.
            </p>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#features" className="hover:text-foreground transition-colors">Features</a></li>
              <li><a href="#how-it-works" className="hover:text-foreground transition-colors">How it works</a></li>
              <li><a href="#faq" className="hover:text-foreground transition-colors">FAQ</a></li>
            </ul>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#" className="hover:text-foreground transition-colors">About</a></li>
              <li><a href="mailto:support@kanbanica.com" className="hover:text-foreground transition-colors">Contact</a></li>
            </ul>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Legal</p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link></li>
              <li><Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link></li>
              <li><Link href="/cookies" className="hover:text-foreground transition-colors">Cookie Policy</Link></li>
            </ul>
          </div>
        </div>
        <Separator className="my-8" />
        <p className="text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} Kanbanica. All rights reserved.
        </p>
      </div>
    </footer>
  )
}

// --- Page --------------------------------------------------------------------

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <HeroSection />
      <SocialProofBar />
      <FeaturesSection />
      <HowItWorksSection />
      <ViewsShowcaseSection />
      <TestimonialsSection />
      <FaqSection />
      <CtaBanner />
      <Footer />
    </div>
  )
}
