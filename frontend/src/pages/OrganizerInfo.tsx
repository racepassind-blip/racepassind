import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  FileCheck2,
  IndianRupee,
  LineChart,
  ListChecks,
  MapPin,
  MessageSquare,
  QrCode,
  ScanLine,
  Settings2,
  Sparkles,
  Trophy,
  Upload,
  Users,
  WalletCards,
  X,
  ArrowUp,
  Zap,
  Users2,
  Mail,
  Ticket,
  BarChart4,
  AlertCircle,
  Lock,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/api";

type BillingUnit = "per_event" | "per_registration";
type SportKey = "running" | "cycling" | "badminton" | "tennis" | "table-tennis";

interface PublicPlan {
  id: string;
  code: string;
  name: string;
  minConfirmedRegistrations: number;
  maxConfirmedRegistrations: number | null;
  pricePaise: number;
  billingUnit: BillingUnit;
  currency: string;
}

interface PublicPlansResponse {
  plans: PublicPlan[];
  foundingProgram: {
    enabled: boolean;
    freeRacesCount: number;
    defaultDiscountPercent: number;
  };
}

interface SportFeature {
  title: string;
  description: string;
  icon: typeof Settings2;
}

interface SportPlaybook {
  label: string;
  summary: string;
  live: SportFeature[];
  next: SportFeature[];
}

const sportTabs: Array<{ key: SportKey; label: string }> = [
  { key: "running", label: "Running" },
  { key: "cycling", label: "Cycling" },
  { key: "badminton", label: "Badminton" },
  { key: "tennis", label: "Tennis" },
  { key: "table-tennis", label: "Table tennis" },
];

const sportPlaybooks: Record<SportKey, SportPlaybook> = {
  running: {
    label: "Road races",
    summary: "Build the registration and event-day operations layer first. Timing and bib workflows are the next natural step.",
    live: [
      { title: "Categories and race packages", description: "Set distances, ticket tiers, capacity, sale windows, forms, and add-ons.", icon: Settings2 },
      { title: "UPI review and participant list", description: "Review payment references, approve entries, export data, and add offline participants.", icon: WalletCards },
      { title: "QR check-in and checkpoints", description: "Scan confirmed tickets and monitor multiple stations from the check-in matrix.", icon: ScanLine },
    ],
    next: [
      { title: "Bib allocation", description: "Assign and manage bib numbers inside the event console.", icon: CreditCard },
      { title: "Manual result upload", description: "Upload or enter finish results after the event.", icon: Upload },
    ],
  },
  cycling: {
    label: "Cycling events",
    summary: "Run the same dependable registration, payment, participant, and check-in workflow for rides and cycling events.",
    live: [
      { title: "Categories and entry products", description: "Configure distances, categories, ticket tiers, inventory, and participant questions.", icon: Settings2 },
      { title: "Payment and registration control", description: "Keep direct UPI payments, UTR review, approvals, exports, and offline entries together.", icon: ClipboardCheck },
      { title: "Event-day check-in", description: "Use QR credentials, registration references, checkpoints, and duplicate-scan protection.", icon: QrCode },
    ],
    next: [
      { title: "Bib allocation for riders", description: "Assign rider bibs and manage them from the event workflow.", icon: CreditCard },
      { title: "Manual result upload", description: "Bring finish results into the public event record after the ride.", icon: Upload },
    ],
  },
  badminton: {
    label: "Badminton tournaments",
    summary: "Badminton has a live tournament console for both individual and team formats, from court setup to public results.",
    live: [
      { title: "Set up the tournament", description: "Configure categories, rounds, courts, and scoring rules by event category.", icon: Settings2 },
      { title: "Singles and doubles draws", description: "Run individual entry categories with full match scheduling, court assignment, and live scoring.", icon: CalendarDays },
      { title: "Team competitions", description: "Support squad-based formats like the Thomas Cup style, where two teams meet across a tie made up of several singles and doubles matches.", icon: Users },
      { title: "Named players per team match", description: "For each tie, pick the exact players from every team's roster for singles or doubles, so results show real player names, not just the team.", icon: ListChecks },
      { title: "Score and publish results", description: "Enter game scores, record winners, track team standings by points, and expose public results.", icon: Trophy },
    ],
    next: [
      { title: "More tournament templates", description: "Extend the tournament workflow with additional draw and league formats.", icon: ArrowRight },
      { title: "Faster draw operations", description: "Add deeper automation around seeding and progression as the console grows.", icon: Activity },
    ],
  },
  tennis: {
    label: "Tennis events",
    summary: "Use the full event registration and check-in workflow today; tennis tournament operations are clearly mapped for what comes next.",
    live: [
      { title: "Publish tennis categories", description: "Create event categories, ticket tiers, participant forms, add-ons, and public registration pages.", icon: Settings2 },
      { title: "Manage entries and payments", description: "Review UPI references, approve confirmed entries, export registrations, and add offline players.", icon: WalletCards },
      { title: "Check in participants", description: "Use QR tickets, registration references, and event checkpoints on the day.", icon: ScanLine },
    ],
    next: [
      { title: "Tournament setup", description: "Configure draws, rounds, courts, and tournament categories.", icon: Trophy },
      { title: "Schedule and update matches", description: "Schedule matches, enter manual results, and publish a tournament view.", icon: ListChecks },
    ],
  },
  "table-tennis": {
    label: "Table-tennis events",
    summary: "Start with reliable event operations today, then add a dedicated tournament layer for draws, matches, and results.",
    live: [
      { title: "Build your event page", description: "Set categories, ticket tiers, capacity, schedules, rules, forms, and add-ons.", icon: Settings2 },
      { title: "Keep registrations reconciled", description: "Review UPI payments, approve entries, export lists, and record offline participants.", icon: ClipboardCheck },
      { title: "Run event-day check-in", description: "Scan confirmed entries and monitor check-in checkpoints from one workspace.", icon: QrCode },
    ],
    next: [
      { title: "Tournament setup", description: "Configure categories, draws, rounds, and table assignments.", icon: Trophy },
      { title: "Manual match results", description: "Schedule matches, update results, and share the final tournament view.", icon: ListChecks },
    ],
  },
};

