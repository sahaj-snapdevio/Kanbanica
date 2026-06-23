"use client";

import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Globe,
  Kanban,
  LayoutList,
  Menu,
  MessageSquare,
  MessagesSquare,
  MoveHorizontal,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  X,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import * as React from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MARKETING_DOMAIN,
  PRODUCT_NAME,
  SUPPORT_EMAIL,
} from "@/config/platform";
import { cn } from "@/lib/utils";

function useInView(threshold = 0.12) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
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
    from === "left"
      ? "-translate-x-8"
      : from === "right"
        ? "translate-x-8"
        : "translate-y-8";
  return (
    <div
      className={cn(
        "transition-all duration-700 ease-out",
        visible
          ? "opacity-100 translate-x-0 translate-y-0"
          : cn("opacity-0", translate),
        className,
      )}
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

const features = [
  {
    icon: LayoutList,
    title: "Tasks & Subtasks",
    description:
      "Create tasks with rich descriptions, priorities, assignees, due dates, checklists, and nested subtasks. Everything your team needs in one place.",
  },
  {
    icon: Zap,
    title: "Sprints",
    description:
      "Run agile sprints with story points, burndown tracking, and automatic close logic. Keep your team moving in focused two-week cycles.",
  },
  {
    icon: Kanban,
    title: "Multiple Views",
    description:
      "Switch between List, Board, and Calendar views. Each view gives your team a different lens on the same work — no duplicate data entry.",
  },
  {
    icon: MessageSquare,
    title: "Comments & Activity",
    description:
      "Threaded comments, @mentions, emoji reactions, and a full activity timeline on every task. Your entire conversation history, always in context.",
  },
  {
    icon: Bell,
    title: "Smart Notifications",
    description:
      "In-app, email, and browser push notifications. Get alerted when tasks are assigned, comments are posted, or deadlines are approaching.",
  },
  {
    icon: Search,
    title: "Search & Filters",
    description:
      "Global search across all workspaces with Ctrl+K. Filter tasks by status, priority, assignee, due date, and tags — then save your filters.",
  },
];

const steps = [
  {
    number: "01",
    title: "Create your Workspace",
    description:
      "Your Workspace is your company or team's home. Give it a name, upload a logo, and you're ready in seconds.",
  },
  {
    number: "02",
    title: "Invite your team",
    description:
      "Invite teammates via email or a shareable link. Assign roles — Owner, Admin, Member, or Guest — per person.",
  },
  {
    number: "03",
    title: "Organise into Spaces & Lists",
    description:
      "Create Spaces for each department or project area. Inside each Space, create Lists to group related tasks together.",
  },
  {
    number: "04",
    title: "Start working",
    description:
      "Create tasks, assign them, set due dates, and track progress across List, Board, and Calendar views.",
  },
];

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
    body: `Sprint planning used to take half a day. With ${PRODUCT_NAME}'s sprint view and story points, we're done in an hour. The burndown chart is a game-changer.`,
  },
  {
    name: "Priya Nair",
    role: "Founder, Loopback",
    initials: "PN",
    body: "My Tasks view is something I didn't know I needed. Seeing every task assigned to me across every project in one place — with a due date grouping — is brilliant.",
  },
];

const faqs = [
  {
    q: `How is ${PRODUCT_NAME} different from Jira or ClickUp?`,
    a: `${PRODUCT_NAME} is built for teams that want the power of Jira and the usability of ClickUp — without the bloat. We focus on the core: tasks, sprints, views, and collaboration. No feature creep — and it's completely free.`,
  },
  {
    q: "How does magic link authentication work?",
    a: "You enter your email and we send a one-time sign-in link. Clicking it logs you in instantly. No passwords to create, remember, or reset. First-time users get an account created automatically.",
  },
  {
    q: "What is a Space?",
    a: "A Space is a logical grouping for a team or department inside your Workspace — like Engineering, Marketing, or HR. Each Space has its own Lists, members, and permissions.",
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
    a: "Yes. The Guest role gives scoped access to only the Spaces you invite them to. They cannot see anything else in your Workspace.",
  },
  {
    q: "Is it really free?",
    a: `Yes — ${PRODUCT_NAME} is completely free to use. Every feature is available to your whole team with no paid tiers, seat limits, or feature paywalls. No credit card required to get started.`,
  },
];

