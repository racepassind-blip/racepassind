import {
  ArrowRight,
  ArrowDown,
  CheckCircle2,
  X,
  Check,
  FileSpreadsheet,
  MessageSquare,
  FileText,
  Printer,
  CreditCard,
  Users,
  ClipboardList,
  Trophy,
  ScanLine,
  Package,
  Clock,
  LayoutGrid,
  Layers,
  Target,
  MapPin,
  Calendar,
  Activity,
  BarChart3,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// ─── tiny helpers ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 text-xs font-bold uppercase tracking-[0.18em] text-[#ff9933]">
      {children}
    </p>
  );
}

function SectionHeading({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <h2 className={`text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl ${light ? "text-white" : "text-[#101b35]"}`}>
      {children}
    </h2>
  );
}

function SectionBody({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <p className={`mt-5 max-w-2xl text-base leading-7 sm:text-lg ${light ? "text-white/70" : "text-muted-foreground"}`}>
      {children}
    </p>
  );
}

// ─── section wrappers ────────────────────────────────────────────────────────

function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`py-20 sm:py-28 ${className}`}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">{children}</div>
    </section>
  );
}

// ─── 1 HERO ──────────────────────────────────────────────────────────────────

function Hero() {
  const scatteredTools = [
    { icon: FileText, label: "Forms" },
    { icon: MessageSquare, label: "Messages" },
    { icon: FileSpreadsheet, label: "Spreadsheets" },
    { icon: CreditCard, label: "Payments" },
    { icon: Printer, label: "Printed Lists" },
  ];

  return (
    <section className="relative isolate overflow-hidden bg-[#101b35] pb-24 pt-28 text-white">
      {/* Indian-flag accent stripe */}
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />
      {/* glow orbs */}
      <div className="pointer-events-none absolute -left-32 top-0 h-96 w-96 rounded-full bg-[#ff9933]/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 bottom-0 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-[#ff9933]" />
            Our Story
            <span className="h-1.5 w-1.5 rounded-full bg-[#138808]" />
          </div>

          <h1 className="text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Built from the chaos behind real sports events.
          </h1>

          <p className="mt-7 text-lg leading-8 text-white/70 sm:text-xl">
            SportPass India started from our own experience organizing sports and
            community events. Registrations were only the beginning. What came
            after usually meant spreadsheets, WhatsApp messages, payment
            screenshots, printed lists and a lot of manual coordination.
          </p>

          <p className="mt-6 text-xl font-bold text-[#ff9933] sm:text-2xl">
            "Registration is only the beginning."
          </p>
        </div>

        {/* scattered tools → SportPass visual */}
        <div className="mt-16 flex flex-col items-center gap-6 sm:flex-row sm:flex-wrap sm:justify-center">
          {scatteredTools.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/8 px-4 py-2.5 text-sm font-medium text-white/70 backdrop-blur-sm"
            >
              <Icon className="h-4 w-4 text-white/40" />
              {label}
            </div>
          ))}

          {/* arrow */}
          <div className="flex flex-col items-center sm:flex-row sm:items-center sm:gap-2">
            <ArrowDown className="h-5 w-5 text-[#ff9933] sm:hidden" />
            <ArrowRight className="hidden h-5 w-5 text-[#ff9933] sm:block" />
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-[#ff9933]/60 bg-[#ff9933]/10 px-5 py-3 text-sm font-black uppercase tracking-widest text-[#ff9933]">
            <Layers className="h-4 w-4" />
            SportPass
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── 2 ORGANIZER QUESTIONS ───────────────────────────────────────────────────

const QUESTIONS = [
  "Which category did this participant register for?",
  "What information do we need from each participant?",
  "How many meals or refreshments should we order?",
  "What size did they select for their event item?",
  "Has their payment been received and verified?",
  "Has their goodie kit or event pack been handed over?",
  "What number, court, group or team are they assigned to?",
  "Who has checked in and who hasn't?",
  "Is everyone working from the latest participant list?",
];

function OrganizerQuestions() {
  return (
    <Section className="bg-white">
      <div className="mx-auto max-w-3xl text-center">
        <SectionHeading>A ticket is simple. Running a sports event isn't.</SectionHeading>
        <SectionBody>
          Most registration platforms are designed to collect an entry. Sports
          organizers need answers to dozens of questions before, during and after
          the event.
        </SectionBody>
      </div>

      <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {QUESTIONS.map((q) => (
          <div
            key={q}
            className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4 text-sm leading-6 text-foreground"
          >
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#ff9933]/15 text-[10px] font-black text-[#ff9933]">
              ?
            </span>
            {q}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── 3 TOO MANY TOOLS ────────────────────────────────────────────────────────

const TOOL_FLOW = [
  { icon: FileText, label: "Registration Form" },
  { icon: CreditCard, label: "Payment Screenshots" },
  { icon: MessageSquare, label: "WhatsApp" },
  { icon: FileSpreadsheet, label: "Spreadsheet" },
  { icon: ClipboardList, label: "Allocation List" },
  { icon: Package, label: "Vendor File" },
  { icon: Printer, label: "Printed Sheets" },
];

function TooManyTools() {
  return (
    <Section className="bg-slate-50">
      <div className="mx-auto max-w-3xl text-center">
        <SectionHeading>One event. Too many tools.</SectionHeading>
        <SectionBody>
          We've spent the night before events allocating participants manually,
          updating sheets, preparing vendor files and printing separate lists for
          different teams.
        </SectionBody>
      </div>

      {/* horizontal flow → SportPass */}
      <div className="mt-14">
        {/* desktop: single row with arrows */}
        <div className="hidden items-center justify-center gap-1 lg:flex lg:flex-wrap lg:gap-2">
          {TOOL_FLOW.map(({ icon: Icon, label }, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-1.5 rounded-xl border bg-white p-3 shadow-sm">
                <Icon className="h-5 w-5 text-muted-foreground" />
                <span className="text-xs font-medium text-foreground">{label}</span>
              </div>
              {i < TOOL_FLOW.length - 1 && (
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />
              )}
            </div>
          ))}
          <ArrowRight className="h-5 w-5 shrink-0 text-[#ff9933]" />
          <div className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-[#ff9933]/50 bg-[#101b35] p-3 shadow-md">
            <Layers className="h-5 w-5 text-[#ff9933]" />
            <span className="text-xs font-black uppercase tracking-widest text-[#ff9933]">SportPass</span>
          </div>
        </div>

        {/* mobile/tablet: vertical list → SportPass */}
        <div className="flex flex-col items-center gap-2 lg:hidden">
          {TOOL_FLOW.map(({ icon: Icon, label }) => (
            <div key={label} className="flex w-full max-w-xs items-center gap-3 rounded-xl border bg-white p-3 shadow-sm">
              <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">{label}</span>
            </div>
          ))}
          <ArrowDown className="mt-1 h-5 w-5 text-[#ff9933]" />
          <div className="flex w-full max-w-xs items-center justify-center gap-2 rounded-xl border-2 border-[#ff9933]/50 bg-[#101b35] p-3">
            <Layers className="h-5 w-5 text-[#ff9933]" />
            <span className="text-sm font-black uppercase tracking-widest text-[#ff9933]">SportPass</span>
          </div>
        </div>

        {/* punchline */}
        <div className="mt-12 mx-auto max-w-xl rounded-2xl border-2 border-[#101b35]/10 bg-white p-8 text-center shadow-sm">
          <p className="text-muted-foreground">The information already existed. It was simply scattered everywhere.</p>
          <p className="mt-5 text-2xl font-black leading-snug text-[#101b35] sm:text-3xl">
            "The data existed.<br />The system didn't."
          </p>
        </div>
      </div>
    </Section>
  );
}

// ─── 4 NIGHT BEFORE ──────────────────────────────────────────────────────────

const NIGHT_BEFORE_ITEMS = [
  { icon: ClipboardList, label: "Participant allocation list" },
  { icon: LayoutGrid, label: "Category sheets" },
  { icon: Activity, label: "Timing / vendor exports" },
  { icon: Package, label: "Goodie distribution list" },
  { icon: CreditCard, label: "Payment verification sheet" },
  { icon: ScanLine, label: "Check-in list" },
  { icon: Users, label: "Volunteer / desk sheets" },
  { icon: Printer, label: "Printed handouts" },
];

function NightBefore() {
  return (
    <Section className="bg-white">
      <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
        <div>
          <SectionLabel>The Night Before</SectionLabel>
          <SectionHeading>
            The night before an event shouldn't look like this.
          </SectionHeading>
          <SectionBody>
            Once registrations close, organizers often spend hours manually
            assigning participants, reconciling information, preparing files for
            vendors and printing sheets for event-day teams.
          </SectionBody>
          <p className="mt-6 text-base font-semibold text-[#101b35] sm:text-lg">
            "The night before the event should be about the event — not spreadsheets."
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
          {NIGHT_BEFORE_ITEMS.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex flex-col items-center gap-2 rounded-xl border bg-muted/30 p-4 text-center"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/10">
                <Icon className="h-4 w-4 text-destructive/70" />
              </div>
              <span className="text-xs font-medium leading-snug text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ─── 5 EVENT DAY ─────────────────────────────────────────────────────────────

const EVENT_DAY_QUESTIONS = [
  { q: "Has this participant arrived?", icon: Users },
  { q: "Have they checked in?", icon: ScanLine },
  { q: "Have they received their event kit?", icon: Package },
  { q: "Which group or category are they in?", icon: LayoutGrid },
  { q: "Where should they go next?", icon: MapPin },
  { q: "What has already been completed?", icon: CheckCircle2 },
];

function EventDay() {
  return (
    <Section className="bg-slate-50">
      <div className="mx-auto max-w-3xl text-center">
        <SectionLabel>Event Day</SectionLabel>
        <SectionHeading>Then event day begins.</SectionHeading>
        <SectionBody>
          When information lives across multiple sheets and WhatsApp groups, even
          simple questions become difficult during a busy event.
        </SectionBody>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {EVENT_DAY_QUESTIONS.map(({ q, icon: Icon }) => (
          <div
            key={q}
            className="flex items-start gap-3 rounded-xl border bg-white p-5 shadow-sm"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#101b35]/8">
              <Icon className="h-4 w-4 text-[#101b35]" />
            </div>
            <p className="text-sm font-medium leading-6 text-foreground">{q}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── 6 RESULTS ───────────────────────────────────────────────────────────────

const RESULTS_QUESTIONS = [
  "Who won?",
  "What was my position?",
  "What was my time or score?",
  "Who qualified?",
  "What does the latest bracket look like?",
  "What are the final standings?",
];

function Results() {
  return (
    <section className="bg-[#101b35] py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.18em] text-[#ff9933]">
            After the Event
          </p>
          <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl lg:text-5xl">
            And when it ends, everyone asks the same question.
          </h2>
          <p className="mt-8 text-6xl font-black tracking-tight text-[#ff9933] sm:text-7xl lg:text-8xl">
            Where are the results?
          </p>
          <p className="mt-8 text-lg leading-7 text-white/70">
            Participants don't want to wait until tomorrow. Whether it's a race,
            tournament, cycling event, league, trek challenge or another
            competition — people want to know the outcome as soon as possible.
          </p>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RESULTS_QUESTIONS.map((q) => (
            <div
              key={q}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/6 p-4 text-sm font-medium text-white/80"
            >
              <Trophy className="h-4 w-4 shrink-0 text-[#ff9933]" />
              {q}
            </div>
          ))}
        </div>

        <p className="mx-auto mt-12 max-w-xl text-center text-base font-semibold text-white/90 sm:text-lg">
          "Results shouldn't be an afterthought. They're part of the event experience."
        </p>

        <div className="mt-4 text-center">
          <p className="text-sm text-white/50">
            Results · Scores · Timings · Rankings · Brackets · Standings
          </p>
        </div>
      </div>
    </section>
  );
}

// ─── 7 THE QUESTION ──────────────────────────────────────────────────────────

function TheQuestion() {
  return (
    <section className="bg-[#0b1428] py-20 sm:py-28">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
        <p className="mb-6 text-xs font-bold uppercase tracking-[0.18em] text-[#ff9933]">
          The Question That Started SportPass
        </p>
        <h2 className="text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
          "Why should organizing one sports event require so many different tools?"
        </h2>
        <p className="mt-8 text-lg leading-7 text-white/60">
          The information was already there. The problem was that it lived everywhere.
        </p>
        <div className="mt-10">
          <ArrowDown className="mx-auto h-6 w-6 animate-bounce text-[#ff9933]/60" />
        </div>
      </div>
    </section>
  );
}

// ─── 8 SO WE BUILT SPORTPASS ─────────────────────────────────────────────────

const WORKFLOW_STEPS = [
  {
    step: "REGISTER",
    description: "Sport-specific registration forms",
    icon: ClipboardList,
  },
  {
    step: "COLLECT",
    description: "Payments, add-ons and event requirements",
    icon: CreditCard,
  },
  {
    step: "ORGANIZE",
    description: "Participants, categories, teams and allocations",
    icon: Users,
  },
  {
    step: "OPERATE",
    description: "Check-ins, distributions and event-day workflows",
    icon: ScanLine,
  },
  {
    step: "COMPETE",
    description: "Matches, activities, checkpoints, scores or timings",
    icon: Activity,
  },
  {
    step: "PUBLISH",
    description: "Results, rankings, brackets and outcomes",
    icon: Trophy,
  },
];

function SoWeBuilt() {
  return (
    <Section className="bg-white">
      <div className="mx-auto max-w-3xl text-center">
        <SectionLabel>The Solution</SectionLabel>
        <SectionHeading>So we built SportPass India.</SectionHeading>
        <SectionBody>
          Not just another registration platform, but a system designed around
          the complete journey of a sports event.
        </SectionBody>
      </div>

      {/* workflow */}
      <div className="mt-14">
        {/* desktop: horizontal */}
        <div className="hidden items-start justify-center gap-0 lg:flex">
          {WORKFLOW_STEPS.map(({ step, description, icon: Icon }, i) => (
            <div key={step} className="flex items-start">
              <div className="flex flex-col items-center gap-2 px-3 text-center" style={{ minWidth: 130 }}>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#101b35] shadow">
                  <Icon className="h-5 w-5 text-[#ff9933]" />
                </div>
                <p className="text-xs font-black uppercase tracking-widest text-[#101b35]">{step}</p>
                <p className="text-xs leading-5 text-muted-foreground">{description}</p>
              </div>
              {i < WORKFLOW_STEPS.length - 1 && (
                <ArrowRight className="mt-4 h-5 w-5 shrink-0 text-[#ff9933]/50" />
              )}
            </div>
          ))}
        </div>

        {/* mobile: vertical timeline */}
        <div className="flex flex-col items-start gap-0 lg:hidden mx-auto max-w-sm">
          {WORKFLOW_STEPS.map(({ step, description, icon: Icon }, i) => (
            <div key={step} className="flex items-start gap-4">
              <div className="flex flex-col items-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#101b35] shadow">
                  <Icon className="h-4 w-4 text-[#ff9933]" />
                </div>
                {i < WORKFLOW_STEPS.length - 1 && (
                  <div className="my-1 h-8 w-px bg-[#ff9933]/25" />
                )}
              </div>
              <div className="pb-6 pt-1">
                <p className="text-xs font-black uppercase tracking-widest text-[#101b35]">{step}</p>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-14 mx-auto max-w-xl text-center">
        <p className="text-2xl font-black text-[#101b35] sm:text-3xl">
          One event. One workspace.
        </p>
        <p className="mt-4 text-base leading-7 text-muted-foreground">
          From the moment someone registers to the moment they check their
          result, SportPass is designed to keep the event connected.
        </p>
      </div>
    </Section>
  );
}

// ─── 9 EVERY SPORT ───────────────────────────────────────────────────────────

const SPORT_CARDS = [
  {
    title: "Running & Cycling",
    icon: Activity,
    items: [
      "Categories & distance tiers",
      "Participant allocations",
      "Bib / number assignment",
      "Check-in workflows",
      "Checkpoint tracking",
      "Timing & result workflows",
    ],
  },
  {
    title: "Badminton & Racket Sports",
    icon: Target,
    items: [
      "Singles & doubles entries",
      "Draws & seeding",
      "Court scheduling",
      "Match scoring",
      "Brackets & rounds",
      "Final results",
    ],
  },
  {
    title: "Trekking & Outdoor Events",
    icon: MapPin,
    items: [
      "Participant information",
      "Emergency contacts",
      "Meal & add-on preferences",
      "Groups & checkpoints",
      "Check-in at each point",
      "Completion tracking",
    ],
  },
  {
    title: "Other Sports",
    icon: LayoutGrid,
    items: [
      "Configurable registration forms",
      "Flexible categories",
      "Teams or individual entries",
      "Custom allocations",
      "Event-day workflows",
      "Results publication",
    ],
  },
];

function EverySport() {
  return (
    <Section className="bg-slate-50">
      <div className="mx-auto max-w-3xl text-center">
        <SectionHeading>Every sport works differently. The software should too.</SectionHeading>
        <SectionBody>
          SportPass doesn't force every event into a single generic workflow.
          The platform adapts to how each sport actually operates.
        </SectionBody>
      </div>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {SPORT_CARDS.map(({ title, icon: Icon, items }) => (
          <Card key={title} className="border bg-white">
            <div className="flex items-center gap-3 border-b px-5 py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#101b35]">
                <Icon className="h-4 w-4 text-[#ff9933]" />
              </div>
              <p className="text-sm font-bold leading-snug text-[#101b35]">{title}</p>
            </div>
            <CardContent className="p-5">
              <ul className="space-y-2">
                {items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ff9933]" />
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="mt-12 text-center text-base font-black tracking-wide text-[#101b35] sm:text-lg">
        Built around the sport. Built for the organizer.
      </p>
    </Section>
  );
}

// ─── 10 BEFORE VS SPORTPASS ──────────────────────────────────────────────────

const COMPARISON = [
  {
    before: "Generic registration forms",
    after: "Sport-specific registration",
  },
  {
    before: "Payment screenshots in chats",
    after: "Payment linked to registration",
  },
  {
    before: "Participant lists in spreadsheets",
    after: "Central participant management",
  },
  {
    before: "Allocations managed separately",
    after: "Allocations connected to entries",
  },
  {
    before: "Multiple vendor files",
    after: "Structured exports",
  },
  {
    before: "Printed check-in sheets",
    after: "Digital event-day workflows",
  },
  {
    before: "Different sources of truth",
    after: "One event workspace",
  },
  {
    before: "Results handled separately",
    after: "Results connected to the event",
  },
];

function BeforeVsAfter() {
  return (
    <Section className="bg-white">
      <div className="mx-auto max-w-3xl text-center">
        <SectionHeading>Before vs. SportPass</SectionHeading>
        <SectionBody>
          The same event information — organised differently.
        </SectionBody>
      </div>

      <div className="mt-12 mx-auto max-w-4xl overflow-hidden rounded-2xl border shadow-sm">
        {/* header row */}
        <div className="grid grid-cols-2 bg-[#101b35] text-center text-xs font-black uppercase tracking-widest">
          <div className="flex items-center justify-center gap-2 border-r border-white/10 px-5 py-4 text-white/60">
            <X className="h-4 w-4" /> Before
          </div>
          <div className="flex items-center justify-center gap-2 px-5 py-4 text-[#ff9933]">
            <Check className="h-4 w-4" /> With SportPass
          </div>
        </div>

        {COMPARISON.map(({ before, after }, i) => (
          <div
            key={before}
            className={`grid grid-cols-2 text-sm ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}
          >
            <div className="flex items-center gap-2.5 border-r px-5 py-4 text-muted-foreground">
              <X className="h-3.5 w-3.5 shrink-0 text-destructive/50" />
              {before}
            </div>
            <div className="flex items-center gap-2.5 px-5 py-4 font-medium text-[#101b35]">
              <Check className="h-3.5 w-3.5 shrink-0 text-[#ff9933]" />
              {after}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── 11 CLOSING CTA ──────────────────────────────────────────────────────────

function ClosingCTA() {
  return (
    <section className="bg-[#101b35] py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
        <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl lg:text-5xl">
          The night before an event shouldn't be spent managing spreadsheets.
        </h2>
        <p className="mt-5 text-lg font-medium text-[#ff9933] sm:text-xl">
          And the hour after it shouldn't be spent figuring out how to publish results.
        </p>
        <p className="mt-7 text-base leading-7 text-white/60 sm:text-lg">
          SportPass India is being built so organizers can spend less time
          managing tools and more time creating sports experiences people
          remember.
        </p>

        <div className="mt-10 space-y-3 text-sm font-bold uppercase tracking-widest text-white/50">
          <p className="text-white/80">Built from real event experience.</p>
          <p className="text-white/80">Built for organizers.</p>
          <p className="text-white/80">Built for Indian sports.</p>
        </div>

        <p className="mt-8 text-base font-semibold italic text-[#ff9933]/80">
          "From registration to game day — and all the way to results."
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button asChild size="lg" className="bg-[#ff9933] font-bold text-[#101b35] hover:bg-[#e8883a]">
            <Link to="/organizers">Organize with SportPass</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10">
            <Link to="/">Explore Events</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

const OurStory = () => {
  return (
    <Layout>
      <Hero />
      <OrganizerQuestions />
      <TooManyTools />
      <NightBefore />
      <EventDay />
      <Results />
      <TheQuestion />
      <SoWeBuilt />
      <EverySport />
      <BeforeVsAfter />
      <ClosingCTA />
    </Layout>
  );
};

export default OurStory;
