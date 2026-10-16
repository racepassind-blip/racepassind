import { useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ListChecks,
  MapPin,
  Mail,
  QrCode,
  ScanLine,
  Settings2,
  Ticket,
  Trophy,
  Users,
  WalletCards,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createWhatsAppUrl, WHATSAPP_MESSAGES } from "@/lib/whatsapp";

type SportKey = "running" | "cycling" | "trekking" | "badminton" | "table-tennis" | "cricket" | "other-formats";

interface SportFeature {
  title: string;
  description: string;
  icon: typeof Settings2;
}

interface SportPlaybook {
  label: string;
  summary: string;
  features: SportFeature[];
}

const sportTabs: Array<{ key: SportKey; label: string }> = [
  { key: "running", label: "Running" },
  { key: "cycling", label: "Cycling" },
  { key: "trekking", label: "Trekking" },
  { key: "badminton", label: "Badminton" },
  { key: "table-tennis", label: "Table tennis" },
  { key: "cricket", label: "Cricket" },
  { key: "other-formats", label: "More formats" },
];

const sportPlaybooks: Record<SportKey, SportPlaybook> = {
  running: {
    label: "Road races and runs",
    summary: "Manage runners from distance selection and bib allocation through checkpoint scans and published finish times.",
    features: [
      { title: "Distances and entry tiers", description: "Set race distances, category capacity, ticket prices, and registration questions.", icon: Settings2 },
      { title: "Bib allocation", description: "Assign bib numbers and keep each number linked to a confirmed runner.", icon: Ticket },
      { title: "Checkpoint scans", description: "Scan QR tickets at event stations and review each runner’s check-in history.", icon: ScanLine },
      { title: "Timed results", description: "Record finish times and publish category rankings with calculated pace.", icon: Trophy },
    ],
  },
  cycling: {
    label: "Rides and cycling races",
    summary: "Set up ride distances, manage riders and bibs, and publish timed results with average speed.",
    features: [
      { title: "Ride distances", description: "Create distance-based categories with ticket tiers, capacity, and add-ons.", icon: Settings2 },
      { title: "Rider numbers", description: "Allocate bib numbers and export the confirmed rider list.", icon: ClipboardCheck },
      { title: "QR check-in", description: "Scan riders at configured checkpoints and see which stations they have passed.", icon: QrCode },
      { title: "Cycling results", description: "Enter finish times and publish category rankings with average speed.", icon: Trophy },
    ],
  },
  trekking: {
    label: "Trekking and outdoor experiences",
    summary: "Give trekkers one clear route, meeting details, waiver information, and a simple arrival process.",
    features: [
      { title: "One shared trek route", description: "Set the event route once, with ticket tiers and capacity for the trek.", icon: MapPin },
      { title: "Waiver acknowledgement", description: "Collect consent to the event’s safety and participation terms during registration.", icon: ClipboardCheck },
      { title: "Pickup and meeting points", description: "Publish where participants should gather before the trek begins.", icon: CalendarDays },
      { title: "QR check-in", description: "Scan tickets and track arrivals against the participant list.", icon: QrCode },
    ],
  },
  badminton: {
    label: "Badminton tournaments",
    summary: "Run singles, doubles, or team entries through rounds, courts, scoring, and approved public results.",
    features: [
      { title: "Singles, doubles, and teams", description: "Create individual and team categories with the right player rosters.", icon: Users },
      { title: "Rounds and courts", description: "Configure rounds, assign courts, and schedule matches.", icon: CalendarDays },
      { title: "Game scoring", description: "Enter game scores, choose the winner, and follow bracket progression.", icon: ListChecks },
      { title: "Public match results", description: "Review and approve completed matches before they appear on the results page.", icon: Trophy },
    ],
  },
  "table-tennis": {
    label: "Table tennis tournaments",
    summary: "Manage player entries, tournament rounds, game scores, and approved match results.",
    features: [
      { title: "Player categories", description: "Set entry categories, tickets, capacity, and participant details.", icon: Settings2 },
      { title: "Rounds and matches", description: "Organize tournament rounds, assign courts, and schedule players.", icon: CalendarDays },
      { title: "Game scoring", description: "Record game scores and select the match winner.", icon: ListChecks },
      { title: "Public match results", description: "Approve completed matches for the public results page.", icon: Trophy },
    ],
  },
  cricket: {
    label: "Cricket tournaments",
    summary: "Set tournament basics and manage team entries, match rounds, and event-day arrivals.",
    features: [
      { title: "Cricket event setup", description: "Choose league or knockout format, ball type, overs, and squad size.", icon: Settings2 },
      { title: "Team entries", description: "Collect team registrations and keep player details together.", icon: Users },
      { title: "Tournament schedule", description: "Set up rounds and matches in the organizer workspace.", icon: CalendarDays },
      { title: "Event-day check-in", description: "Use QR tickets and checkpoint scans to record arrivals.", icon: QrCode },
    ],
  },
  "other-formats": {
    label: "More event formats",
    summary: "Create triathlons, open-water swims, obstacle races, and walkathons with the shared event workflow.",
    features: [
      { title: "Categories and tickets", description: "Set entry options, capacity, prices, and registration questions.", icon: Settings2 },
      { title: "Participant records", description: "Review registrations, add offline entries, and export lists.", icon: Users },
      { title: "Waivers and pickup points", description: "Add event-level acknowledgements and meeting instructions when needed.", icon: ClipboardCheck },
      { title: "QR check-in", description: "Scan confirmed tickets at the event or configured checkpoints.", icon: QrCode },
    ],
  },
};