function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-[#174D38]/30 bg-[#174D38]/10 px-3 py-1 font-semibold text-[#174D38] text-xs uppercase tracking-wide",
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
          ? "border-b border-[#CBCBCB] bg-white/95 shadow-sm backdrop-blur-sm"
          : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <span className="flex items-center gap-2 font-bold text-[#174D38] text-lg tracking-tight">
          <Image
            alt={`${PRODUCT_NAME} Logo`}
            className="h-8 w-auto object-contain"
            height={32}
            src="/Kanbanica2.png"
            width={150}
          />
        </span>
        <nav className="hidden items-center gap-6 text-sm text-[#6b7280] sm:flex">
          <a
            className="transition-colors hover:text-[#174D38]"
            href="#features"
          >
            Features
          </a>
          <a className="transition-colors hover:text-[#174D38]" href="#why">
            Why us
          </a>
          <a
            className="transition-colors hover:text-[#174D38]"
            href="#how-it-works"
          >
            How it works
          </a>
          <a className="transition-colors hover:text-[#174D38]" href="#faq">
            FAQ
          </a>
        </nav>
        <div className="hidden items-center gap-2 sm:flex">
          <Button asChild size="sm" variant="ghost">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button
            asChild
            className="bg-[#174D38] text-white hover:bg-[#103526]"
            size="sm"
          >
            <Link href="/login">
              Get Started Free <ArrowRight className="ml-1 size-3.5" />
            </Link>
          </Button>
        </div>
        <button
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          className="rounded-md p-2 text-[#6b7280] hover:text-[#174D38] sm:hidden"
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {mobileOpen && (
        <div className="border-t border-[#CBCBCB] bg-white px-6 pb-4 sm:hidden">
          <nav className="flex flex-col gap-3 pt-4 text-sm text-[#6b7280]">
            <a
              className="hover:text-[#174D38]"
              href="#features"
              onClick={() => setMobileOpen(false)}
            >
              Features
            </a>
            <a
              className="hover:text-[#174D38]"
              href="#why"
              onClick={() => setMobileOpen(false)}
            >
              Why us
            </a>
            <a
              className="hover:text-[#174D38]"
              href="#how-it-works"
              onClick={() => setMobileOpen(false)}
            >
              How it works
            </a>
            <a
              className="hover:text-[#174D38]"
              href="#faq"
              onClick={() => setMobileOpen(false)}
            >
              FAQ
            </a>
            <div className="flex flex-col gap-2 border-t border-[#CBCBCB] pt-2">
              <Button asChild size="sm" variant="outline">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button
                asChild
                className="bg-[#174D38] text-white hover:bg-[#103526]"
                size="sm"
              >
                <Link href="/login">Get Started Free</Link>
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

interface TypewriterProps {
  phrases: string[];
  typingSpeed?: number;
  erasingSpeed?: number;
  pauseDuration?: number;
  colors?: string[];
}

function Typewriter({
  phrases,
  typingSpeed = 100,
  erasingSpeed = 50,
  pauseDuration = 2000,
  colors = ["#174D38", "#174D38"],
}: TypewriterProps) {
  const [currentPhraseIndex, setCurrentPhraseIndex] = React.useState(0);
  const [currentText, setCurrentText] = React.useState("");
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [hasStarted, setHasStarted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    const timer = setTimeout(() => {
      setHasStarted(true);
    }, 600); // delay to sync with page load fade-in
    return () => clearTimeout(timer);
  }, []);

  React.useEffect(() => {
    if (!hasStarted) return;

    // Check for prefers-reduced-motion
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mediaQuery.matches) {
      setCurrentText(phrases[currentPhraseIndex]);
      const timer = setTimeout(() => {
        setCurrentPhraseIndex((prev) => (prev + 1) % phrases.length);
      }, pauseDuration);
      return () => clearTimeout(timer);
    }

    const currentPhrase = phrases[currentPhraseIndex];
    let timer: NodeJS.Timeout;

    if (isDeleting) {
      timer = setTimeout(() => {
        setCurrentText((prev) => prev.slice(0, -1));
      }, erasingSpeed);
    } else {
      timer = setTimeout(() => {
        setCurrentText((prev) => currentPhrase.slice(0, prev.length + 1));
      }, typingSpeed);
    }

    if (!isDeleting && currentText === currentPhrase) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setIsDeleting(true);
      }, pauseDuration);
    }

    if (isDeleting && currentText === "") {
      clearTimeout(timer);
      setIsDeleting(false);
      setCurrentPhraseIndex((prev) => (prev + 1) % phrases.length);
    }

    return () => clearTimeout(timer);
  }, [
    hasStarted,
    currentText,
    isDeleting,
    currentPhraseIndex,
    phrases,
    typingSpeed,
    erasingSpeed,
    pauseDuration,
  ]);

  const currentColor = colors[currentPhraseIndex % colors.length];

  return (
    <span
      className="inline-block whitespace-nowrap"
      style={{
        color: currentColor,
        transition: "color 0.3s ease, opacity 0.5s ease",
        opacity: mounted ? 1 : 0,
      }}
    >
      {currentText}
      <span
        className="ml-1 inline-block w-[3px] h-[0.85em] translate-y-[0.08em] animate-typewriter-blink rounded-full"
        style={{ backgroundColor: currentColor }}
      />
      <style>{`
        @keyframes typewriter-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .animate-typewriter-blink {
          animation: typewriter-blink 1s step-end infinite;
        }
      `}</style>
    </span>
  );
}