const eventJourneySteps = [
  { icon: ClipboardCheck, title: "Registration", caption: "Custom forms", color: "bg-blue-100 text-blue-700" },
  { icon: CreditCard, title: "Payments", caption: "UPI & verification", color: "bg-purple-100 text-purple-700" },
  { icon: Users2, title: "Participants", caption: "One source of truth", color: "bg-orange-100 text-orange-700" },
  { icon: Mail, title: "Communication", caption: "Email & updates", color: "bg-pink-100 text-pink-700" },
  { icon: Ticket, title: "Tickets", caption: "QR e-tickets", color: "bg-cyan-100 text-cyan-700" },
  { icon: QrCode, title: "Check-In", caption: "Scan on race day", color: "bg-green-100 text-green-700" },
  { icon: BarChart4, title: "Event Mgmt", caption: "Live dashboard", color: "bg-indigo-100 text-indigo-700" },
  { icon: Trophy, title: "Results", caption: "Standings & more", color: "bg-red-100 text-red-700" },
];

const organizerValuePoints = [
  {
    icon: ClipboardCheck,
    title: "One registration flow",
    description: "Share a single public link for entries. No forms scattered across email, WhatsApp, or Google Forms.",
  },
  {
    icon: CreditCard,
    title: "Payment verification in one place",
    description: "Review UPI references, approve entries, and reconcile payments. No payment screenshots in WhatsApp.",
  },
  {
    icon: Users,
    title: "One participant record",
    description: "All entries, confirmations, and participant data live in one place. Export anything, anytime.",
  },
  {
    icon: Mail,
    title: "Keep everyone informed",
    description: "Send event updates and confirmations without managing email lists or message threads.",
  },
  {
    icon: QrCode,
    title: "Event-day check-in",
    description: "Scan QR tickets, track check-ins across multiple stations, monitor participation in real time.",
  },
  {
    icon: BarChart4,
    title: "Organizer dashboard",
    description: "See registrations, payments, participant status, check-in counts, and add-ons at a glance.",
  },
];

