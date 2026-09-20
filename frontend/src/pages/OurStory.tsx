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
  Package,
  LayoutGrid,
  Layers,
  Target,
  MapPin,
  Activity,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// ─── shared primitives ────────────────────────────────────────────────────────

/** Orange eyebrow label */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#ff9933]">
      {children}
    </p>
  );
}

/** Centred narrative prose — wide measure, comfortable reading */
function Prose({ children, light = false, center = false }: { children: React.ReactNode; light?: boolean; center?: boolean }) {
  return (
    <p className={[
      "mx-auto max-w-2xl text-lg leading-8",
      light ? "text-white/65" : "text-muted-foreground",
      center ? "text-center" : "",
    ].join(" ")}>
      {children}
    </p>
  );
}

/** Large pullquote — the most important lines on the page */
function Pullquote({ children, orange = false }: { children: React.ReactNode; orange?: boolean }) {
  return (
    <blockquote className={[
      "mx-auto max-w-3xl text-2xl font-black leading-snug tracking-tight sm:text-3xl lg:text-4xl",
      orange ? "text-[#ff9933]" : "text-[#101b35]",
    ].join(" ")}>
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

        {/* headline */}
        <h1 className="text-center text-4xl font-black leading-[1.06] tracking-tight sm:text-5xl lg:text-6xl">
          Built from the chaos<br className="hidden sm:block" /> behind real sports events.
        </h1>

        {/* opening paragraph — the story starts here */}
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

        {/* first hook */}
        <p className="mt-12 text-center text-2xl font-black text-[#ff9933] sm:text-3xl">
          Registration is only the beginning.
        </p>
      </div>
    </section>
  );
}

// ─── 2  THE REAL PROBLEM ──────────────────────────────────────────────────────

function TheRealProblem() {
  return (
    <section className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl space-y-7 text-lg leading-8 text-muted-foreground">
          <p>
            Once registrations closed, we'd sit down and realise we were
            staring at a spreadsheet that didn't know about the payment
            screenshots in our WhatsApp. The payment screenshots didn't know
            about the allocation list we were building separately. The
            allocation list didn't know about the T-shirt sizes from the Google
            Form. And none of it was connected to the check-in sheet we'd print
            the night before.
          </p>
          <p>
            Every piece of information existed. A participant's name, their
            category, what they'd paid, what size they'd selected, which group
            they were in. It was all there — just scattered across four or five
            different places that had never been designed to talk to each other.
          </p>

          {/* visual break — the scattered tools */}
          <div className="my-10 flex flex-wrap justify-center gap-3">
            {[
              { icon: FileText, label: "Google Form" },
              { icon: MessageSquare, label: "WhatsApp" },
              { icon: CreditCard, label: "UPI Screenshots" },
              { icon: FileSpreadsheet, label: "Excel Sheet" },
              { icon: Printer, label: "Printed List" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2 rounded-lg border bg-slate-50 px-4 py-2 text-sm font-medium text-muted-foreground">
                <Icon className="h-4 w-4 text-muted-foreground/50" />
                {label}
              </div>
            ))}
          </div>

          <p>
            And so the week before every event, we'd reconcile it all by hand.
            Match payment references. Cross-check names. Update the master
            sheet. Reprint it. Update it again. Reprint it again.
          </p>
        </div>

        {/* section pullquote */}
        <div className="mt-16 border-l-4 border-[#ff9933] pl-8">
          <Pullquote>
            "The data existed.<br />The system didn't."
          </Pullquote>
        </div>
      </div>
    </section>
  );
}

// ─── 3  THE NIGHT BEFORE ─────────────────────────────────────────────────────