const journeySteps = [
  { icon: Settings2, title: "Create", description: "Build the event page, categories, tickets, forms, and payment instructions." },
  { icon: ClipboardCheck, title: "Confirm", description: "Review payments and keep every participant in one searchable record." },
  { icon: ScanLine, title: "Operate", description: "Run bib allocation, communications, QR check-in, and checkpoints." },
  { icon: Trophy, title: "Publish", description: "Share race rankings or tournament results by category." },
];

const coreFeatures = [
  { icon: Ticket, title: "One registration link", description: "Participants see the event, choose a category, pay, and submit their details in one flow." },
  { icon: WalletCards, title: "Choose one payment mode per event", description: "Use admin-enabled Direct UPI with SportPass Credits or admin-enabled Cashfree checkout, with the payment status attached to every registration." },
  { icon: ClipboardCheck, title: "Waivers and pickup points", description: "Collect event-specific acknowledgements and publish meeting or pickup instructions before participants arrive." },
  { icon: Users, title: "A usable participant list", description: "Search by name, phone, email, or registration number and export the exact view you need." },
  { icon: Mail, title: "Event communication", description: "Send confirmations and participant updates without maintaining separate contact lists." },
  { icon: QrCode, title: "Event-day tools", description: "Scan tickets, prevent duplicate check-ins, and follow participants across multiple checkpoints." },
  { icon: BarChart3, title: "Refunds, settlements, and audit history", description: "Keep refund decisions, manual transfers, Credits deductions, settlements, and admin actions traceable by event." },
  { icon: Trophy, title: "Results people can follow", description: "Publish category-specific race rankings or tournament outcomes on a clear public page." },
];