const workflowSteps = [
  { number: "01", title: "Build", description: "Configure the event, products, participant questions, and payment instructions." },
  { number: "02", title: "Collect", description: "Share one public link and let participants submit structured entries." },
  { number: "03", title: "Verify", description: "Review UTR references, approve confirmed participants, and reconcile offline entries." },
  { number: "04", title: "Operate", description: "Open the console for check-in, checkpoints, dashboards, and sport-specific tools." },
];

function formatINR(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function PlaybookFeature({ feature, state }: { feature: SportFeature; state: "live" | "next" }) {
  const Icon = feature.icon;
  return <div className="flex items-start gap-3 rounded-xl border bg-background p-4"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${state === "live" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}><Icon className="h-4 w-4" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold">{feature.title}</p><Badge variant={state === "live" ? "default" : "outline"} className="text-[10px]">{state === "live" ? "Live today" : "Next"}</Badge></div><p className="mt-1 text-sm leading-5 text-muted-foreground">{feature.description}</p></div></div>;
}

const OrganizerInfo = () => {
  const [plans, setPlans] = useState<PublicPlansResponse | null>(null);
  const [plansError, setPlansError] = useState(false);
  const [activeSport, setActiveSport] = useState<SportKey>("running");
  const playbook = sportPlaybooks[activeSport];
  const activeSportLabel = sportTabs.find((sport) => sport.key === activeSport)?.label;

  useEffect(() => {
    void apiRequest<PublicPlansResponse>("/organizer-plans").then(setPlans).catch(() => setPlansError(true));
  }, []);

  return <Layout>
    {/* Hero Section */}
    <section className="relative isolate overflow-hidden bg-[#101b35] text-white">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />
      <div className="absolute -right-32 top-0 -z-10 h-96 w-96 rounded-full bg-[#ff9933]/15 blur-3xl" />
      <div className="absolute -bottom-40 left-1/4 -z-10 h-96 w-96 rounded-full bg-[#138808]/15 blur-3xl" />
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:py-24">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-bold uppercase tracking-[0.16em] backdrop-blur-sm">
            <Sparkles className="h-4 w-4 text-[#ff9933]" /> Built for all sports
          </div>
          <h1 className="max-w-3xl text-5xl font-black leading-[1.02] tracking-tight sm:text-6xl">
            Everything You Need to Run Your Sports Event
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-white/75 sm:text-xl">
            From registration to results, SportPass handles the complete sports event journey. Manage participants, collect payments, check in attendees, and more—all in one place.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="rounded-xl bg-[#ff9933] px-6 font-bold text-[#101b35] hover:bg-[#ffad5c]">
              <Link to="/signup?type=organizer">
                Create Your Event <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-xl border-white/30 bg-white/5 font-bold text-white hover:bg-white/15 hover:text-white">
              <a href="#pricing">Contact us for pricing</a>
            </Button>
          </div>
          <div className="mt-6">
            <a
              href="https://wa.me/917975374933?text=Hi%20SportPass%20%F0%9F%91%8B%0A%0AI%27m%20interested%20in%20using%20SportPass%20for%20my%20event."
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/10 px-6 py-3 text-sm font-bold text-white transition-all hover:bg-white/20 hover:border-white/40 focus:outline-none focus:ring-2 focus:ring-[#25D366] focus:ring-offset-2 focus:ring-offset-[#101b35]"
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#25D366] text-[10px] font-bold text-white">WA</span>
              Talk to us on WhatsApp
            </a>
          </div>
          <div className="mt-7 flex flex-col gap-2 text-xs text-white/70 sm:text-sm">
            <span className="flex items-center gap-2">
              <Check className="h-4 w-4 text-[#138808]" /> Contact us for pricing based on your event size and requirements
            </span>
          </div>
        </div>
        <div className="relative">
          <div className="mb-3 inline-flex w-fit items-center rounded-xl border border-green-300/20 bg-green-400/10 px-3 py-2 text-xs font-semibold text-green-100 shadow-lg">
            Complete event journey in one platform
          </div>
          <div className="rounded-3xl border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur-md sm:p-6">
            <div className="rounded-2xl bg-[#f7f8fb] p-4 text-slate-900 sm:p-5">
              <div className="flex items-start justify-between gap-4 border-b pb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Event Journey · SportPass Platform</p>
                  <p className="mt-1 font-black">Everything from registration to results</p>
                </div>
                <Badge className="bg-green-600 text-white shrink-0">Complete platform</Badge>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-4">
                {eventJourneySteps.map((step, idx) => {
                  const Icon = step.icon;
                  const isLast = idx === eventJourneySteps.length - 1;
                  return (
                    <div key={step.title} className="group relative flex flex-col items-center text-center">
                      {/* Connector line to the next step within a row of 4 (sm+ only) */}
                      {!isLast && (idx + 1) % 4 !== 0 && (
                        <span className="absolute left-1/2 top-6 hidden h-0.5 w-full -translate-y-1/2 bg-gradient-to-r from-slate-200 to-transparent sm:block" aria-hidden="true" />
                      )}
                      <div className="relative">
                        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${step.color} shadow-sm ring-1 ring-black/5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-[9px] font-black text-white">
                          {idx + 1}
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] font-bold leading-tight text-slate-900">{step.title}</p>
                      <p className="text-[9px] leading-tight text-slate-500">{step.caption}</p>
                    </div>
                  );
                })}
              </div>
              <div className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-slate-900/[0.03] py-2.5 text-[10px] font-semibold text-slate-600">
                <span className="flex items-center gap-1 text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> One connected workflow</span>
                <span className="text-slate-300">•</span>
                <span>Registration → Results, no spreadsheets</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    {/* Organizer Value Section */}
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mb-10 text-center">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Stop managing spreadsheets</p>
        <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">One event record. Everything in sync.</h2>
        <p className="mt-4 max-w-2xl mx-auto text-muted-foreground">
          Stop managing registrations across forms, spreadsheets, payment screenshots, and WhatsApp messages. SportPass keeps everything organized from the moment someone registers until after the event ends.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {organizerValuePoints.map((point) => {
          const Icon = point.icon;
          return (
            <Card key={point.title} className="flex flex-col">
              <CardContent className="p-6 flex flex-col flex-1">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="font-bold mb-2">{point.title}</h3>
                <p className="text-sm text-muted-foreground">{point.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>

    {/* Before/After Comparison */}
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="border-red-200 bg-red-50/60">
          <CardContent className="p-6 sm:p-8">
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-red-700">
              <X className="h-4 w-4" /> Without SportPass
            </div>
            <h2 className="mt-3 text-2xl font-black tracking-tight">Information scattered everywhere</h2>
            <div className="mt-6 space-y-3">
              {["Registration form on Google Forms", "Payment screenshots in WhatsApp", "Spreadsheet that is already out of date", "Unclear counts for add-ons and selections", "Manual checking participants at the event"].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-xl border border-red-200/70 bg-white/70 p-3 text-sm text-red-950">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-600">×</span>
                  {item}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50/60">
          <CardContent className="p-6 sm:p-8">
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-green-700">
              <CheckCircle2 className="h-4 w-4" /> With SportPass
            </div>
            <h2 className="mt-3 text-2xl font-black tracking-tight">One record from entry to completion</h2>
            <div className="mt-6 space-y-3">
              {["One public registration link", "Direct UPI payment tracking", "Live participant record with status", "Add-on and selection counts ready for planning", "QR check-in and real-time monitoring"].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-xl border border-green-200/70 bg-white/70 p-3 text-sm text-green-950">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                  {item}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>

    {/* Sport Playbooks Section */}
    <section id="sport-playbooks" className="bg-muted/40">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Choose your sport</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">Same foundation. A smarter next layer for each sport.</h2>
          <p className="mt-4 text-lg leading-7 text-muted-foreground">Every organizer gets the core event workflow. Select a sport to see what is live today and what SportPass is building next.</p>
        </div>
        <div className="mt-10 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Sport playbooks">
          {sportTabs.map((sport) => (
            <button
              key={sport.key}
              type="button"
              role="tab"
              aria-selected={activeSport === sport.key}
              onClick={() => setActiveSport(sport.key)}
              className={`whitespace-nowrap rounded-full border px-4 py-2.5 text-sm font-bold transition-colors ${
                activeSport === sport.key
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {sport.label}
            </button>
          ))}
        </div>
        <div className="mt-6 rounded-3xl border bg-card p-5 shadow-sm sm:p-8">
          <div className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Badge variant="outline">{playbook.label}</Badge>
              <h3 className="mt-3 text-2xl font-black">{activeSportLabel} organizer playbook</h3>
              <p className="mt-2 max-w-2xl text-muted-foreground">{playbook.summary}</p>
            </div>
            <Button asChild variant="outline" className="w-fit gap-2">
              <Link to="/signup?type=organizer">
                Talk through your workflow <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
          <div className="mt-6 grid gap-8 lg:grid-cols-2">
            <div>
              <div className="mb-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-green-700">Live today</p>
              </div>
              <div className="space-y-3">
                {playbook.live.map((feature) => (
                  <PlaybookFeature key={feature.title} feature={feature} state="live" />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-3 flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-primary" />
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Next for {activeSportLabel?.toLowerCase()}</p>
              </div>
              <div className="space-y-3">
                {playbook.next.map((feature) => (
                  <PlaybookFeature key={feature.title} feature={feature} state="next" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    {/* Operating Loop Section */}
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">The operating loop</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Four decisions. One calmer event day.</h2>
          <p className="mt-4 leading-7 text-muted-foreground">The product follows the questions every organizer has to answer: what are we selling, who has paid, who is confirmed, and who has arrived?</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {workflowSteps.map((step) => (
            <div key={step.number} className="rounded-2xl border bg-card p-5">
              <p className="text-sm font-black text-primary">{step.number}</p>
              <h3 className="mt-3 font-bold">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Pricing Section */}
    <section id="pricing" className="border-y bg-card">
      <div className="mx-auto max-w-[1500px] px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Simple pricing. Built for your event.</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Use SportPass for registrations, payments, RaceOps and sport-specific event management.</h2>
          <p className="mt-4 text-lg text-muted-foreground">Contact us for pricing based on your event size and requirements.</p>
          <div className="mt-8 rounded-xl border bg-muted/30 p-8">
            <p className="text-center text-sm font-semibold text-muted-foreground">Contact us at:</p>
            <a href="mailto:sportpassind@gmail.com" className="mx-auto mt-3 inline-block text-xl font-black text-primary hover:underline">
              sportpassind@gmail.com
            </a>
          </div>
        </div>
      </div>
    </section>

    {/* Large Events Section */}
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <Card className="border-2 border-primary/20">
        <CardContent className="p-8 sm:p-12">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-2xl font-black">Organizing a Larger Event?</h3>
              <p className="mt-3 text-muted-foreground max-w-2xl">Running a large tournament, race, league or multi-sport event? Talk to us about custom requirements and event support.</p>
            </div>
            <Button asChild className="w-fit shrink-0" variant="outline">
              <a href="mailto:sportpassind@gmail.com">Talk to SportPass</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>

    {/* Final CTA Section */}
    <section className="relative overflow-hidden bg-[#101b35] px-4 py-16 text-center text-white sm:px-6 lg:py-20">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />
      <div className="relative mx-auto max-w-2xl">
        <LineChart className="mx-auto h-8 w-8 text-[#ff9933]" />
        <h2 className="mt-4 text-3xl font-black sm:text-4xl">Make the next event easier to run.</h2>
        <p className="mt-4 text-white/70">Start with the workflow that matters most, then grow into the sport tools your team needs.</p>
        <Button asChild size="lg" className="mt-7 rounded-xl bg-white font-bold text-[#101b35] hover:bg-white/90">
          <Link to="/signup?type=organizer">
            Start your organizer application <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </section>
  </Layout>;
};

export default OrganizerInfo;
