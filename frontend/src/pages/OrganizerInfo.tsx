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
    summary: "Build the registration and race-day operations layer first. Timing and bib workflows are the next natural step.",
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
      { title: "Bib allocation", description: "Assign rider bibs and manage them from the event workflow.", icon: CreditCard },
      { title: "Manual result upload", description: "Bring finish results into the public event record after the ride.", icon: Upload },
    ],
  },
  badminton: {
    label: "Badminton tournaments",
    summary: "Badminton is the first sport with a live tournament console, from court setup to public results.",
    live: [
      { title: "Set up the tournament", description: "Configure categories, rounds, courts, and scoring rules by event category.", icon: Settings2 },
      { title: "Schedule matches", description: "Create matches, assign entries and courts, set times, and update match status.", icon: CalendarDays },
      { title: "Score and publish results", description: "Enter game scores, record winners, view brackets, and expose public results.", icon: Trophy },
    ],
    next: [
      { title: "More tournament templates", description: "Extend the tournament workflow beyond the current badminton implementation.", icon: ArrowRight },
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

const workflowSteps = [
  { number: "01", title: "Build", description: "Configure the event, products, participant questions, and payment instructions." },
  { number: "02", title: "Collect", description: "Share one public link and let participants submit structured entries." },
  { number: "03", title: "Verify", description: "Review UTR references, approve confirmed participants, and reconcile offline entries." },
  { number: "04", title: "Operate", description: "Open the console for check-in, checkpoints, dashboards, and sport-specific tools." },
];

function formatINR(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function formatRange(plan: PublicPlan) {
  return plan.maxConfirmedRegistrations === null ? `${plan.minConfirmedRegistrations}+ registrations` : `${plan.minConfirmedRegistrations}–${plan.maxConfirmedRegistrations} registrations`;
}

function formatRate(plan: PublicPlan) {
  if (plan.pricePaise === 0) return { amount: "Free", suffix: "forever" };
  return { amount: formatINR(plan.pricePaise), suffix: plan.billingUnit === "per_registration" ? "/ registration" : "/ event" };
}

function PlanCard({ plan }: { plan: PublicPlan }) {
  const rate = formatRate(plan);
  const featured = plan.code === "growth";
  return <Card className={`relative flex h-full flex-col overflow-hidden transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg ${featured ? "border-primary shadow-md ring-1 ring-primary/20" : "border-border/80"}`}>
    {featured && <Badge className="absolute right-5 top-5 bg-primary text-primary-foreground">Popular for growing events</Badge>}
    <CardHeader className="min-h-[185px] border-b bg-muted/20 pb-6"><div className="flex items-center gap-2"><CardTitle className="text-xl">{plan.name}</CardTitle>{plan.code === "community" && <Badge variant="secondary">Start here</Badge>}</div><CardDescription className="pt-1">{formatRange(plan)}</CardDescription><div className="mt-auto pt-7"><span className="text-4xl font-black tracking-tight">{rate.amount}</span><span className="ml-1 text-sm font-medium text-muted-foreground">{rate.suffix}</span></div></CardHeader>
    <CardContent className="flex flex-1 flex-col justify-between p-6"><ul className="space-y-3 text-sm text-muted-foreground"><li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> No monthly subscription</li><li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> Participant payments stay with you</li></ul>{plan.billingUnit === "per_registration" && <p className="mt-6 rounded-xl bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">For larger events, the fee scales with registrations: {formatINR(plan.pricePaise)} per registration.</p>}</CardContent>
  </Card>;
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
    <section className="relative isolate overflow-hidden bg-[#101b35] text-white"><div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" /><div className="absolute -right-32 top-0 -z-10 h-96 w-96 rounded-full bg-[#ff9933]/15 blur-3xl" /><div className="absolute -bottom-40 left-1/4 -z-10 h-96 w-96 rounded-full bg-[#138808]/15 blur-3xl" /><div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:py-24"><div><div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-bold uppercase tracking-[0.16em] backdrop-blur-sm"><Sparkles className="h-4 w-4 text-[#ff9933]" /> Built for the people behind the event</div><h1 className="max-w-3xl text-5xl font-black leading-[1.02] tracking-tight sm:text-6xl">Your event should feel like an event. Not a spreadsheet emergency.</h1><p className="mt-6 max-w-xl text-lg leading-8 text-white/75 sm:text-xl">SportPass turns the messy path from registration to event day into one visible operating flow—built around how Indian organizers actually work.</p><div className="mt-8 flex flex-wrap gap-3"><Button asChild size="lg" className="rounded-xl bg-[#ff9933] px-6 font-bold text-[#101b35] hover:bg-[#ffad5c]"><Link to="/signup?type=organizer">Build your first event <ArrowRight className="ml-2 h-4 w-4" /></Link></Button><Button asChild size="lg" variant="outline" className="rounded-xl border-white/30 bg-white/5 font-bold text-white hover:bg-white/15 hover:text-white"><a href="#sport-playbooks">Explore by sport</a></Button></div><div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/70"><span className="flex items-center gap-2"><IndianRupee className="h-4 w-4 text-[#ff9933]" /> Direct UPI payments</span><span className="flex items-center gap-2"><ScanLine className="h-4 w-4 text-[#138808]" /> QR check-in</span></div></div><div className="relative"><div className="mb-3 inline-flex w-fit items-center rounded-xl border border-red-300/20 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-100 shadow-lg">Before: “Who has actually paid?”</div><div className="rounded-3xl border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur-md sm:p-6"><div className="rounded-2xl bg-[#f7f8fb] p-4 text-slate-900 sm:p-5"><div className="flex items-center justify-between border-b pb-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Saturday · Event console</p><p className="mt-1 font-black">The messy middle, made visible</p></div><Badge className="bg-green-600 text-white">Live board</Badge></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border bg-white p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><ClipboardCheck className="h-3.5 w-3.5 text-primary" /> Registrations</div><p className="mt-2 text-2xl font-black">248</p><div className="mt-2 h-1.5 rounded-full bg-muted"><div className="h-full w-3/4 rounded-full bg-primary" /></div><p className="mt-1 text-[10px] text-muted-foreground">42 awaiting payment review</p></div><div className="rounded-xl border bg-white p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><ListChecks className="h-3.5 w-3.5 text-primary" /> Fulfilment counts</div><div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px]"><div className="rounded-lg bg-orange-50 p-2 text-orange-800"><p className="font-bold">Breakfast</p><p className="mt-1 text-lg font-black leading-none">180</p></div><div className="rounded-lg bg-blue-50 p-2 text-blue-800"><p className="font-bold">T-shirts · XL</p><p className="mt-1 text-lg font-black leading-none">48</p></div></div><p className="mt-2 text-[10px] text-muted-foreground">Ready for vendor planning</p></div></div><div className="mt-3 rounded-xl border bg-white p-3"><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-semibold"><QrCode className="h-3.5 w-3.5 text-green-600" /> Check-in checkpoints</div><span className="text-xs font-bold text-green-600">142 checked in</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px]"><div className="rounded-lg bg-green-50 p-2 text-green-700"><p className="font-bold">Start</p><p className="mt-1">82%</p></div><div className="rounded-lg bg-green-50 p-2 text-green-700"><p className="font-bold">Water</p><p className="mt-1">61%</p></div><div className="rounded-lg bg-amber-50 p-2 text-amber-700"><p className="font-bold">Finish</p><p className="mt-1">Pending</p></div></div></div></div></div><div className="absolute -bottom-5 -right-4 rounded-xl border border-green-300/20 bg-green-400/10 px-3 py-2 text-xs font-semibold text-green-100 shadow-lg">After: one event console</div></div></div>
    </section>

    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"><div className="grid gap-5 lg:grid-cols-2"><Card className="border-red-200 bg-red-50/60"><CardContent className="p-6 sm:p-8"><div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-red-700"><X className="h-4 w-4" /> The old Saturday</div><h2 className="mt-3 text-2xl font-black tracking-tight">The event is full. The information is everywhere.</h2><div className="mt-6 space-y-3">{["A form for entries", "Payment screenshots in WhatsApp", "A spreadsheet that is already out of date", "No clear count for breakfast, T-shirt sizes, or add-ons", "A separate list at the check-in desk"].map((item) => <div key={item} className="flex items-center gap-3 rounded-xl border border-red-200/70 bg-white/70 p-3 text-sm text-red-950"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-600">×</span>{item}</div>)}</div></CardContent></Card><Card className="border-green-200 bg-green-50/60"><CardContent className="p-6 sm:p-8"><div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-green-700"><CheckCircle2 className="h-4 w-4" /> The SportPass Saturday</div><h2 className="mt-3 text-2xl font-black tracking-tight">One event record from first entry to final scan.</h2><div className="mt-6 space-y-3">{["One public registration flow", "One UPI review queue", "One live participant record", "One QR and checkpoint workflow"].map((item) => <div key={item} className="flex items-center gap-3 rounded-xl border border-green-200/70 bg-white/70 p-3 text-sm text-green-950"><CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />{item}</div>)}</div></CardContent></Card></div></section>

    <section id="sport-playbooks" className="bg-muted/40"><div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"><div className="mx-auto max-w-3xl text-center"><p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Choose your sport</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">Same foundation. A smarter next layer for each sport.</h2><p className="mt-4 text-lg leading-7 text-muted-foreground">Every organizer gets the core event workflow. Select a sport to see what is live today and what SportPass is building next.</p></div><div className="mt-10 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Sport playbooks">{sportTabs.map((sport) => <button key={sport.key} type="button" role="tab" aria-selected={activeSport === sport.key} onClick={() => setActiveSport(sport.key)} className={`whitespace-nowrap rounded-full border px-4 py-2.5 text-sm font-bold transition-colors ${activeSport === sport.key ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>{sport.label}</button>)}</div><div className="mt-6 rounded-3xl border bg-card p-5 shadow-sm sm:p-8"><div className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between"><div><Badge variant="outline">{playbook.label}</Badge><h3 className="mt-3 text-2xl font-black">{activeSportLabel} organizer playbook</h3><p className="mt-2 max-w-2xl text-muted-foreground">{playbook.summary}</p></div><Button asChild variant="outline" className="w-fit gap-2"><Link to="/signup?type=organizer">Talk through your workflow <ArrowRight className="h-4 w-4" /></Link></Button></div><div className="mt-6 grid gap-8 lg:grid-cols-2"><div><div className="mb-3 flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-600" /><p className="text-sm font-bold uppercase tracking-[0.16em] text-green-700">Live today</p></div><div className="space-y-3">{playbook.live.map((feature) => <PlaybookFeature key={feature.title} feature={feature} state="live" />)}</div></div><div><div className="mb-3 flex items-center gap-2"><ArrowRight className="h-4 w-4 text-primary" /><p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Next for {activeSportLabel?.toLowerCase()}</p></div><div className="space-y-3">{playbook.next.map((feature) => <PlaybookFeature key={feature.title} feature={feature} state="next" />)}</div></div></div></div></div></section>

    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8"><div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-start"><div><p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">The operating loop</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Four decisions. One calmer event day.</h2><p className="mt-4 leading-7 text-muted-foreground">The product follows the questions every organizer has to answer: what are we selling, who has paid, who is confirmed, and who has arrived?</p></div><div className="grid gap-4 sm:grid-cols-2">{workflowSteps.map((step) => <div key={step.number} className="rounded-2xl border bg-card p-5"><p className="text-sm font-black text-primary">{step.number}</p><h3 className="mt-3 font-bold">{step.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p></div>)}</div></div></section>

    <section id="pricing" className="border-y bg-card"><div className="mx-auto max-w-[1500px] px-4 py-20 sm:px-6 lg:px-8"><div className="mx-auto mb-10 max-w-3xl text-center"><p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">SportPass pricing</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">Pay for the scale of your event.</h2><p className="mt-4 text-lg text-muted-foreground">No monthly subscription. Participant payments go directly to your UPI account; SportPass fees are event-based or based on confirmed registrations.</p><p className="mt-3 text-sm leading-6 text-muted-foreground">A paid registration counts after the form is complete and your team approves the payment. Free registrations count once confirmed; unfinished forms and pending payments do not count.</p></div>{plansError ? <Card className="mx-auto max-w-xl"><CardContent className="p-6 text-center text-sm text-muted-foreground">Pricing is temporarily unavailable. Please try again shortly.</CardContent></Card> : !plans ? <p className="py-10 text-center text-muted-foreground">Loading current pricing…</p> : <><div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{plans.plans.map((plan) => <PlanCard key={plan.id} plan={plan} />)}</div><div className="mt-8 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]"><Card className="border-primary/20 bg-primary/5"><CardContent className="p-6 sm:p-7"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.16em] text-primary"><WalletCards className="h-4 w-4" /> How payment works</div><p className="mt-3 text-2xl font-black tracking-tight">Your money comes straight to you.</p><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">No complex payment gateway setup. No T+2 settlement or waiting for a payout. Add your UPI ID, verify the payment, and confirm the registration.</p></div><Badge variant="secondary" className="w-fit shrink-0">Direct to your account</Badge></div><div className="mt-6 grid gap-3 md:grid-cols-3"><div className="rounded-2xl border bg-background p-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-black text-primary-foreground">1</span><p className="font-bold">Enter your UPI ID</p></div><p className="mt-3 text-sm leading-5 text-muted-foreground">Add the UPI ID where you want participants to pay when you set up the event.</p></div><div className="rounded-2xl border bg-background p-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-black text-primary-foreground">2</span><p className="font-bold">Get paid directly</p></div><p className="mt-3 text-sm leading-5 text-muted-foreground">Participants pay your UPI ID. The amount reaches your bank account directly—SportPass does not hold it.</p></div><div className="rounded-2xl border bg-background p-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-black text-primary-foreground">3</span><p className="font-bold">Verify and confirm</p></div><p className="mt-3 text-sm leading-5 text-muted-foreground">Check the amount and UTR or payment reference, then confirm the participant in your event console.</p></div></div><div className="mt-5 flex items-start gap-3 rounded-xl border border-primary/15 bg-background/70 p-4 text-sm text-muted-foreground"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /><p><span className="font-bold text-foreground">Simple by design:</span> no gateway onboarding, no payout reconciliation, and no waiting to access the money participants have paid you.</p></div><p className="mt-4 text-xs leading-5 text-muted-foreground">Your bank or UPI provider may require PAN, Aadhaar or other KYC documents. SportPass does not currently collect those in the organizer profile.</p></CardContent></Card>{plans.foundingProgram.enabled && <Card className="border-[#ff9933]/30 bg-[#fff8ef]"><CardContent className="p-6"><p className="text-sm font-bold uppercase tracking-[0.16em] text-[#b45c00]">Founding organizer program</p><p className="mt-3 text-xl font-black text-[#101b35]">Eligible organizers may get {plans.foundingProgram.freeRacesCount} event{plans.foundingProgram.freeRacesCount === 1 ? "" : "s"} waived.</p><p className="mt-2 text-sm leading-6 text-[#5d4a36]">Eligibility is organization-specific and shown as part of the current program.</p></CardContent></Card>}</div></>}</div></section>

    <section className="relative overflow-hidden bg-[#101b35] px-4 py-16 text-center text-white sm:px-6 lg:py-20"><div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" /><div className="relative mx-auto max-w-2xl"><LineChart className="mx-auto h-8 w-8 text-[#ff9933]" /><h2 className="mt-4 text-3xl font-black sm:text-4xl">Make the next event easier to run.</h2><p className="mt-4 text-white/70">Start with the workflow that matters most, then grow into the sport tools your team needs.</p><Button asChild size="lg" className="mt-7 rounded-xl bg-white font-bold text-[#101b35] hover:bg-white/90"><Link to="/signup?type=organizer">Start your organizer application <ArrowRight className="ml-2 h-4 w-4" /></Link></Button></div></section>
  </Layout>;
};

export default OrganizerInfo;
