import {
  ArrowDown,
  ArrowRight,
  Check,
  X,
  FileSpreadsheet,
  MessageSquare,
  FileText,
  Printer,
  CreditCard,
  Users,
  ClipboardList,
  Trophy,
  ScanLine,
  Activity,
  Target,
  MonitorPlay,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// ─── shared primitives ────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#ff9933]">
      {children}
    </p>
  );
}

function Pullquote({ children, orange = false }: { children: React.ReactNode; orange?: boolean }) {
  return (
    <blockquote
      className={[
        "mx-auto max-w-3xl text-2xl font-black leading-snug tracking-tight sm:text-3xl lg:text-4xl",
        orange ? "text-[#ff9933]" : "text-[#101b35]",
      ].join(" ")}
    >
      {children}
    </blockquote>
  );
}

// ─── 1  HERO ─────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-[#101b35] pb-28 pt-32 text-white">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />
      <div className="pointer-events-none absolute -left-40 -top-20 h-[500px] w-[500px] rounded-full bg-[#ff9933]/8 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -right-40 h-[500px] w-[500px] rounded-full bg-white/4 blur-3xl" />

      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        {/* eyebrow */}
        <div className="mb-8 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/8 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-[#ff9933]" />
            Our Story
            <span className="h-1.5 w-1.5 rounded-full bg-[#138808]" />
          </div>
        </div>

        {/* H1 */}
        <h1 className="text-center text-4xl font-black leading-[1.06] tracking-tight sm:text-5xl lg:text-6xl">
          Built from the chaos<br className="hidden sm:block" /> behind real sports events.
        </h1>

        {/* opening */}
        <div className="mt-10 space-y-5 text-center text-lg leading-8 text-white/65 sm:text-xl">
          <p>
            We didn't build SportPass India because we thought the registration
            market needed another platform. We built it because we were the
            organizers.
          </p>
          <p>
            We'd spent weekends running sports and community events — races,
            tournaments, outdoor challenges. We knew what it felt like to have
            two hundred registrations come in and realize the real work hadn't
            even started yet.
          </p>
        </div>

        <p className="mt-12 text-center text-2xl font-black text-[#ff9933] sm:text-3xl">
          Registration is only the beginning.
        </p>

        {/* Hero CTAs */}
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button
            asChild
            size="lg"
            className="bg-primary font-bold text-primary-foreground hover:bg-primary/90"
          >
            <Link to="/organizers">Organize with SportPass</Link>
          </Button>
          <Link
            to="/"
            className="inline-flex h-11 items-center justify-center rounded-md border border-white/30 bg-transparent px-8 text-sm font-bold text-white transition-colors hover:bg-white/10"
          >
            Explore Events
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─── 2  THE PROBLEM ───────────────────────────────────────────────────────────

