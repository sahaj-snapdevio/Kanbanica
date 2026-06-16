"use client";

import * as React from "react";
import Link from "next/link";
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
  Menu,
  X,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

function useInView(threshold = 0.12) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function Animate({
  children,
  className,
  delay = 0,
  from = "bottom",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  from?: "bottom" | "left" | "right";
}) {
  const { ref, visible } = useInView();
  const translate =
    from === "left" ? "-translate-x-8" : from === "right" ? "translate-x-8" : "translate-y-8";
  return (
    <div
      ref={ref}
      className={cn(
        "transition-all duration-700 ease-out",
        visible ? "opacity-100 translate-x-0 translate-y-0" : cn("opacity-0", translate),
        className,
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

const features = [
  { icon: LayoutList, title: "Tasks & Subtasks", description: "Create tasks with rich descriptions, priorities, assignees, due dates, checklists, and nested subtasks. Everything your team needs in one place." },
  { icon: Zap, title: "Sprints", description: "Run agile sprints with story points, burndown tracking, and automatic close logic. Keep your team moving in focused two-week cycles." },
  { icon: Kanban, title: "Multiple Views", description: "Switch between List, Board, and Calendar views. Each view gives your team a different lens on the same work — no duplicate data entry." },
  { icon: MessageSquare, title: "Comments & Activity", description: "Threaded comments, @mentions, emoji reactions, and a full activity timeline on every task. Your entire conversation history, always in context." },
  { icon: Bell, title: "Smart Notifications", description: "In-app, email, and browser push notifications. Get alerted when tasks are assigned, comments are posted, or deadlines are approaching." },
  { icon: Search, title: "Search & Filters", description: "Global search across all workspaces with Ctrl+K. Filter tasks by status, priority, assignee, due date, and tags — then save your filters." },
];

const steps = [
  { number: "01", title: "Create your Workspace", description: "Your Workspace is your company or team's home. Give it a name, upload a logo, and you're ready in seconds." },
  { number: "02", title: "Invite your team", description: "Invite teammates via email or a shareable link. Assign roles — Owner, Admin, Member, or Guest — per person." },
  { number: "03", title: "Organise into Spaces & Lists", description: "Create Spaces for each department or project area. Inside each Space, create Lists to group related tasks together." },
  { number: "04", title: "Start working", description: "Create tasks, assign them, set due dates, and track progress across List, Board, and Calendar views." },
];

const testimonials = [
  { name: "Sarah Chen", role: "Engineering Lead, Flowboard", initials: "SC", body: "We switched from ClickUp and the onboarding took 20 minutes. The Board view is snappy, the permissions model is exactly what we needed for guest contractors." },
  { name: "Marcus Rivera", role: "Product Manager, Stackd", initials: "MR", body: "Sprint planning used to take half a day. With Kanbanica's sprint view and story points, we're done in an hour. The burndown chart is a game-changer." },
  { name: "Priya Nair", role: "Founder, Loopback", initials: "PN", body: "My Tasks view is something I didn't know I needed. Seeing every task assigned to me across every project in one place — with a due date grouping — is brilliant." },
];

const faqs = [
  { q: "How is Kanbanica different from Jira or ClickUp?", a: "Kanbanica is built for teams that want the power of Jira and the usability of ClickUp — without the bloat. We focus on the core: tasks, sprints, views, and collaboration. No feature creep." },
  { q: "How does magic link authentication work?", a: "You enter your email and we send a one-time sign-in link. Clicking it logs you in instantly. No passwords to create, remember, or reset. First-time users get an account created automatically." },
  { q: "What is a Space?", a: "A Space is a logical grouping for a team or department inside your Workspace — like Engineering, Marketing, or HR. Each Space has its own Lists, members, and permissions." },
  { q: "Can I control who sees what?", a: "Yes. Workspace roles (Owner, Admin, Member, Guest) control workspace-level access. Space permissions (Full Access, Edit, View) control everything inside a Space. Guests can only see Spaces they are explicitly invited to." },
  { q: "What views are available?", a: "MVP ships with List View, Board View (Kanban), and My Tasks. Calendar View, Gantt, and Workload View are on the roadmap." },
  { q: "Can I invite contractors or clients as guests?", a: "Yes. The Guest role gives scoped access to only the Spaces you invite them to. They cannot see anything else in your Workspace." },
  { q: "Is there a free plan?", a: "We're in early access. Sign up now and lock in founding member pricing before we launch paid plans." },
];

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 font-semibold text-indigo-600 text-xs uppercase tracking-wide",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Navbar() {
  const [scrolled, setScrolled] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-all duration-200",
        scrolled
          ? "border-b border-[#e5e7eb] bg-white/95 shadow-sm backdrop-blur-sm"
          : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <span className="font-bold text-indigo-600 text-lg tracking-tight">Kanbanica</span>
        <nav className="hidden items-center gap-6 text-sm text-[#6b7280] sm:flex">
          <a href="#features" className="transition-colors hover:text-[#111827]">Features</a>
          <a href="#how-it-works" className="transition-colors hover:text-[#111827]">How it works</a>
          <a href="#faq" className="transition-colors hover:text-[#111827]">FAQ</a>
        </nav>
        <div className="hidden items-center gap-2 sm:flex">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button size="sm" asChild className="bg-indigo-600 text-white hover:bg-indigo-700">
            <Link href="/login">
              Get Started Free <ArrowRight className="ml-1 size-3.5" />
            </Link>
          </Button>
        </div>
        <button
          className="rounded-md p-2 text-[#6b7280] hover:text-[#111827] sm:hidden"
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {mobileOpen && (
        <div className="border-t border-[#e5e7eb] bg-white px-6 pb-4 sm:hidden">
          <nav className="flex flex-col gap-3 pt-4 text-sm text-[#6b7280]">
            <a href="#features" onClick={() => setMobileOpen(false)} className="hover:text-[#111827]">Features</a>
            <a href="#how-it-works" onClick={() => setMobileOpen(false)} className="hover:text-[#111827]">How it works</a>
            <a href="#faq" onClick={() => setMobileOpen(false)} className="hover:text-[#111827]">FAQ</a>
            <div className="flex flex-col gap-2 border-t border-[#e5e7eb] pt-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/login">Sign in</Link>
              </Button>
              <Button size="sm" asChild className="bg-indigo-600 text-white hover:bg-indigo-700">
                <Link href="/login">Get Started Free</Link>
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

const DOT_GRID =
  "url(\"data:image/svg+xml,%3Csvg width='20' height='20' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='1' cy='1' r='1' fill='%236366f1' fill-opacity='0.05'/%3E%3C/svg%3E\")";

function HeroSection() {
  return (
    <section
      className="relative overflow-hidden bg-white"
      style={{ backgroundImage: DOT_GRID, backgroundSize: "20px 20px" }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px]"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(99,102,241,0.14) 0%, transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-6 pb-0 pt-20 text-center">
        <Animate>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 font-semibold text-indigo-700 text-xs">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            Now in early access
          </div>
          <h1 className="mb-5 mt-2 text-5xl font-bold leading-tight tracking-tight text-[#111827] sm:text-6xl">
            Project management
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(to right, #6366f1, #7c3aed)" }}
            >
              your team will actually use
            </span>
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-lg leading-relaxed text-[#6b7280]">
            Kanbanica gives every team a shared home — Workspaces, Spaces, Lists, and Tasks — with
            sprints, board views, comments, and notifications built in.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              size="lg"
              asChild
              className="h-11 bg-indigo-600 px-6 text-base text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700"
            >
              <Link href="/login">
                Get Started Free <ArrowRight className="ml-1.5 size-4" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              asChild
              className="h-11 border-[#e5e7eb] px-6 text-base hover:bg-[#f9fafb]"
            >
              <a href="#features">See what is included</a>
            </Button>
          </div>
          <p className="mt-4 text-[#9ca3af] text-xs">No credit card required · Magic link sign-in</p>
        </Animate>

        <Animate delay={300} className="mt-16">
          <div className="relative mx-auto max-w-4xl">
            <div className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-2xl ring-1 ring-indigo-100">
              <div className="flex items-center gap-1.5 border-b border-[#e5e7eb] bg-[#f9fafb] px-4 py-2.5">
                <span className="size-3 rounded-full bg-[#ef4444]" />
                <span className="size-3 rounded-full bg-[#f59e0b]" />
                <span className="size-3 rounded-full bg-[#10b981]" />
                <div className="mx-auto ml-4 max-w-xs flex-1 rounded-md border border-[#e5e7eb] bg-white px-3 py-1 text-[#9ca3af] text-xs">
                  kanbanica.com/acme/engineering/backlog
                </div>
              </div>
              <div className="flex bg-[#f9fafb]">
                <div className="flex w-14 flex-col items-center gap-4 border-r border-[#e5e7eb] bg-white px-3.5 py-4">
                  {[LayoutList, Kanban, Bell, Search, Users].map((Icon, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-md",
                        i === 0 ? "bg-indigo-600 text-white" : "text-[#9ca3af] hover:bg-[#f3f4f6]",
                      )}
                    >
                      <Icon className="size-4" />
                    </div>
                  ))}
                </div>
                <div className="min-w-0 flex-1 p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-1 text-[#6b7280] text-xs">
                      <span>Engineering</span>
                      <ChevronRight className="size-3" />
                      <span className="font-semibold text-[#111827]">Backlog</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {["List", "Board", "Calendar"].map((v, i) => (
                        <span
                          key={v}
                          className={cn(
                            "cursor-pointer rounded px-2.5 py-1 font-medium text-xs transition-colors",
                            i === 0
                              ? "bg-indigo-600 text-white"
                              : "text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#111827]",
                          )}
                        >
                          {v}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mb-3 flex items-center gap-2 border-b border-[#e5e7eb] pb-3">
                    {["Filter", "Group by: Status", "Sort"].map((label) => (
                      <span
                        key={label}
                        className="rounded border border-dashed border-[#e5e7eb] px-2 py-1 text-[#9ca3af] text-xs"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    {[
                      { title: "Fix login redirect bug", status: "In Progress", statusCls: "bg-indigo-50 text-indigo-600", priority: "High", pCls: "bg-orange-50 text-orange-500", assignee: "SC" },
                      { title: "Design onboarding flow", status: "Review", statusCls: "bg-amber-50 text-amber-600", priority: "Medium", pCls: "bg-yellow-50 text-yellow-600", assignee: "MR" },
                      { title: "Write API documentation", status: "Todo", statusCls: "bg-[#f3f4f6] text-[#6b7280]", priority: "Low", pCls: "bg-blue-50 text-blue-500", assignee: "PN" },
                      { title: "Set up CI/CD pipeline", status: "Todo", statusCls: "bg-[#f3f4f6] text-[#6b7280]", priority: "Urgent", pCls: "bg-red-50 text-red-500", assignee: "SC" },
                      { title: "Implement search indexing", status: "In Progress", statusCls: "bg-indigo-50 text-indigo-600", priority: "High", pCls: "bg-orange-50 text-orange-500", assignee: "MR" },
                    ].map((t) => (
                      <div
                        key={t.title}
                        className="flex items-center gap-3 rounded-md border border-[#e5e7eb] bg-white px-3 py-2 text-sm transition-colors hover:border-indigo-200"
                      >
                        <span className="size-4 shrink-0 rounded border-2 border-[#e5e7eb]" />
                        <span className="flex-1 truncate font-medium text-[#111827] text-xs">{t.title}</span>
                        <span className={cn("shrink-0 rounded px-2 py-0.5 text-[10px] font-medium", t.statusCls)}>{t.status}</span>
                        <span className={cn("hidden shrink-0 rounded px-2 py-0.5 text-[10px] font-medium sm:inline-block", t.pCls)}>{t.priority}</span>
                        <Avatar className="size-5 shrink-0">
                          <AvatarFallback className="bg-indigo-100 text-[8px] text-indigo-700">{t.assignee}</AvatarFallback>
                        </Avatar>
                      </div>
                    ))}
                    <div className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[#9ca3af] text-xs hover:text-[#6b7280]">
                      <span className="text-base leading-none">+</span> Add task
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-24 bg-gradient-to-b from-transparent to-white" />
          </div>
        </Animate>
      </div>
    </section>
  );
}

function SocialProofBar() {
  return (
    <div className="border-y border-[#e5e7eb] bg-[#f9fafb] py-5">
      <div className="mx-auto max-w-6xl px-6">
        <Animate>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <p className="text-[#6b7280] text-sm">
              <span className="font-semibold text-[#111827]">500+ teams</span> already managing their
              work with Kanbanica
            </p>
            <div className="flex items-center gap-6">
              {["Acme Co", "Flowboard", "Stackd", "Loopback", "Nexus"].map((name) => (
                <span
                  key={name}
                  className="font-semibold text-[#d1d5db] text-xs uppercase tracking-widest"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </Animate>
      </div>
    </div>
  );
}

const LINE_GRID =
  "linear-gradient(rgba(99,102,241,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.04) 1px, transparent 1px)";

function FeaturesSection() {
  const { ref, visible } = useInView();
  return (
    <section
      id="features"
      className="py-24"
      style={{ backgroundImage: LINE_GRID, backgroundSize: "40px 40px", backgroundColor: "#f9fafb" }}
    >
      <div className="mx-auto max-w-6xl px-6">
        <Animate className="mb-14 text-center">
          <SectionLabel className="mb-4">Features</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#111827]">
            Everything your team needs to ship
          </h2>
          <p className="mt-2 text-[#6b7280]">No bolt-ons. No plugins. Everything in the box.</p>
        </Animate>
        <div ref={ref} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, description }, i) => (
            <div
              key={title}
              className={cn(
                "group cursor-default rounded-xl border border-[#e5e7eb] bg-white p-6 shadow-sm transition-all duration-300",
                "hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md",
                visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
              )}
              style={{
                transitionDelay: visible ? `${i * 80}ms` : "0ms",
                transitionProperty: "opacity, transform, box-shadow, border-color",
              }}
            >
              <div
                className="mb-4 flex size-10 items-center justify-center rounded-lg text-white"
                style={{ background: "linear-gradient(135deg, #6366f1, #7c3aed)" }}
              >
                <Icon className="size-5" />
              </div>
              <h3 className="mb-2 font-semibold text-[#111827] text-base">{title}</h3>
              <p className="text-[#6b7280] text-sm leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const { ref, visible } = useInView();
  return (
    <section id="how-it-works" className="bg-white py-24">
      <div className="mx-auto max-w-6xl px-6">
        <Animate className="mb-14 text-center">
          <SectionLabel className="mb-4">How it works</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#111827]">
            Up and running in minutes
          </h2>
          <p className="mt-2 text-[#6b7280]">No configuration required. Just sign in and start organising.</p>
        </Animate>
        <Animate delay={100} className="mb-12 flex flex-col items-center gap-3">
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
            {["Workspace", "Space", "List", "Task"].map((label, i, arr) => (
              <React.Fragment key={label}>
                <span className="rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-3 py-1.5 font-medium text-[#111827]">
                  {label}
                </span>
                {i < arr.length - 1 && <ChevronRight className="size-4 text-[#9ca3af]" />}
              </React.Fragment>
            ))}
          </div>
          <p className="text-[#9ca3af] text-xs">e.g. Acme Inc › Engineering › Backlog › Fix login bug</p>
        </Animate>
        <div ref={ref} className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="pointer-events-none absolute top-10 right-[12.5%] left-[12.5%] hidden border-t-2 border-dashed border-indigo-100 lg:block" />
          {steps.map((step, i) => (
            <div
              key={step.number}
              className={cn(
                "relative rounded-xl border border-[#e5e7eb] bg-white p-6 shadow-sm transition-all duration-500",
                visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
              )}
              style={{
                transitionDelay: visible ? `${i * 120}ms` : "0ms",
                transitionProperty: "opacity, transform",
              }}
            >
              <div
                className="mb-3 select-none bg-clip-text text-5xl font-bold text-transparent"
                style={{ backgroundImage: "linear-gradient(135deg, #c7d2fe, #ddd6fe)" }}
              >
                {step.number}
              </div>
              <h3 className="mb-2 font-semibold text-[#111827] text-sm">{step.title}</h3>
              <p className="text-[#6b7280] text-sm leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ViewsShowcaseSection() {
  return (
    <section
      className="py-24"
      style={{ backgroundImage: LINE_GRID, backgroundSize: "40px 40px", backgroundColor: "#f9fafb" }}
    >
      <div className="mx-auto max-w-6xl px-6">
        <Animate className="mb-10 text-center">
          <SectionLabel className="mb-4">Views</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#111827]">See work your way</h2>
          <p className="mt-2 text-[#6b7280]">Switch views without leaving the page. Your filters carry across.</p>
        </Animate>
        <Animate delay={150}>
          <Tabs defaultValue="list" className="mx-auto max-w-3xl">
            <TabsList className="mb-6 grid w-full grid-cols-3 rounded-lg bg-[#f3f4f6] p-1">
              <TabsTrigger value="list" className="gap-1.5 data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                <LayoutList className="size-3.5" />List
              </TabsTrigger>
              <TabsTrigger value="board" className="gap-1.5 data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                <Kanban className="size-3.5" />Board
              </TabsTrigger>
              <TabsTrigger value="mytasks" className="gap-1.5 data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
                <CalendarDays className="size-3.5" />My Tasks
              </TabsTrigger>
            </TabsList>
            <TabsContent value="list" className="animate-in fade-in-0 duration-200">
              <Card className="border-[#e5e7eb] shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="font-semibold normal-case tracking-normal text-sm">List View</CardTitle>
                  <CardDescription>Default view — see all tasks as rows with inline editing.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5">
                    {[
                      { t: "Fix authentication bug", done: true },
                      { t: "Design dashboard layout", done: true },
                      { t: "Write unit tests", done: false },
                      { t: "Deploy to staging", done: false },
                    ].map(({ t, done }) => (
                      <div key={t} className={cn("flex items-center gap-3 rounded border px-3 py-2 text-sm", done ? "border-[#e5e7eb] bg-[#f9fafb]" : "border-indigo-100 bg-indigo-50/30")}>
                        <div className={cn("flex size-4 shrink-0 items-center justify-center rounded border-2", done ? "border-indigo-600 bg-indigo-600" : "border-[#e5e7eb]")}>
                          {done && <Check className="size-2.5 text-white" strokeWidth={3} />}
                        </div>
                        <span className={cn("flex-1 text-xs", done ? "text-[#9ca3af] line-through" : "text-[#111827]")}>{t}</span>
                        {done && <span className="text-[10px] text-[#9ca3af]">Completed</span>}
                      </div>
                    ))}
                    <div className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[#9ca3af] text-xs">
                      <span className="text-base leading-none">+</span> Add task
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="board" className="animate-in fade-in-0 duration-200">
              <Card className="border-[#e5e7eb] shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="font-semibold normal-case tracking-normal text-sm">Board View</CardTitle>
                  <CardDescription>Kanban columns by status. Drag cards to change status.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: "Todo", dot: "#9ca3af", tasks: ["Write tests", "Update docs"] },
                      { label: "In Progress", dot: "#6366f1", tasks: ["Fix auth bug", "Design layout"] },
                      { label: "Review", dot: "#f59e0b", tasks: ["API integration"] },
                      { label: "Done", dot: "#10b981", tasks: ["Deploy staging"] },
                    ].map((col) => (
                      <div key={col.label} className="rounded-md border border-[#e5e7eb] bg-[#f9fafb] p-2">
                        <div className="mb-2 flex items-center gap-1.5 px-1">
                          <span className="size-2 shrink-0 rounded-full" style={{ background: col.dot }} />
                          <p className="font-semibold text-[#6b7280] text-[10px]">{col.label}</p>
                        </div>
                        {col.tasks.map((t) => (
                          <div key={t} className="mb-1.5 rounded border border-[#e5e7eb] bg-white px-2.5 py-2 text-[10px] text-[#111827] shadow-sm transition-colors hover:border-indigo-200">
                            {t}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="mytasks" className="animate-in fade-in-0 duration-200">
              <Card className="border-[#e5e7eb] shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="font-semibold normal-case tracking-normal text-sm">My Tasks</CardTitle>
                  <CardDescription>All tasks assigned to you, across every project, grouped by due date.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {[
                      { group: "Overdue", color: "#ef4444", tasks: [{ t: "Update API docs", ctx: "Engineering › Docs" }] },
                      { group: "Due Today", color: "#f59e0b", tasks: [{ t: "Fix login bug", ctx: "Engineering › Backlog" }, { t: "Review PR #42", ctx: "Engineering › Sprint 3" }] },
                      { group: "This Week", color: "#111827", tasks: [{ t: "Write sprint retrospective", ctx: "Engineering › Sprint 3" }, { t: "Onboard new member", ctx: "HR › Onboarding" }] },
                    ].map((g) => (
                      <div key={g.group}>
                        <p className="mb-1.5 font-semibold text-xs" style={{ color: g.color }}>{g.group}</p>
                        {g.tasks.map(({ t, ctx }) => (
                          <div key={t} className="mb-1 flex items-center gap-2 rounded border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2 text-xs">
                            <span className="size-3.5 shrink-0 rounded border border-[#d1d5db]" />
                            <span className="flex-1 text-[#111827]">{t}</span>
                            <span className="text-[#9ca3af] text-[10px]">{ctx}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </Animate>
      </div>
    </section>
  );
}

function TestimonialsSection() {
  const { ref, visible } = useInView();
  return (
    <section className="relative overflow-hidden bg-white py-24">
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-50 opacity-60 blur-3xl" />
      <div className="relative mx-auto max-w-6xl px-6">
        <Animate className="mb-12 text-center">
          <SectionLabel className="mb-4">Testimonials</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#111827]">Teams love it</h2>
        </Animate>
        <div ref={ref} className="grid gap-5 sm:grid-cols-3">
          {testimonials.map((t, i) => (
            <div
              key={t.name}
              className={cn(
                "flex flex-col gap-4 rounded-xl border border-[#e5e7eb] bg-white p-6 shadow-sm transition-all duration-500",
                visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
              )}
              style={{
                transitionDelay: visible ? `${i * 100}ms` : "0ms",
                transitionProperty: "opacity, transform",
              }}
            >
              <div className="flex gap-0.5">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Star key={j} className="size-4 fill-amber-400 text-amber-400" />
                ))}
              </div>
              <p className="flex-1 text-[#374151]/80 text-sm leading-relaxed">&ldquo;{t.body}&rdquo;</p>
              <div className="flex items-center gap-3 border-t border-[#e5e7eb] pt-4">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-indigo-100 text-indigo-700 text-xs">{t.initials}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-[#111827] text-sm">{t.name}</p>
                  <p className="text-[#6b7280] text-xs">{t.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section id="faq" className="bg-[#f9fafb] py-24">
      <div className="mx-auto max-w-2xl px-6">
        <Animate className="mb-12 text-center">
          <SectionLabel className="mb-4">FAQ</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#111827]">Common questions</h2>
          <p className="mt-2 text-[#6b7280]">
            {"Can't find an answer? "}
            <a
              href="mailto:support@kanbanica.com"
              className="text-indigo-600 underline-offset-2 hover:underline"
            >
              Reach out to support
            </a>
          </p>
        </Animate>
        <Animate delay={100}>
          <Accordion type="single" collapsible className="space-y-2">
            {faqs.map((faq, i) => (
              <AccordionItem
                key={i}
                value={`faq-${i}`}
                className="rounded-lg border border-[#e5e7eb] bg-white px-1 shadow-sm"
              >
                <AccordionTrigger className="px-4 py-4 text-left font-semibold text-[#111827] text-sm hover:no-underline">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 text-[#6b7280] text-sm leading-relaxed">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Animate>
      </div>
    </section>
  );
}

function CtaBanner() {
  return (
    <section className="bg-white py-20">
      <div className="mx-auto max-w-6xl px-6">
        <Animate>
          <div
            className="relative overflow-hidden rounded-2xl px-8 py-16 text-center text-white"
            style={{ background: "linear-gradient(135deg, #6366f1 0%, #6366f1 50%, #7c3aed 100%)" }}
          >
            <div className="pointer-events-none absolute -top-16 -left-16 size-64 rounded-full bg-white/10 blur-3xl" />
            <div className="pointer-events-none absolute -right-16 -bottom-16 size-64 rounded-full bg-white/10 blur-3xl" />
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.07]"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg width='20' height='20' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='1' cy='1' r='1' fill='white'/%3E%3C/svg%3E\")",
                backgroundSize: "20px 20px",
              }}
            />
            <div className="relative">
              <h2 className="mb-3 text-3xl font-bold">Ready to get your team organised?</h2>
              <p className="mb-8 text-lg text-white/75">
                Sign up in seconds. No credit card. No setup fees.
              </p>
              <Button
                size="lg"
                asChild
                className="h-11 bg-white px-8 font-semibold text-base text-indigo-700 shadow-lg hover:bg-indigo-50"
              >
                <Link href="/login">
                  Start for free <ArrowRight className="ml-1.5 size-4" />
                </Link>
              </Button>
              <p className="mt-4 text-sm text-white/50">Magic link sign-in · No passwords</p>
            </div>
          </div>
        </Animate>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[#e5e7eb] bg-[#f9fafb]">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid gap-8 sm:grid-cols-4">
          <div className="sm:col-span-1">
            <span className="font-bold text-base text-indigo-600">Kanbanica</span>
            <p className="mt-2 text-[#6b7280] text-xs leading-relaxed">
              Project management for modern teams. Workspaces, Spaces, Lists, and Tasks.
            </p>
          </div>
          <div>
            <p className="mb-3 font-semibold text-[#9ca3af] text-xs uppercase tracking-wide">Product</p>
            <ul className="space-y-2 text-[#6b7280] text-sm">
              <li><a href="#features" className="transition-colors hover:text-[#111827]">Features</a></li>
              <li><a href="#how-it-works" className="transition-colors hover:text-[#111827]">How it works</a></li>
              <li><a href="#faq" className="transition-colors hover:text-[#111827]">FAQ</a></li>
            </ul>
          </div>
          <div>
            <p className="mb-3 font-semibold text-[#9ca3af] text-xs uppercase tracking-wide">Company</p>
            <ul className="space-y-2 text-[#6b7280] text-sm">
              <li><a href="#" className="transition-colors hover:text-[#111827]">About</a></li>
              <li><a href="mailto:support@kanbanica.com" className="transition-colors hover:text-[#111827]">Contact</a></li>
            </ul>
          </div>
          <div>
            <p className="mb-3 font-semibold text-[#9ca3af] text-xs uppercase tracking-wide">Legal</p>
            <ul className="space-y-2 text-[#6b7280] text-sm">
              <li><Link href="/privacy" className="transition-colors hover:text-[#111827]">Privacy Policy</Link></li>
              <li><Link href="/terms" className="transition-colors hover:text-[#111827]">Terms of Service</Link></li>
              <li><Link href="/cookies" className="transition-colors hover:text-[#111827]">Cookie Policy</Link></li>
            </ul>
          </div>
        </div>
        <Separator className="my-8" />
        <div className="flex items-center justify-between text-[#9ca3af] text-xs">
          <p>&copy; 2025 Kanbanica. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="transition-colors hover:text-[#6b7280]">Privacy</Link>
            <Link href="/terms" className="transition-colors hover:text-[#6b7280]">Terms</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-[#111827]">
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
  );
}