function NightBefore() {
  return (
    <section className="bg-slate-50 py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <Label>The Night Before</Label>

        <h2 className="max-w-2xl text-3xl font-black tracking-tight text-[#101b35] sm:text-4xl lg:text-5xl">
          It's 11 PM. The event is in nine hours.
        </h2>

        <div className="mt-8 space-y-6 text-lg leading-8 text-muted-foreground">
          <p>
            The registrations are done. The venue is sorted. But here you are,
            still at your desk, because the participant list for the timing team
            is different from the one for the check-in volunteers, which is
            different from the one you sent the T-shirt vendor, which is
            different from what the allocation spreadsheet says.
          </p>
          <p>
            You're copying rows between tabs. Someone messages asking if a
            late payment came through. You check the WhatsApp group. You update
            the sheet. You save a new version. You send it to three different
            people. Someone replies asking which version is the right one.
          </p>
          <p>
            This is not an unusual night before an event. For most organizers
            running events with real participants and real complexity, this is
            just what it looks like.
          </p>
        </div>

        {/* what the night looks like — subtle cards */}
        <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { icon: ClipboardList, label: "Allocation sheet — v7" },
            { icon: FileSpreadsheet, label: "Category list" },
            { icon: CreditCard, label: "Payments to verify" },
            { icon: Package, label: "Vendor file" },
            { icon: ScanLine, label: "Check-in sheet" },
            { icon: Printer, label: "Printed handouts" },
            { icon: Users, label: "Volunteer lists" },
            { icon: MessageSquare, label: "WhatsApp threads" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-start gap-2.5 rounded-xl border bg-white p-3.5">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-destructive/8">
                <Icon className="h-3.5 w-3.5 text-destructive/60" />
              </div>
              <span className="text-xs font-medium leading-snug text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>

        <p className="mt-10 max-w-xl text-lg font-semibold text-[#101b35]">
          The night before the event should be about the event — not spreadsheets.
        </p>
      </div>
    </section>
  );
}

// ─── 4  EVENT DAY ────────────────────────────────────────────────────────────

function EventDay() {
  return (
    <section className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <Label>Event Day</Label>

        <h2 className="max-w-2xl text-3xl font-black tracking-tight text-[#101b35] sm:text-4xl lg:text-5xl">
          Then morning arrives. And so does everyone else.
        </h2>

        <div className="mt-8 space-y-6 text-lg leading-8 text-muted-foreground">
          <p>
            Participants start arriving. The check-in desk has the printed list
            from last night. But three payments were confirmed this morning.
            Four people registered late. Someone changed their category. None of
            that is on the sheet.
          </p>
          <p>
            So a volunteer is on the phone asking you. You're checking WhatsApp
            with one hand and handing out bibs with the other. Someone from the
            timing team needs the latest category breakdown. Someone from the
            goodie kit station doesn't know which participants haven't collected
            yet.
          </p>
          <p>
            Everything is happening at once. The information exists — it just
            isn't accessible to the people who need it, when they need it.
          </p>
        </div>

        {/* questions that come up on event day */}
        <div className="mt-12 space-y-3">
          {[
            "Is this participant registered? Was their payment confirmed?",
            "Which category are they in?",
            "Have they checked in at the entry point?",
            "Have they received their event kit or goodie bag?",
            "Where are they supposed to go next?",
            "Who's still missing from the check-in list?",
          ].map((q) => (
            <div key={q} className="flex items-start gap-3 rounded-xl border bg-slate-50 px-5 py-4 text-sm leading-6 text-foreground">
              <span className="mt-0.5 shrink-0 text-[#ff9933] font-bold">→</span>
              {q}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 5  RESULTS ──────────────────────────────────────────────────────────────

function Results() {
  return (
    <section className="bg-[#101b35] py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <Label>After the Event</Label>

        <h2 className="max-w-2xl text-3xl font-black tracking-tight text-white sm:text-4xl lg:text-5xl">
          And then it ends. And immediately, everyone asks the same thing.
        </h2>

        <div className="mt-10 text-center">
          <p className="text-6xl font-black tracking-tight text-[#ff9933] sm:text-7xl lg:text-8xl">
            Where are<br className="sm:hidden" /> the results?
          </p>
        </div>

        <div className="mt-10 space-y-6 text-lg leading-8 text-white/65">
          <p>
            Participants are standing around or already in their cars, phones
            out, looking for their time or score. Parents want to know where
            their child finished. Players want to know if they qualified for
            the next round.
          </p>
          <p>
            The organizer is still collecting the timing data, reconciling the
            final list, trying to remember which Google Sheet has the most
            recent information. Results get shared hours later, sometimes the
            next day, via a screenshot in a WhatsApp group.
          </p>
          <p>
            It's not because organizers don't care. It's because results were
            never connected to anything. They lived in a separate system — or no
            system at all.
          </p>
        </div>

        <div className="mt-12 border-l-4 border-[#ff9933] pl-8">
          <blockquote className="text-xl font-semibold italic text-white/80 sm:text-2xl">
            "Results aren't an afterthought.<br />They're part of the event experience."
          </blockquote>
        </div>
      </div>
    </section>
  );
}

// ─── 6  THE QUESTION ─────────────────────────────────────────────────────────

function TheQuestion() {
  return (
    <section className="bg-[#0b1428] py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
        <Label>The Question That Started SportPass</Label>

        <h2 className="mx-auto max-w-3xl text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
          "Why does running one sports event require so many tools that have nothing to do with each other?"
        </h2>

        <div className="mt-10 space-y-5 text-lg leading-8 text-white/60">
          <p>
            We kept asking it. After every event. When we were exporting the
            fourth version of a spreadsheet. When we were reconciling payments
            at midnight. When someone asked for the results and we didn't have
            a clean answer.
          </p>
          <p>
            The information was there. The participants had registered. The
            payments had come in. The categories existed. The allocations got
            done — manually. The check-in happened — on paper. The results
            existed — somewhere.
          </p>
          <p className="font-semibold text-white/80">
            Everything existed. Nothing was connected.
          </p>
        </div>

        <div className="mt-14">
          <ArrowDown className="mx-auto h-7 w-7 animate-bounce text-[#ff9933]/50" />
        </div>
      </div>
    </section>
  );
}

// ─── 7  SO WE BUILT IT ───────────────────────────────────────────────────────

const WORKFLOW_STEPS = [
  { step: "Register", description: "Sport-specific forms built around how each event actually works.", icon: ClipboardList },
  { step: "Collect", description: "Payments, add-ons and requirements — linked to each registration.", icon: CreditCard },
  { step: "Organize", description: "Participants, categories, teams and allocations in one place.", icon: Users },
  { step: "Operate", description: "Check-ins, kit distribution and event-day coordination.", icon: ScanLine },
  { step: "Compete", description: "Matches, checkpoints, timings and scores as the event runs.", icon: Activity },
  { step: "Publish", description: "Results, rankings and brackets — ready when the event ends.", icon: Trophy },
];

function SoWeBuilt() {
  return (
    <section className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <Label>The Answer</Label>

        <h2 className="max-w-2xl text-3xl font-black tracking-tight text-[#101b35] sm:text-4xl lg:text-5xl">
          So we built SportPass India.
        </h2>

        <div className="mt-8 space-y-6 text-lg leading-8 text-muted-foreground">
          <p>
            Not to replace the registration form. Not to be another ticketing
            platform. But to build one connected workspace that covers the
            complete journey of a sports event — from the moment someone
            registers to the moment their result is published.
          </p>
          <p>
            Registration, payment, participant management, allocations,
            event-day operations, match or activity tracking, results. Not
            separate tools. One system, where everything already knows about
            everything else.
          </p>
        </div>

        {/* workflow — desktop horizontal, mobile vertical */}
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
      </div>
    </section>
  );
}

// ─── 8  EVERY SPORT ──────────────────────────────────────────────────────────

const SPORT_CARDS = [
  {
    title: "Running & Cycling",
    icon: Activity,
    items: ["Categories & distance tiers", "Bib / number allocation", "Checkpoint tracking", "Check-in workflows", "Timing & result export"],
  },
  {
    title: "Badminton & Racket Sports",
    icon: Target,
    items: ["Singles & doubles entries", "Court scheduling", "Match scoring", "Brackets & draws", "Final standings"],
  },
  {
    title: "Trekking & Outdoor Events",
    icon: MapPin,
    items: ["Emergency contact collection", "Meal preferences & add-ons", "Group & team allocation", "Checkpoint check-ins", "Completion tracking"],
  },
  {
    title: "Other Sports",
    icon: LayoutGrid,
    items: ["Configurable forms per sport", "Flexible categories", "Teams or individuals", "Custom allocations", "Event-day workflows"],
  },
];

function EverySport() {
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
            actually runs, not how a product team decided it should.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SPORT_CARDS.map(({ title, icon: Icon, items }) => (
            <Card key={title} className="border bg-white">
              <div className="flex items-center gap-2.5 border-b px-4 py-3.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#101b35]">
                  <Icon className="h-3.5 w-3.5 text-[#ff9933]" />
                </div>
                <p className="text-sm font-bold text-[#101b35]">{title}</p>
              </div>
              <CardContent className="p-4">
                <ul className="space-y-2">
                  {items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-[#ff9933]" />
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

// ─── 9  BEFORE VS AFTER ──────────────────────────────────────────────────────

const COMPARISON = [
  { before: "Generic registration forms", after: "Sport-specific registration" },
  { before: "Payment screenshots in chats", after: "Payment linked to the registration" },
  { before: "Participant lists in spreadsheets", after: "Central participant management" },
  { before: "Allocations managed separately", after: "Allocations connected to entries" },
  { before: "Multiple vendor files", after: "Structured, connected exports" },
  { before: "Printed check-in sheets", after: "Digital event-day workflows" },
  { before: "Different sources of truth", after: "One event workspace" },
  { before: "Results handled separately", after: "Results connected to the event" },
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
            <div key={before} className={`grid grid-cols-2 text-sm ${i % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
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

// ─── 10  CLOSING ─────────────────────────────────────────────────────────────

function Closing() {
  return (
    <section className="bg-[#101b35] py-28 sm:py-36">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
        {/* the story's conclusion */}
        <div className="space-y-5 text-lg leading-8 text-white/65">
          <p>
            We've been on both sides of this. We've been the organizers at
            midnight, still updating spreadsheets. We've been the participants
            sending a message the next day asking where the results are.
          </p>
          <p>
            That's why we built SportPass India — not as a product looking for a
            market, but as a solution to a problem we'd lived with ourselves.
          </p>
        </div>

        {/* three belief lines */}
        <div className="mt-14 space-y-4">
          <p className="text-xl font-black text-white sm:text-2xl">Built from real event experience.</p>
          <p className="text-xl font-black text-white sm:text-2xl">Built for organizers.</p>
          <p className="text-xl font-black text-white sm:text-2xl">Built for Indian sports.</p>
        </div>

        {/* final line */}
        <p className="mt-12 text-lg font-semibold italic text-[#ff9933]/80 sm:text-xl">
          "From registration to game day — and all the way to results."
        </p>

        {/* CTAs */}
        <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
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

const OurStory = () => (
  <Layout>
    <Hero />
    <TheRealProblem />
    <NightBefore />
    <EventDay />
    <Results />
    <TheQuestion />
    <SoWeBuilt />
    <EverySport />
    <BeforeVsAfter />
    <Closing />
  </Layout>
);

export default OurStory;