function TheProblem() {
  return (
    <section className="bg-slate-50 py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">

        {/* THE NIGHT BEFORE */}
        <Label>The Night Before</Label>
        <h2 className="max-w-2xl text-3xl font-black tracking-tight text-[#101b35] sm:text-4xl lg:text-5xl">
          It's 11 PM. The event is in nine hours.
        </h2>

        <div className="mt-8 space-y-5 text-lg leading-8 text-muted-foreground">
          <p>
            The registrations are done. The venue is sorted. But here you are,
            still at your desk, because the participant list for the timing team
            is different from the one for the check-in volunteers, which is
            different from the one you sent the T-shirt vendor, which is
            different from what the allocation spreadsheet says.
          </p>
          <p>
            You're copying rows between tabs. Someone messages asking if a late
            payment came through. You check the WhatsApp group. You update the
            sheet. You save a new version. You send it to three people. Someone
            replies asking which version is the right one.
          </p>
        </div>

        {/* scattered-tools visual */}
        <div className="my-10 flex flex-wrap justify-center gap-3">
          {[
            { icon: FileText, label: "Google Form" },
            { icon: MessageSquare, label: "WhatsApp" },
            { icon: CreditCard, label: "UPI Screenshots" },
            { icon: FileSpreadsheet, label: "Excel Sheet" },
            { icon: Printer, label: "Printed List" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-medium text-muted-foreground shadow-sm"
            >
              <Icon className="h-4 w-4 text-muted-foreground/50" />
              {label}
            </div>
          ))}
          <div className="flex w-full justify-center pt-1">
            <ArrowDown className="h-5 w-5 text-[#ff9933]/60" />
          </div>
          <div className="flex items-center gap-2 rounded-lg border-2 border-[#ff9933]/40 bg-white px-5 py-2.5 text-sm font-bold text-[#101b35] shadow-sm">
            One SportPass workspace
          </div>
        </div>

        {/* pull quote */}
        <div className="mt-12 border-l-4 border-[#ff9933] pl-8">
          <Pullquote>"The data existed. The system didn't."</Pullquote>
        </div>

        {/* EVENT DAY — compressed */}
        <div className="mt-16">
          <Label>Event Day</Label>
          <p className="text-lg font-black text-[#101b35] sm:text-xl">Then morning arrives. And so does everyone else.</p>
          <div className="mt-4 space-y-3 text-base leading-7 text-muted-foreground">
            <p>
              Three payments were confirmed this morning. Four people registered
              late. Someone changed their category. None of that is on the
              printed sheet.
            </p>
            <p>
              A volunteer is on the phone asking you. You're on WhatsApp with
              one hand and handing out bibs with the other.
            </p>
          </div>
          <div className="mt-6 space-y-2">
            {[
              "Is this participant registered? Was their payment confirmed?",
              "Which category are they in?",
              "Have they checked in? Have they received their kit?",
              "Who's still missing from the check-in list?",
            ].map((q) => (
              <div
                key={q}
                className="flex items-start gap-3 rounded-xl border bg-white px-5 py-3.5 text-sm leading-6 text-foreground shadow-sm"
              >
                <span className="mt-0.5 shrink-0 font-bold text-[#ff9933]">→</span>
                {q}
              </div>
            ))}
          </div>
        </div>

        {/* AFTER THE EVENT — compressed */}
        <div className="mt-16">
          <Label>After the Event</Label>
          <p className="text-4xl font-black text-[#ff9933] sm:text-5xl">Where are the results?</p>
          <div className="mt-5 space-y-3 text-base leading-7 text-muted-foreground">
            <p>
              Participants are standing around, phones out, looking for their
              time or score. Players want to know if they qualified for the next
              round.
            </p>
            <p>
              Results get shared hours later — sometimes the next day — via a
              screenshot in a WhatsApp group. Not because organizers don't care.
              Because results were never connected to anything.
            </p>
          </div>
        </div>

        {/* closing line — said exactly once */}
        <p className="mt-12 text-lg font-semibold text-[#101b35] sm:text-xl">
          Everything existed. Nothing was connected.
        </p>
      </div>
    </section>
  );
}

// ─── 3  THE ANSWER + MID-PAGE CTA ────────────────────────────────────────────

const WORKFLOW_STEPS = [
  { step: "Register",  description: "Sport-specific forms built around how each event actually works.", icon: ClipboardList },
  { step: "Collect",   description: "Payments, add-ons and requirements — linked to each registration.", icon: CreditCard },
  { step: "Organize",  description: "Participants, categories, teams and allocations in one place.", icon: Users },
  { step: "Operate",   description: "Check-ins, kit distribution and event-day coordination.", icon: ScanLine },
  { step: "Compete",   description: "Matches, checkpoints, timings and scores as the event runs.", icon: Activity },
  { step: "Publish",   description: "Results, rankings and brackets — ready when the event ends.", icon: Trophy },
];