const DOT_GRID =
  "url(\"data:image/svg+xml,%3Csvg width='20' height='20' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='1' cy='1' r='1' fill='%23174D38' fill-opacity='0.05'/%3E%3C/svg%3E\")";

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
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(23,77,56,0.14) 0%, transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-6 pb-0 pt-20 text-center">
        <Animate>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#174D38]/30 bg-[#174D38]/10 px-3 py-1.5 font-semibold text-[#174D38] text-xs">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            Free for every team — no credit card
          </div>
          <h1 className="mb-5 mt-2 text-5xl font-bold leading-tight tracking-tight text-[#174D38] sm:text-6xl">
            Project management
            <br />
            your team will <Typewriter phrases={["actually see", "trust it"]} />
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-lg leading-relaxed text-[#6b7280]">
            {PRODUCT_NAME} gives every team a shared home — Workspaces, Spaces,
            Lists, and Tasks — with sprints, board views, comments, and
            notifications built in. Free for your whole team.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              asChild
              className="h-11 bg-[#174D38] px-6 text-base text-white shadow-lg shadow-[#4D1717]/40 hover:bg-[#103526]"
              size="lg"
            >
              <Link href="/login">
                Get Started Free <ArrowRight className="ml-1.5 size-4" />
              </Link>
            </Button>
            <Button
              asChild
              className="h-11 border-[#CBCBCB] px-6 text-base hover:bg-[#F2F2F2]"
              size="lg"
              variant="outline"
            >
              <a href="#features">See what is included</a>
            </Button>
          </div>
          <p className="mt-4 text-[#9ca3af] text-xs">
            No credit card required · Magic link sign-in
          </p>
        </Animate>

        <Animate className="mt-16" delay={300}>
          <div className="relative mx-auto max-w-4xl">
            <div className="overflow-hidden rounded-xl border border-[#CBCBCB] bg-white shadow-2xl ring-1 ring-[#174D38]/20">
              <div className="flex items-center gap-1.5 border-b border-[#CBCBCB] bg-[#F2F2F2] px-4 py-2.5">
                <span className="size-3 rounded-full bg-[#ef4444]" />
                <span className="size-3 rounded-full bg-[#f59e0b]" />
                <span className="size-3 rounded-full bg-[#10b981]" />
                <div className="mx-auto ml-4 max-w-xs flex-1 rounded-md border border-[#CBCBCB] bg-white px-3 py-1 text-[#9ca3af] text-xs">
                  {MARKETING_DOMAIN}/acme/engineering/backlog
                </div>
              </div>
              <div className="flex bg-[#F2F2F2]">
                <div className="flex w-14 flex-col items-center gap-4 border-r border-[#CBCBCB] bg-white px-3.5 py-4">
                  {[LayoutList, Kanban, Bell, Search, Users].map((Icon, i) => (
                    <div
                      className={cn(
                        "flex size-8 items-center justify-center rounded-md",
                        i === 0
                          ? "bg-[#174D38] text-white"
                          : "text-[#9ca3af] hover:bg-[#E8E8E8]",
                      )}
                      key={i}
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
                      <span className="font-semibold text-[#174D38]">
                        Backlog
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {["List", "Board", "Calendar"].map((v, i) => (
                        <span
                          className={cn(
                            "cursor-pointer rounded px-2.5 py-1 font-medium text-xs transition-colors",
                            i === 0
                              ? "bg-[#174D38] text-white"
                              : "text-[#6b7280] hover:bg-[#E8E8E8] hover:text-[#174D38]",
                          )}
                          key={v}
                        >
                          {v}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mb-3 flex items-center gap-2 border-b border-[#CBCBCB] pb-3">
                    {["Filter", "Group by: Status", "Sort"].map((label) => (
                      <span
                        className="rounded border border-dashed border-[#CBCBCB] px-2 py-1 text-[#9ca3af] text-xs"
                        key={label}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    {[
                      {
                        title: "Fix login redirect bug",
                        status: "In Progress",
                        statusCls: "bg-[#174D38]/10 text-[#174D38]",
                        priority: "High",
                        pCls: "bg-orange-50 text-orange-500",
                        assignee: "SC",
                      },
                      {
                        title: "Design onboarding flow",
                        status: "Review",
                        statusCls: "bg-amber-50 text-amber-600",
                        priority: "Medium",
                        pCls: "bg-yellow-50 text-yellow-600",
                        assignee: "MR",
                      },
                      {
                        title: "Write API documentation",
                        status: "Todo",
                        statusCls: "bg-[#E8E8E8] text-[#6b7280]",
                        priority: "Low",
                        pCls: "bg-blue-50 text-blue-500",
                        assignee: "PN",
                      },
                      {
                        title: "Set up CI/CD pipeline",
                        status: "Todo",
                        statusCls: "bg-[#E8E8E8] text-[#6b7280]",
                        priority: "Urgent",
                        pCls: "bg-red-50 text-red-500",
                        assignee: "SC",
                      },
                      {
                        title: "Implement search indexing",
                        status: "In Progress",
                        statusCls: "bg-[#174D38]/10 text-[#174D38]",
                        priority: "High",
                        pCls: "bg-orange-50 text-orange-500",
                        assignee: "MR",
                      },
                    ].map((t) => (
                      <div
                        className="flex items-center gap-3 rounded-md border border-[#CBCBCB] bg-white px-3 py-2 text-sm transition-colors hover:border-[#174D38]/40"
                        key={t.title}
                      >
                        <span className="size-4 shrink-0 rounded border-2 border-[#CBCBCB]" />
                        <span className="flex-1 truncate font-medium text-[#174D38] text-xs">
                          {t.title}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded px-2 py-0.5 text-2xs font-medium",
                            t.statusCls,
                          )}
                        >
                          {t.status}
                        </span>
                        <span
                          className={cn(
                            "hidden shrink-0 rounded px-2 py-0.5 text-2xs font-medium sm:inline-block",
                            t.pCls,
                          )}
                        >
                          {t.priority}
                        </span>
                        <Avatar className="size-5 shrink-0">
                          <AvatarFallback className="bg-[#4D1717]/25 text-[8px] text-[#174D38]">
                            {t.assignee}
                          </AvatarFallback>
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
    <div className="border-y border-[#CBCBCB] bg-[#F2F2F2] py-5">
      <div className="mx-auto max-w-6xl px-6">
        <Animate>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <p className="text-[#6b7280] text-sm">
              <span className="font-semibold text-[#174D38]">500+ teams</span>{" "}
              already managing their work with {PRODUCT_NAME}
            </p>
            <div className="flex items-center gap-6">
              {["Acme Co", "Flowboard", "Stackd", "Loopback", "Nexus"].map(
                (name) => (
                  <span
                    className="font-semibold text-[#CBCBCB] text-xs uppercase tracking-widest"
                    key={name}
                  >
                    {name}
                  </span>
                ),
              )}
            </div>
          </div>
        </Animate>
      </div>
    </div>
  );
}

const LINE_GRID =
  "linear-gradient(rgba(23,77,56,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(23,77,56,0.04) 1px, transparent 1px)";

function FeaturesSection() {
  const { ref, visible } = useInView();
  return (
    <section
      className="py-16 scroll-mt-14"
      id="features"
      style={{
        backgroundImage: LINE_GRID,
        backgroundSize: "40px 40px",
        backgroundColor: "#F2F2F2",
      }}
    >
      <div className="mx-auto max-w-6xl px-6">
        <Animate className="mb-14 text-center">
          <SectionLabel className="mb-4">Features</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#174D38]">
            Everything your team needs to ship
          </h2>
          <p className="mt-2 text-[#6b7280]">
            No bolt-ons. No plugins. Everything in the box.
          </p>
        </Animate>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" ref={ref}>
          {features.map(({ icon: Icon, title, description }, i) => (
            <div
              className={cn(
                "group cursor-default rounded-xl border border-[#CBCBCB] bg-white p-6 shadow-sm transition-all duration-300",
                "hover:-translate-y-0.5 hover:border-[#174D38]/40 hover:shadow-md",
                visible
                  ? "translate-y-0 opacity-100"
                  : "translate-y-4 opacity-0",
              )}
              key={title}
              style={{
                transitionDelay: visible ? `${i * 80}ms` : "0ms",
                transitionProperty:
                  "opacity, transform, box-shadow, border-color",
              }}
            >
              <div
                className="mb-4 flex size-10 items-center justify-center rounded-lg text-white"
                style={{
                  background: "linear-gradient(135deg, #174D38, #4D1717)",
                }}
              >
                <Icon className="size-5" />
              </div>
              <h3 className="mb-2 font-semibold text-[#174D38] text-base">
                {title}
              </h3>
              <p className="text-[#6b7280] text-sm leading-relaxed">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatsSection() {
  const { ref, visible } = useInView();
  const stats = [
    { value: "500+", label: "Teams onboard", icon: Users },
    { value: "2M+", label: "Tasks completed", icon: CheckCircle2 },
    { value: "99.9%", label: "Uptime guarantee", icon: TrendingUp },
    { value: "20 min", label: "Average setup time", icon: Clock },
  ];
  return (
    <section className="relative overflow-hidden py-16 text-white">
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, #174D38 0%, #174D38 55%, #4D1717 100%)",
        }}
      />
      <div className="pointer-events-none absolute -top-20 -left-24 size-72 rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-20 size-80 rounded-full bg-[#4D1717]/20 blur-3xl" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg width='20' height='20' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='1' cy='1' r='1' fill='white'/%3E%3C/svg%3E\")",
          backgroundSize: "20px 20px",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-6" ref={ref}>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map(({ value, label, icon: Icon }, i) => (
            <div
              className={cn(
                "flex flex-col items-center text-center transition-all duration-500 sm:items-start sm:text-left",
                visible
                  ? "translate-y-0 opacity-100"
                  : "translate-y-4 opacity-0",
              )}
              key={label}
              style={{ transitionDelay: visible ? `${i * 90}ms` : "0ms" }}
            >
              <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20 backdrop-blur-sm">
                <Icon className="size-4.5 text-white" />
              </div>
              <div className="text-4xl font-bold tracking-tight">{value}</div>
              <div className="mt-1 text-sm text-white/70">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const bentoCards = [
  {
    span: "lg:col-span-2",
    icon: Kanban,
    title: "A board that keeps up with you",
    description:
      "Drag cards across columns, reorder instantly, and watch status update in real time. No lag, no reloads — just flow.",
    accent: true,
  },
  {
    span: "",
    icon: ShieldCheck,
    title: "Permissions done right",
    description:
      "Workspace roles plus per-Space access. Invite guests to exactly what they need — nothing more.",
  },
  {
    span: "",
    icon: Zap,
    title: "Sprints with story points",
    description:
      "Plan, point, and close two-week cycles with an automatic burndown.",
  },
  {
    span: "lg:col-span-2",
    icon: Globe,
    title: "Everything, searchable in a keystroke",
    description:
      "Hit Ctrl+K to jump to any task, list, or person across every workspace. Filter, save, and share views in seconds.",
    accent: true,
  },
];

function BentoSection() {
  const { ref, visible } = useInView();
  return (
    <section className="bg-white pt-16 pb-8 scroll-mt-14" id="why">
      <div className="mx-auto max-w-6xl px-6">
        <Animate className="mb-14 text-center">
          <SectionLabel className="mb-4">Why teams switch</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#174D38]">
            Powerful where it counts, simple everywhere else
          </h2>
          <p className="mt-2 text-[#6b7280]">
            The depth of an enterprise tool with the calm of a product you
            actually enjoy.
          </p>
        </Animate>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" ref={ref}>
          {bentoCards.map((card, i) => {
            const Icon = card.icon;
            return (
              <div
                className={cn(
                  "group relative overflow-hidden rounded-2xl border p-6 transition-all duration-500",
                  card.span,
                  card.accent
                    ? "border-[#174D38]/20 bg-linear-to-br from-[#174D38]/10 to-[#4D1717]/10"
                    : "border-[#CBCBCB] bg-white shadow-sm",
                  "hover:-translate-y-0.5 hover:shadow-md hover:border-[#174D38]/40",
                  visible
                    ? "translate-y-0 opacity-100"
                    : "translate-y-4 opacity-0",
                )}
                key={card.title}
                style={{ transitionDelay: visible ? `${i * 90}ms` : "0ms" }}
              >
                {card.accent && (
                  <div className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-[#174D38]/20 blur-2xl transition-opacity group-hover:opacity-80" />
                )}
                <div className="relative">
                  <div
                    className="mb-4 flex size-10 items-center justify-center rounded-lg text-white shadow-sm"
                    style={{
                      background: "linear-gradient(135deg, #174D38, #4D1717)",
                    }}
                  >
                    <Icon className="size-5" />
                  </div>
                  <h3 className="mb-2 font-semibold text-[#174D38] text-base">
                    {card.title}
                  </h3>
                  <p className="max-w-md text-[#6b7280] text-sm leading-relaxed">
                    {card.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const { ref, visible } = useInView();
  return (
    <section className="bg-white pt-8 pb-16 scroll-mt-14" id="how-it-works">
      <div className="mx-auto max-w-6xl px-6">
        <Animate className="mb-14 text-center">
          <SectionLabel className="mb-4">How it works</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#174D38]">
            Up and running in minutes
          </h2>
          <p className="mt-2 text-[#6b7280]">
            No configuration required. Just sign in and start organising.
          </p>
        </Animate>
        <Animate className="mb-12 flex flex-col items-center gap-3" delay={100}>
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
            {["Workspace", "Space", "List", "Task"].map((label, i, arr) => (
              <React.Fragment key={label}>
                <span className="rounded-lg border border-[#CBCBCB] bg-[#F2F2F2] px-3 py-1.5 font-medium text-[#174D38]">
                  {label}
                </span>
                {i < arr.length - 1 && (
                  <ChevronRight className="size-4 text-[#9ca3af]" />
                )}
              </React.Fragment>
            ))}
          </div>
          <p className="text-[#9ca3af] text-xs">
            e.g. Acme Inc › Engineering › Backlog › Fix login bug
          </p>
        </Animate>
        <div
          className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-4"
          ref={ref}
        >
          <div className="pointer-events-none absolute top-10 right-[12.5%] left-[12.5%] hidden border-t-2 border-dashed border-[#174D38]/20 lg:block" />
          {steps.map((step, i) => (
            <div
              className={cn(
                "relative rounded-xl border border-[#CBCBCB] bg-white p-6 shadow-sm transition-all duration-500",
                visible
                  ? "translate-y-0 opacity-100"
                  : "translate-y-4 opacity-0",
              )}
              key={step.number}
              style={{
                transitionDelay: visible ? `${i * 120}ms` : "0ms",
                transitionProperty: "opacity, transform",
              }}
            >
              <div
                className="mb-3 select-none bg-clip-text text-5xl font-bold text-transparent"
                style={{
                  backgroundImage: "linear-gradient(135deg, #BFD0C7, #D6BABA)",
                }}
              >
                {step.number}
              </div>
              <h3 className="mb-2 font-semibold text-[#174D38] text-sm">
                {step.title}
              </h3>
              <p className="text-[#6b7280] text-sm leading-relaxed">
                {step.description}
              </p>
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
      className="py-16"
      style={{
        backgroundImage: LINE_GRID,
        backgroundSize: "40px 40px",
        backgroundColor: "#F2F2F2",
      }}
    >
      <div className="mx-auto max-w-6xl px-6">
        <Animate className="mb-10 text-center">
          <SectionLabel className="mb-4">Views</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#174D38]">
            See work your way
          </h2>
          <p className="mt-2 text-[#6b7280]">
            Switch views without leaving the page. Your filters carry across.
          </p>
        </Animate>
        <Animate delay={150}>
          <Tabs className="mx-auto max-w-3xl" defaultValue="list">
            <TabsList className="mb-6 grid w-full grid-cols-3 rounded-lg bg-[#E8E8E8] p-1">
              <TabsTrigger
                className="gap-1.5 rounded-md data-[state=active]:bg-[#174D38] data-[state=active]:text-white"
                value="list"
              >
                <LayoutList className="size-3.5" />
                List
              </TabsTrigger>
              <TabsTrigger
                className="gap-1.5 rounded-md data-[state=active]:bg-[#174D38] data-[state=active]:text-white"
                value="board"
              >
                <Kanban className="size-3.5" />
                Board
              </TabsTrigger>
              <TabsTrigger
                className="gap-1.5 rounded-md data-[state=active]:bg-[#174D38] data-[state=active]:text-white"
                value="mytasks"
              >
                <CalendarDays className="size-3.5" />
                My Tasks
              </TabsTrigger>
            </TabsList>
            <TabsContent
              className="animate-in fade-in-0 duration-200"
              value="list"
            >
              <Card className="rounded-xl border-[#CBCBCB] shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="font-semibold normal-case tracking-normal text-sm">
                    List View
                  </CardTitle>
                  <CardDescription>
                    Default view — see all tasks as rows with inline editing.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5">
                    {[
                      { t: "Fix authentication bug", done: true },
                      { t: "Design dashboard layout", done: true },
                      { t: "Write unit tests", done: false },
                      { t: "Deploy to staging", done: false },
                    ].map(({ t, done }) => (
                      <div
                        className={cn(
                          "flex items-center gap-3 rounded border px-3 py-2 text-sm",
                          done
                            ? "border-[#CBCBCB] bg-[#F2F2F2]"
                            : "border-[#174D38]/20 bg-[#174D38]/5",
                        )}
                        key={t}
                      >
                        <div
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded border-2",
                            done
                              ? "border-[#174D38] bg-[#174D38]"
                              : "border-[#CBCBCB]",
                          )}
                        >
                          {done && (
                            <Check
                              className="size-2.5 text-white"
                              strokeWidth={3}
                            />
                          )}
                        </div>
                        <span
                          className={cn(
                            "flex-1 text-xs",
                            done
                              ? "text-[#9ca3af] line-through"
                              : "text-[#174D38]",
                          )}
                        >
                          {t}
                        </span>
                        {done && (
                          <span className="text-2xs text-[#9ca3af]">
                            Completed
                          </span>
                        )}
                      </div>
                    ))}
                    <div className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[#9ca3af] text-xs">
                      <span className="text-base leading-none">+</span> Add task
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent
              className="animate-in fade-in-0 duration-200"
              value="board"
            >
              <Card className="rounded-xl border-[#CBCBCB] shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="font-semibold normal-case tracking-normal text-sm">
                    Board View
                  </CardTitle>
                  <CardDescription>
                    Kanban columns by status. Drag cards to change status.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      {
                        label: "Todo",
                        dot: "#9ca3af",
                        tasks: ["Write tests", "Update docs"],
                      },
                      {
                        label: "In Progress",
                        dot: "#174D38",
                        tasks: ["Fix auth bug", "Design layout"],
                      },
                      {
                        label: "Review",
                        dot: "#f59e0b",
                        tasks: ["API integration"],
                      },
                      {
                        label: "Done",
                        dot: "#10b981",
                        tasks: ["Deploy staging"],
                      },
                    ].map((col) => (
                      <div
                        className="rounded-md border border-[#CBCBCB] bg-[#F2F2F2] p-2"
                        key={col.label}
                      >
                        <div className="mb-2 flex items-center gap-1.5 px-1">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: col.dot }}
                          />
                          <p className="font-semibold text-[#6b7280] text-2xs">
                            {col.label}
                          </p>
                        </div>
                        {col.tasks.map((t) => (
                          <div
                            className="mb-1.5 rounded border border-[#CBCBCB] bg-white px-2.5 py-2 text-2xs text-[#174D38] shadow-sm transition-colors hover:border-[#174D38]/40"
                            key={t}
                          >
                            {t}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent
              className="animate-in fade-in-0 duration-200"
              value="mytasks"
            >
              <Card className="rounded-xl border-[#CBCBCB] shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="font-semibold normal-case tracking-normal text-sm">
                    My Tasks
                  </CardTitle>
                  <CardDescription>
                    All tasks assigned to you, across every project, grouped by
                    due date.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {[
                      {
                        group: "Overdue",
                        color: "#ef4444",
                        tasks: [
                          { t: "Update API docs", ctx: "Engineering › Docs" },
                        ],
                      },
                      {
                        group: "Due Today",
                        color: "#f59e0b",
                        tasks: [
                          { t: "Fix login bug", ctx: "Engineering › Backlog" },
                          { t: "Review PR #42", ctx: "Engineering › Sprint 3" },
                        ],
                      },
                      {
                        group: "This Week",
                        color: "#174D38",
                        tasks: [
                          {
                            t: "Write sprint retrospective",
                            ctx: "Engineering › Sprint 3",
                          },
                          { t: "Onboard new member", ctx: "HR › Onboarding" },
                        ],
                      },
                    ].map((g) => (
                      <div key={g.group}>
                        <p
                          className="mb-1.5 font-semibold text-xs"
                          style={{ color: g.color }}
                        >
                          {g.group}
                        </p>
                        {g.tasks.map(({ t, ctx }) => (
                          <div
                            className="mb-1 flex items-center gap-2 rounded border border-[#CBCBCB] bg-[#F2F2F2] px-3 py-2 text-xs"
                            key={t}
                          >
                            <span className="size-3.5 shrink-0 rounded border border-[#CBCBCB]" />
                            <span className="flex-1 text-[#174D38]">{t}</span>
                            <span className="text-[#9ca3af] text-2xs">
                              {ctx}
                            </span>
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

const comparisonFeatures = [
  {
    icon: AlertTriangle,
    title: "Eliminate Chaos",
    description:
      "No more scattered spreadsheets, overdue tasks, and missed deadlines.",
    color: "bg-red-100 text-red-600",
  },
  {
    icon: Sparkles,
    title: "95% On-Time Delivery",
    description:
      "Teams using Kanbanica complete 95% of tasks before their deadlines.",
    color: "bg-emerald-100 text-emerald-600",
  },
  {
    icon: BarChart3,
    title: "Real-Time Dashboards",
    description:
      "Track team productivity, sprint progress, and project health at a glance.",
    color: "bg-[#4D1717]/25 text-[#174D38]",
  },
  {
    icon: MessagesSquare,
    title: "Team Collaboration",
    description:
      "Built-in chat, comments, and activity feeds keep everyone in sync.",
    color: "bg-amber-100 text-amber-600",
  },
];

function BeforeAfterSection() {
  const [sliderPosition, setSliderPosition] = React.useState(50);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const beforeLabelRef = React.useRef<HTMLSpanElement>(null);
  const afterLabelRef = React.useRef<HTMLSpanElement>(null);
  const isDragging = React.useRef(false);

  const [containerWidth, setContainerWidth] = React.useState(0);
  const [beforeLabelWidth, setBeforeLabelWidth] = React.useState(80);
  const [afterLabelWidth, setAfterLabelWidth] = React.useState(80);

  const handleMove = React.useCallback((clientX: number) => {
    if (!containerRef.current) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(pct);
  }, []);

  const handleMouseDown = React.useCallback(() => {
    isDragging.current = true;
  }, []);

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) {
        return;
      }
      handleMove(e.clientX);
    };
    const handleMouseUp = () => {
      isDragging.current = false;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMove]);

  const handleTouchMove = React.useCallback(
    (e: React.TouchEvent) => {
      handleMove(e.touches[0].clientX);
    },
    [handleMove],
  );

  React.useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const updateWidths = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
      if (beforeLabelRef.current) {
        setBeforeLabelWidth(beforeLabelRef.current.offsetWidth);
      }
      if (afterLabelRef.current) {
        setAfterLabelWidth(afterLabelRef.current.offsetWidth);
      }
    };

    updateWidths();

    const observer = new ResizeObserver(() => {
      updateWidths();
    });
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  // Calculate opacities to prevent overlap
  let beforeOpacity = 1;
  let afterOpacity = 1;
  let dividerOpacity = 1;

  if (containerWidth > 0) {
    const dividerX = (sliderPosition / 100) * containerWidth;
    const leftThreshold = 12 + beforeLabelWidth;
    const rightThreshold = containerWidth - 12 - afterLabelWidth;
    const fadeDistance = 30;

    if (dividerX <= leftThreshold) {
      beforeOpacity = 0;
    } else if (dividerX < leftThreshold + fadeDistance) {
      beforeOpacity = (dividerX - leftThreshold) / fadeDistance;
    }

    if (dividerX >= rightThreshold) {
      afterOpacity = 0;
    } else if (dividerX > rightThreshold - fadeDistance) {
      afterOpacity = (rightThreshold - dividerX) / fadeDistance;
    }

    dividerOpacity = Math.min(beforeOpacity, afterOpacity);
  }

  return (
    <section className="bg-white py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 lg:grid-cols-5">
          {/* Left content */}
          <div className="lg:col-span-2">
            <Animate from="left">
              <SectionLabel className="mb-4">The Difference</SectionLabel>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#174D38]">
                From chaos to{" "}
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, #174D38, #4D1717)",
                  }}
                >
                  clarity
                </span>
              </h2>
              <p className="mt-3 text-[#6b7280] text-sm leading-relaxed">
                See the real difference {PRODUCT_NAME} makes. Drag the slider to
                compare a disorganised workspace with one powered by{" "}
                {PRODUCT_NAME}.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {comparisonFeatures.map((f) => {
                  const Icon = f.icon;
                  return (
                    <div className="flex gap-3" key={f.title}>
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-lg",
                          f.color,
                        )}
                      >
                        <Icon className="size-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-[#174D38] text-sm">
                          {f.title}
                        </p>
                        <p className="text-[#6b7280] text-xs leading-relaxed">
                          {f.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Animate>
          </div>

          {/* Right — Before/After Slider */}
          <Animate className="lg:col-span-3" from="right">
            <div
              className="relative cursor-ew-resize select-none overflow-hidden rounded-2xl border border-[#CBCBCB] shadow-xl"
              onMouseDown={handleMouseDown}
              onTouchMove={handleTouchMove}
              onTouchStart={(e) => handleMove(e.touches[0].clientX)}
              ref={containerRef}
            >
              {/* Before image (bottom layer, full) */}
              <Image
                alt="Before — chaotic workflow"
                className="block w-full"
                draggable={false}
                height={816}
                priority
                src="/before-image.png"
                width={1456}
              />

              {/* After image (top layer, clipped) */}
              <div
                className="absolute inset-0"
                style={{
                  clipPath: `polygon(${sliderPosition}% 0, 100% 0, 100% 100%, ${sliderPosition}% 100%)`,
                }}
              >
                <Image
                  alt="After — organized with Kanbanica"
                  className="block w-full"
                  draggable={false}
                  height={816}
                  priority
                  src="/after-image.png"
                  width={1456}
                />
              </div>

              {/* Floating labels */}
              <span
                className="absolute top-3 left-3 z-10 rounded-full bg-red-500 px-3 py-1 font-bold text-2xs text-white uppercase tracking-wider shadow-md pointer-events-none"
                ref={beforeLabelRef}
                style={{ opacity: beforeOpacity }}
              >
                Before
              </span>
              <span
                className="absolute top-3 right-3 z-10 rounded-full bg-emerald-500 px-3 py-1 font-bold text-2xs text-white uppercase tracking-wider shadow-md pointer-events-none"
                ref={afterLabelRef}
                style={{ opacity: afterOpacity }}
              >
                After
              </span>

              {/* Divider line */}
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-white"
                style={{
                  left: `${sliderPosition}%`,
                  transform: "translateX(-50%)",
                  opacity: dividerOpacity,
                }}
              />

              {/* Drag handle */}
              <div
                className="pointer-events-none absolute top-1/2 z-30 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white shadow-lg"
                style={{
                  left: `${sliderPosition}%`,
                  opacity: dividerOpacity,
                }}
              >
                <MoveHorizontal className="size-4 text-[#6b7280]" />
              </div>

              {/* Invisible range input for accessibility */}
              <input
                aria-label="Before and after comparison slider"
                className="absolute inset-0 z-40 h-full w-full cursor-ew-resize appearance-none opacity-0"
                max={100}
                min={0}
                onChange={(e) => setSliderPosition(Number(e.target.value))}
                type="range"
                value={sliderPosition}
              />
            </div>
          </Animate>
        </div>
      </div>
    </section>
  );
}

function TestimonialsSection() {
  const { ref, visible } = useInView();
  return (
    <section className="relative overflow-hidden bg-white py-16">
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#174D38]/10 opacity-60 blur-3xl" />
      <div className="relative mx-auto max-w-6xl px-6">
        <Animate className="mb-12 text-center">
          <SectionLabel className="mb-4">Testimonials</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#174D38]">
            Teams love it
          </h2>
        </Animate>
        <div className="grid gap-5 sm:grid-cols-3" ref={ref}>
          {testimonials.map((t, i) => (
            <div
              className={cn(
                "flex flex-col gap-4 rounded-xl border border-[#CBCBCB] bg-white p-6 shadow-sm transition-all duration-500",
                visible
                  ? "translate-y-0 opacity-100"
                  : "translate-y-4 opacity-0",
              )}
              key={t.name}
              style={{
                transitionDelay: visible ? `${i * 100}ms` : "0ms",
                transitionProperty: "opacity, transform",
              }}
            >
              <div className="flex gap-0.5">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Star
                    className="size-4 fill-amber-400 text-amber-400"
                    key={j}
                  />
                ))}
              </div>
              <p className="flex-1 text-[#174D38]/80 text-sm leading-relaxed">
                &ldquo;{t.body}&rdquo;
              </p>
              <div className="flex items-center gap-3 border-t border-[#CBCBCB] pt-4">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-[#4D1717]/25 text-[#174D38] text-xs">
                    {t.initials}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-[#174D38] text-sm">
                    {t.name}
                  </p>
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

function FaqItem({
  question,
  answer,
  isOpen,
  onToggle,
}: {
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-[#CBCBCB] last:border-b-0">
      <button
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-4 py-5 text-left transition-colors"
        onClick={onToggle}
        type="button"
      >
        <span
          className={cn(
            "font-semibold text-sm transition-colors duration-200",
            isOpen ? "text-[#174D38]" : "text-[#174D38]",
          )}
        >
          {question}
        </span>
        <div
          className={cn(
            "relative ml-6 h-5 w-5 shrink-0 transition-transform duration-300 ease-out",
            isOpen ? "rotate-45" : "rotate-0",
          )}
        >
          <span
            className={cn(
              "absolute top-1/2 left-0 h-0.5 w-full -translate-y-1/2 rounded-full transition-colors duration-300",
              isOpen ? "bg-[#174D38]" : "bg-[#6b7280]",
            )}
          />
          <span
            className={cn(
              "absolute top-0 left-1/2 h-full w-0.5 -translate-x-1/2 rounded-full transition-all duration-300",
              isOpen ? "bg-[#174D38]" : "bg-[#6b7280]",
            )}
          />
        </div>
      </button>
      <div
        className="grid transition-all duration-300 ease-out"
        style={{
          gridTemplateRows: isOpen ? "1fr" : "0fr",
          opacity: isOpen ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          <p className="pb-5 pr-10 text-[#6b7280] text-sm leading-relaxed">
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}

function FaqSection() {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);

  return (
    <section className="bg-[#F2F2F2] py-16 scroll-mt-14" id="faq">
      <div className="mx-auto max-w-2xl px-6">
        <Animate className="mb-12 text-center">
          <SectionLabel className="mb-4">FAQ</SectionLabel>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-[#174D38]">
            Common questions
          </h2>
          <p className="mt-2 text-[#6b7280]">
            {"Can't find an answer? "}
            <a
              className="text-[#174D38] underline-offset-2 hover:underline"
              href={`mailto:${SUPPORT_EMAIL}`}
            >
              Reach out to support
            </a>
          </p>
        </Animate>
        <Animate delay={100}>
          <div className="rounded-xl border border-[#CBCBCB] bg-white px-6 shadow-sm">
            {faqs.map((faq, i) => (
              <FaqItem
                answer={faq.a}
                isOpen={openIndex === i}
                key={i}
                onToggle={() => setOpenIndex(openIndex === i ? null : i)}
                question={faq.q}
              />
            ))}
          </div>
        </Animate>
      </div>
    </section>
  );
}

function CtaBanner() {
  return (
    <section className="bg-white py-16">
      <div className="mx-auto max-w-6xl px-6">
        <Animate>
          <div
            className="relative overflow-hidden rounded-2xl px-8 py-16 text-center text-white"
            style={{
              background:
                "linear-gradient(135deg, #174D38 0%, #174D38 50%, #174D38 100%)",
            }}
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
              <h2 className="mb-3 text-3xl font-bold">
                Ready to get your team organised?
              </h2>
              <p className="mb-8 text-lg text-white/75">
                Free for your whole team. Sign up in seconds — no credit card,
                no setup fees.
              </p>
              <Button
                asChild
                className="h-11 bg-white px-8 font-semibold text-base text-[#174D38] shadow-lg hover:bg-[#F2F2F2]"
                size="lg"
              >
                <Link href="/login">
                  Start for free <ArrowRight className="ml-1.5 size-4" />
                </Link>
              </Button>
              <p className="mt-4 text-sm text-white/50">
                Magic link sign-in · No passwords
              </p>
            </div>
          </div>
        </Animate>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[#CBCBCB] bg-[#F2F2F2]">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid gap-8 sm:grid-cols-4">
          <div className="sm:col-span-1">
            <span className="flex items-center gap-2 font-bold text-base text-[#174D38]">
              <Image
                alt={`${PRODUCT_NAME} Logo`}
                className="h-7 w-auto object-contain"
                height={28}
                src="/Kanbanica2.png"
                width={130}
              />
            </span>
            <p className="mt-2 text-[#6b7280] text-xs leading-relaxed">
              Free project management for modern teams. Workspaces, Spaces,
              Lists, and Tasks.
            </p>
          </div>
          <div>
            <p className="mb-3 font-semibold text-[#9ca3af] text-xs uppercase tracking-wide">
              Product
            </p>
            <ul className="space-y-2 text-[#6b7280] text-sm">
              <li>
                <a
                  className="transition-colors hover:text-[#174D38]"
                  href="#features"
                >
                  Features
                </a>
              </li>
              <li>
                <a
                  className="transition-colors hover:text-[#174D38]"
                  href="#why"
                >
                  Why us
                </a>
              </li>
              <li>
                <a
                  className="transition-colors hover:text-[#174D38]"
                  href="#how-it-works"
                >
                  How it works
                </a>
              </li>
              <li>
                <a
                  className="transition-colors hover:text-[#174D38]"
                  href="#faq"
                >
                  FAQ
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="mb-3 font-semibold text-[#9ca3af] text-xs uppercase tracking-wide">
              Get started
            </p>
            <ul className="space-y-2 text-[#6b7280] text-sm">
              <li>
                <Link
                  className="transition-colors hover:text-[#174D38]"
                  href="/login"
                >
                  Sign in
                </Link>
              </li>
              <li>
                <Link
                  className="transition-colors hover:text-[#174D38]"
                  href="/login"
                >
                  Create an account
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="mb-3 font-semibold text-[#9ca3af] text-xs uppercase tracking-wide">
              Company
            </p>
            <ul className="space-y-2 text-[#6b7280] text-sm">
              <li>
                <a
                  className="transition-colors hover:text-[#174D38]"
                  href="#faq"
                >
                  FAQ
                </a>
              </li>
              <li>
                <a
                  className="transition-colors hover:text-[#174D38]"
                  href={`mailto:${SUPPORT_EMAIL}`}
                >
                  Contact support
                </a>
              </li>
            </ul>
          </div>
        </div>
        <Separator className="my-8" />
        <div className="flex flex-col items-center justify-between gap-3 text-[#9ca3af] text-xs sm:flex-row">
          <p>
            &copy; {new Date().getFullYear()} {PRODUCT_NAME}. All rights
            reserved.
          </p>
          <p>Free for every team · Magic link sign-in</p>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-[#174D38]">
      <Navbar />
      <HeroSection />
      <SocialProofBar />
      <FeaturesSection />
      <BentoSection />
      <HowItWorksSection />
      <StatsSection />
      <ViewsShowcaseSection />
      <BeforeAfterSection />
      <TestimonialsSection />
      <FaqSection />
      <CtaBanner />
      <Footer />
    </div>
  );
}