const OrganizerInfo = () => {
  const [activeSport, setActiveSport] = useState<SportKey>("running");
  const playbook = sportPlaybooks[activeSport];

  return (
    <Layout>
      <section className="relative isolate overflow-hidden bg-[#101b35] text-white">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />
        <div className="absolute -right-32 top-0 -z-10 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_0.9fr] lg:px-8 lg:py-24">
          <div>
            <Badge className="border-white/20 bg-white/10 text-white hover:bg-white/10"><Zap className="mr-1.5 h-3.5 w-3.5 text-[#ff9933]" /> Built for Indian sports events</Badge>
            <h1 className="mt-6 max-w-3xl text-4xl font-black leading-[1.04] tracking-tight sm:text-6xl">Run registrations, event day, and results from one place.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-white/75">SportPass gives organizers one working record for participants, payments, check-in, and sport-specific results. Your team sees what needs attention without reconciling forms, chats, and spreadsheets.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="font-bold"><Link to="/signup?type=organizer">Create organizer account <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
              <Button asChild size="lg" variant="outline" className="border-white/25 bg-white/5 font-bold text-white hover:bg-white/10 hover:text-white"><Link to="/signup?type=organizer">Sell your merchandise <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
              <Button asChild size="lg" variant="outline" className="border-white/25 bg-white/5 font-bold text-white hover:bg-white/10 hover:text-white"><a href={createWhatsAppUrl(WHATSAPP_MESSAGES.organizerInterest)} target="_blank" rel="noopener noreferrer">Talk to SportPass</a></Button>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70"><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Direct UPI or Cashfree</span><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Trekking-ready forms</span><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Event-wise audit trail</span></div>
          </div>

          <div className="rounded-3xl border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur-md sm:p-6">
            <div className="rounded-2xl bg-[#f7f8fb] p-5 text-slate-900 sm:p-6">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">One connected event record</p>
              <div className="mt-5 space-y-3">{journeySteps.map((step, index) => { const Icon = step.icon; return <div key={step.title} className="flex items-start gap-4 rounded-xl border bg-white p-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span><div><div className="flex items-center gap-2"><span className="text-xs font-black text-muted-foreground">0{index + 1}</span><p className="font-black">{step.title}</p></div><p className="mt-1 text-sm leading-5 text-slate-600">{step.description}</p></div></div>; })}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="max-w-3xl"><p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">What your team gets</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">The tools needed between opening registration and publishing results.</h2><p className="mt-4 text-lg leading-7 text-muted-foreground">Each tool uses the same participant and event data, so an approval, check-in, refund, or result does not need to be copied elsewhere.</p></div>
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{coreFeatures.map((feature) => { const Icon = feature.icon; return <Card key={feature.title}><CardContent className="p-6"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span><h3 className="mt-5 font-black">{feature.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.description}</p></CardContent></Card>; })}</div>
      </section>

      <section className="border-y bg-muted/40">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="max-w-3xl"><p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Built around the sport</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">See what you can run today.</h2><p className="mt-4 text-lg leading-7 text-muted-foreground">Start with one registration workspace, then use the event-day and results tools available for your sport. Advanced tools are available on paid events.</p></div>
          <div className="mt-8 flex gap-1 overflow-x-auto rounded-xl border bg-card p-1.5" role="tablist" aria-label="Sport capabilities">{sportTabs.map((sport) => <button key={sport.key} type="button" role="tab" aria-selected={activeSport === sport.key} onClick={() => setActiveSport(sport.key)} className={`whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-bold transition-colors ${activeSport === sport.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{sport.label}</button>)}</div>
          <div className="mt-5 overflow-hidden rounded-2xl border bg-card shadow-sm"><div className="border-b p-6 sm:p-8"><Badge variant="outline">{playbook.label}</Badge><h3 className="mt-3 text-2xl font-black">{sportTabs.find((sport) => sport.key === activeSport)?.label}</h3><p className="mt-2 max-w-3xl text-muted-foreground">{playbook.summary}</p></div><div className="grid gap-px bg-border md:grid-cols-2">{playbook.features.map((feature) => { const Icon = feature.icon; return <div key={feature.title} className="flex gap-4 bg-card p-6"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span><div><p className="font-black">{feature.title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{feature.description}</p></div></div>; })}</div></div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <Card className="overflow-hidden border-primary/20 bg-primary/5"><CardContent className="flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Race merchandise</p><h2 className="mt-2 text-3xl font-black tracking-tight">Sell jerseys, kits, and race-day essentials.</h2><p className="mt-3 max-w-2xl leading-7 text-muted-foreground">Create a branded storefront, manage product options and stock, collect UPI payments, and review every order from your organizer workspace.</p></div><Button asChild size="lg" className="shrink-0 font-bold"><Link to="/signup?type=organizer">Sell your merchandise <ArrowRight className="ml-2 h-4 w-4" /></Link></Button></CardContent></Card>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div><p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">SportPass Credits</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Prepaid and predictable.</h2><p className="mt-4 leading-7 text-muted-foreground">Top up Credits before confirming paid Direct UPI registrations. One Credit equals ₹1, and every balance change appears in your ledger.</p><div className="mt-6 flex flex-wrap gap-2"><Badge variant="secondary">No invoice after the event</Badge><Badge variant="secondary">No negative balance</Badge><Badge variant="secondary">Full transaction history</Badge></div></div>
          <Card className="overflow-hidden"><CardContent className="p-0"><div className="bg-[#101b35] p-6 text-white sm:p-8"><p className="text-sm font-bold uppercase tracking-[0.16em] text-white/60">Default SportPass fee</p><div className="mt-3 flex items-end gap-2"><span className="text-5xl font-black">4%</span><span className="pb-1 text-white/70">per paid registration</span></div></div><div className="grid gap-px bg-border sm:grid-cols-3"><div className="bg-card p-5"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Minimum</p><p className="mt-2 text-2xl font-black">₹20</p></div><div className="bg-card p-5"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Maximum</p><p className="mt-2 text-2xl font-black">₹60</p></div><div className="bg-card p-5"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Free registration</p><p className="mt-2 text-2xl font-black">₹0</p></div></div></CardContent></Card>
        </div>
      </section>

      <section className="relative overflow-hidden bg-[#101b35] px-4 py-16 text-white sm:px-6 lg:py-20">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />
        <div className="mx-auto flex max-w-5xl flex-col gap-7 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="text-3xl font-black tracking-tight sm:text-4xl">Ready to set up your event?</h2><p className="mt-3 max-w-2xl text-white/70">Create an organizer account to start. For associations, leagues, and custom workflows, talk to the SportPass team.</p></div><div className="flex shrink-0 flex-wrap gap-3"><Button asChild size="lg" className="font-bold"><Link to="/signup?type=organizer">Get started <ArrowRight className="ml-2 h-4 w-4" /></Link></Button><Button asChild size="lg" variant="outline" className="border-white/25 bg-white/5 font-bold text-white hover:bg-white/10 hover:text-white"><a href="mailto:sportpassind@gmail.com">sportpassind@gmail.com</a></Button></div></div>
      </section>
    </Layout>
  );
};

export default OrganizerInfo;