function TheAnswer() {
  return (
    <section className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <Label>The Answer</Label>

        <h2 className="max-w-2xl text-3xl font-black tracking-tight text-[#101b35] sm:text-4xl lg:text-5xl">
          So we built SportPass India.
        </h2>

        <div className="mt-8 space-y-5 text-lg leading-8 text-muted-foreground">
          <p>
            Not to replace the registration form. Not to be another ticketing
            platform. But to build one connected workspace that covers the
            complete journey of a sports event — from the moment someone
            registers to the moment their result is published.
          </p>
          <p>
            Registration, payment, participant management, allocations,
            event-day operations, match tracking, results. Not separate tools.
            One system, where everything already knows about everything else.
          </p>
        </div>

        {/* six-step flow — desktop horizontal, mobile vertical */}
        <div className="mt-14">
          {/* desktop */}
          <div className="hidden items-start justify-center lg:flex">
            {WORKFLOW_STEPS.map(({ step, description, icon: Icon }, i) => (
              <div key={step} className="flex items-start">
                <div className="flex w-[140px] flex-col items-center gap-2.5 px-2 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#101b35] shadow-sm">
                    <Icon className="h-5 w-5 text-[#ff9933]" />
                  </div>
                  <p className="text-[11px] font-black uppercase tracking-widest text-[#101b35]">{step}</p>
                  <p className="text-[11px] leading-5 text-muted-foreground">{description}</p>
                </div>
                {i < WORKFLOW_STEPS.length - 1 && (
                  <ArrowRight className="mt-3.5 h-4 w-4 shrink-0 text-[#ff9933]/40" />
                )}
              </div>
            ))}
          </div>

          {/* mobile */}
          <div className="mx-auto flex max-w-sm flex-col lg:hidden">
            {WORKFLOW_STEPS.map(({ step, description, icon: Icon }, i) => (
              <div key={step} className="flex items-start gap-4">
                <div className="flex flex-col items-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#101b35] shadow-sm">
                    <Icon className="h-4 w-4 text-[#ff9933]" />
                  </div>
                  {i < WORKFLOW_STEPS.length - 1 && (
                    <div className="my-1 h-8 w-px bg-[#ff9933]/20" />
                  )}
                </div>
                <div className="pb-5 pt-1">
                  <p className="text-[11px] font-black uppercase tracking-widest text-[#101b35]">{step}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* punchline */}
        <div className="mt-14 border-t pt-10 text-center">
          <p className="text-2xl font-black text-[#101b35] sm:text-3xl">One event. One workspace.</p>
          <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-muted-foreground">
            Not a collection of tools. A connected system designed around
            how sports events actually run.
          </p>
        </div>

        {/* mid-page CTA */}
        <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button
            asChild
            size="lg"
            className="bg-primary font-bold text-primary-foreground hover:bg-primary/90"
          >
            <Link to="/organizers">Organize with SportPass</Link>
          </Button>
          <Link
            to="/"
            className="inline-flex h-11 items-center justify-center rounded-md border border-[#101b35]/40 bg-transparent px-8 text-sm font-bold text-[#101b35] transition-colors hover:bg-[#101b35]/5"
          >
            Explore Events
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─── 4  PRODUCT VISUALS ──────────────────────────────────────────────────────

function ProductVisuals() {
  const screens = [
    {
      label: "Organizer Dashboard",
      description: "Manage registrations, payments and participants from one view.",
      placeholder: "[SCREENSHOT: organizer-dashboard]",
    },
    {
      label: "QR Check-In Matrix",
      description: "Scan tickets and monitor every check-in station in real time.",
      placeholder: "[SCREENSHOT: qr-checkin-matrix]",
    },
    {
      label: "Live Results Page",
      description: "Scores, rankings and brackets — public the moment they're published.",
      placeholder: "[SCREENSHOT: live-results-page]",
    },
  ];

  return (
    <section className="bg-[#0b1428] py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <Label>See It in Action</Label>
        <h2 className="max-w-2xl text-3xl font-black tracking-tight text-white sm:text-4xl">
          The tools that replace the chaos.
        </h2>
        <p className="mt-4 max-w-xl text-base leading-7 text-white/55">
          Every view below is live and in use by organizers today.
        </p>

        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {screens.map(({ label, description, placeholder }) => (
            <div key={label} className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
              {/* screenshot slot */}
              <div
                className="flex h-48 items-center justify-center bg-white/5 text-center"
                aria-label={`Screenshot placeholder: ${label}`}
              >
                <div className="space-y-2 px-4">
                  <MonitorPlay className="mx-auto h-8 w-8 text-[#ff9933]/50" />
                  <p className="text-[10px] font-mono text-white/30">{placeholder}</p>
                </div>
              </div>
              <div className="p-4">
                <p className="text-sm font-bold text-white">{label}</p>
                <p className="mt-1 text-xs leading-5 text-white/50">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 5  BUILT FOR ANY SPORT ──────────────────────────────────────────────────

const SPORT_CARDS = [
  {
    title: "Running & Cycling",
    icon: Activity,
    features: [
      "Categories and race packages: set distances, ticket tiers, capacity, sale windows, forms and add-ons.",
      "UPI review and participant list: review payment references, approve entries, export data and add offline participants.",
      "QR check-in and checkpoints: scan confirmed tickets and monitor multiple stations from the check-in matrix.",
      "Bib allocation.",
      "Confirmation emails and email broadcast.",
    ],
  },
  {
    title: "Tennis, Badminton, Pickleball & More",
    icon: Target,
    features: [
      "Set up the tournament: configure categories, rounds, courts and scoring rules by event category.",
      "Singles and doubles draws: full match scheduling, court assignment and live scoring.",
      "Team competitions: support squad-based formats like the Thomas Cup style, across ties of singles and doubles matches.",
      "Named players per team match: pick exact players from every team's roster so results show real names.",
      "Score and publish results: enter game scores, record winners, track team standings and expose public results.",
    ],
  },
];

function BuiltForAnySport() {
  return (
    <section className="bg-slate-50 py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <Label>Built for Any Sport</Label>

        <h2 className="max-w-2xl text-3xl font-black tracking-tight text-[#101b35] sm:text-4xl lg:text-5xl">
          Every sport works differently.<br />The software should too.
        </h2>

        <div className="mt-6 max-w-2xl space-y-4 text-lg leading-8 text-muted-foreground">
          <p>
            A running event and a badminton tournament have almost nothing in
            common operationally. The categories work differently. The
            allocation logic is different. The event-day workflow is different.
            The results look completely different.
          </p>
          <p>
            SportPass doesn't force every event into a single generic template.
            It's designed to adapt — so the system reflects how the sport
            actually runs.
          </p>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {SPORT_CARDS.map(({ title, icon: Icon, features }) => (
            <Card key={title} className="border bg-white">
              <div className="flex items-center justify-between gap-2.5 border-b px-4 py-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#101b35]">
                    <Icon className="h-3.5 w-3.5 text-[#ff9933]" />
                  </div>
                  <p className="text-sm font-bold text-[#101b35]">{title}</p>
                </div>
                <span className="shrink-0 rounded-full bg-[#ff9933]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#ff9933]">
                  Live today
                </span>
              </div>
              <CardContent className="p-4">
                <ul className="space-y-3">
                  {features.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm leading-5 text-muted-foreground">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ff9933]" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="mt-10 text-base font-black tracking-wide text-[#101b35]">
          Built around the sport. Built for the organizer.
        </p>
      </div>
    </section>
  );
}

// ─── 6  BEFORE VS AFTER ──────────────────────────────────────────────────────

const COMPARISON = [
  { before: "Generic registration forms",           after: "Sport-specific registration" },
  { before: "Payment screenshots in chats",         after: "Payments reviewed and linked to registration" },
  { before: "Participant lists in spreadsheets",    after: "Central participant management" },
  { before: "Printed check-in sheets",              after: "Digital QR check-in" },
  { before: "Multiple disconnected vendor files",   after: "Structured, connected exports" },
];

function BeforeVsAfter() {
  return (
    <section className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <Label>The Difference</Label>
        <h2 className="max-w-xl text-3xl font-black tracking-tight text-[#101b35] sm:text-4xl">
          The same event. A completely different experience.
        </h2>
        <p className="mt-4 max-w-xl text-lg leading-7 text-muted-foreground">
          The operational overhead doesn't have to be part of running a sports
          event. It's a product problem. And product problems have solutions.
        </p>

        <div className="mt-10 overflow-hidden rounded-2xl border shadow-sm">
          <div className="grid grid-cols-2 bg-[#101b35] text-xs font-black uppercase tracking-widest">
            <div className="flex items-center gap-2 border-r border-white/10 px-5 py-4 text-white/50">
              <X className="h-3.5 w-3.5" /> Before
            </div>
            <div className="flex items-center gap-2 px-5 py-4 text-[#ff9933]">
              <Check className="h-3.5 w-3.5" /> With SportPass
            </div>
          </div>
          {COMPARISON.map(({ before, after }, i) => (
            <div
              key={before}
              className={`grid grid-cols-2 text-sm ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}
            >
              <div className="flex items-start gap-2.5 border-r px-5 py-4 text-muted-foreground">
                <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive/40" />
                {before}
              </div>
              <div className="flex items-start gap-2.5 px-5 py-4 font-medium text-[#101b35]">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#ff9933]" />
                {after}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 7  FINAL CTA BAND ───────────────────────────────────────────────────────

function FinalCTA() {
  return (
    <section className="bg-[#101b35] py-28 sm:py-36">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
        <div className="space-y-4">
          <p className="text-xl font-black text-white sm:text-2xl">Built from real event experience.</p>
          <p className="text-xl font-black text-white sm:text-2xl">Built for organizers.</p>
          <p className="text-xl font-black text-white sm:text-2xl">Built for Indian sports.</p>
        </div>

        <p className="mt-10 text-lg font-semibold italic text-[#ff9933]/80 sm:text-xl">
          "From registration to game day — and all the way to results."
        </p>

        <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button
            asChild
            size="lg"
            className="bg-primary font-bold text-primary-foreground hover:bg-primary/90"
          >
            <Link to="/organizers">Organize with SportPass</Link>
          </Button>
          <Link
            to="/"
            className="inline-flex h-11 items-center justify-center rounded-md border border-white/30 bg-transparent px-8 text-sm font-bold text-white transition-colors hover:bg-white/10"
          >
            Explore Events
          </Link>
          <Button
            asChild
            size="lg"
            variant="ghost"
            className="text-white/60 hover:bg-white/10 hover:text-white"
          >
            <a href="mailto:sportpassind@gmail.com">Contact us</a>
          </Button>
        </div>
      </div>
    </section>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

const OurStory = () => (
  <Layout>
    <Hero />
    <TheProblem />
    <TheAnswer />
    <ProductVisuals />
    <BuiltForAnySport />
    <BeforeVsAfter />
    <FinalCTA />
  </Layout>
);

export default OurStory;
