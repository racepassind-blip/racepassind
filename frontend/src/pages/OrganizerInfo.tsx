import { useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CalendarPlus,
  Check,
  ClipboardCheck,
  ClipboardList,
  Handshake,
  IndianRupee,
  LineChart,
  ShieldCheck,
  Sparkles,
  Users,
  WalletCards,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/api";

type BillingUnit = "per_event" | "per_registration";

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

const features = [
  { icon: CalendarPlus, title: "Launch races faster", description: "Create events, distances, categories, ticket tiers, and race-day details in one place." },
  { icon: WalletCards, title: "UPI-first payment review", description: "Use your own UPI details for direct participant payments, then review UTR references and approve each payment." },
  { icon: ClipboardCheck, title: "Stay on top of registrations", description: "Review UTR references, approve payments, export your list, and manage check-in." },
  { icon: Users, title: "Build your community", description: "Give runners a clear registration experience before and after race day." },
  { icon: BarChart3, title: "See what is happening", description: "Track registrations, fill rate, and the activity that matters to your team." },
  { icon: Handshake, title: "India-first support", description: "RacePass is built around the needs of Indian clubs, organizers, and local communities." },
];

const registrationDetails = [
  { title: "Participant profile", description: "Collect full name, email or phone, date of birth, and gender for every registration." },
  { title: "Jersey and team details", description: "Capture jersey size, emergency contact, and optional team name for race-day planning." },
  { title: "Race packages", description: "Create categories and ticket tiers with their own names, prices, available places, and ₹0 free-registration options." },
];

const steps = [
  { number: "01", title: "Apply to join", description: "Tell us about your organization and the races you run." },
  { number: "02", title: "Set up your event", description: "Add your race details, ticket tiers, and UPI payment information when you have paid tiers." },
  { number: "03", title: "Share your race", description: "Publish your event and let participants register through RacePass." },
  { number: "04", title: "Grow with confidence", description: "Manage registrations, check-ins, and your post-race billing summary." },
];

function formatINR(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function formatRange(plan: PublicPlan) {
  return plan.maxConfirmedRegistrations === null
    ? `${plan.minConfirmedRegistrations}+ confirmed registrations`
    : `${plan.minConfirmedRegistrations}–${plan.maxConfirmedRegistrations} confirmed registrations`;
}

function formatRate(plan: PublicPlan) {
  if (plan.pricePaise === 0) return { amount: "Free", suffix: "forever" };
  return {
    amount: formatINR(plan.pricePaise),
    suffix: plan.billingUnit === "per_registration" ? "/ registration" : "/ event",
  };
}

function PlanCard({ plan }: { plan: PublicPlan }) {
  const rate = formatRate(plan);
  const featured = plan.code === "growth";

  return (
    <Card className={`relative flex h-full flex-col overflow-hidden transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg ${featured ? "border-primary shadow-md ring-1 ring-primary/20" : "border-border/80"}`}>
      {featured && <Badge className="absolute right-5 top-5 bg-primary text-primary-foreground">Popular for growing races</Badge>}
      <CardHeader className="min-h-[190px] border-b bg-muted/20 pb-6">
        <div className="flex items-center gap-2">
          <CardTitle className="text-xl">{plan.name}</CardTitle>
          {plan.code === "community" && <Badge variant="secondary">Start here</Badge>}
        </div>
        <CardDescription className="pt-1">{formatRange(plan)}</CardDescription>
        <div className="mt-auto pt-7">
          <span className="text-4xl font-black tracking-tight">{rate.amount}</span>
          <span className="ml-1 text-sm font-medium text-muted-foreground">{rate.suffix}</span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between p-6">
        <ul className="space-y-3 text-sm text-muted-foreground">
          <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> No monthly subscription</li>
          <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> Confirmed = completed form + payment approved</li>
          <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> Participant payments stay with you</li>
        </ul>
        {plan.billingUnit === "per_registration" && <p className="mt-6 rounded-xl bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">For large races, the fee scales with confirmed registrations: {formatINR(plan.pricePaise)} for each registration.</p>}
      </CardContent>
    </Card>
  );
}

const OrganizerInfo = () => {
  const [plans, setPlans] = useState<PublicPlansResponse | null>(null);
  const [plansError, setPlansError] = useState(false);

  useEffect(() => {
    void apiRequest<PublicPlansResponse>("/organizer-plans")
      .then(setPlans)
      .catch(() => setPlansError(true));
  }, []);

  return (
    <Layout>
      <section className="relative isolate overflow-hidden bg-[#101b35] text-white">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" />
        <div className="absolute -right-32 top-0 -z-10 h-96 w-96 rounded-full bg-[#ff9933]/15 blur-3xl" />
        <div className="absolute -bottom-40 left-1/4 -z-10 h-96 w-96 rounded-full bg-[#138808]/15 blur-3xl" />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-28">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-bold uppercase tracking-[0.16em] backdrop-blur-sm"><Sparkles className="h-4 w-4 text-[#ff9933]" /> For organizers, clubs & communities</div>
            <h1 className="max-w-3xl text-5xl font-black leading-[1.02] tracking-tight sm:text-6xl">Run the race. We&apos;ll handle the busywork.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-white/75 sm:text-xl">RacePass gives Indian organizers one calm place to publish events, manage registrations, and grow a stronger race community.</p>
            <div className="mt-8 flex flex-wrap gap-3"><Button asChild size="lg" className="rounded-xl bg-[#ff9933] px-6 font-bold text-[#101b35] hover:bg-[#ffad5c]"><Link to="/signup?type=organizer">Apply as an organizer <ArrowRight className="ml-2 h-4 w-4" /></Link></Button><Button asChild size="lg" variant="outline" className="rounded-xl border-white/30 bg-white/5 font-bold text-white hover:bg-white/15 hover:text-white"><a href="#pricing">See pricing</a></Button></div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-white/70"><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#ff9933]" /> Secure participant registration</span><span className="flex items-center gap-2"><IndianRupee className="h-4 w-4 text-[#138808]" /> INR-first pricing</span></div>
          </div>
          <div className="rounded-3xl border border-white/15 bg-white/10 p-6 shadow-2xl backdrop-blur-md sm:p-8"><p className="text-sm font-bold uppercase tracking-[0.18em] text-[#ffb866]">Why RacePass?</p><h2 className="mt-4 text-2xl font-black">A professional race experience without a complicated setup.</h2><div className="mt-7 space-y-4">{["Your event page and registration flow", "Your UPI details and payment review", "Your participant list and race check-in", "A clear, event-based RacePass fee model"].map((item) => <div key={item} className="flex items-start gap-3 border-t border-white/10 pt-4 text-sm text-white/80"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#138808]" />{item}</div>)}</div></div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8"><div className="mb-10 max-w-2xl"><p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Everything your team needs</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">More time for the start line.</h2><p className="mt-3 text-muted-foreground">RacePass brings the operational details together so you can focus on athletes, volunteers, and a great day out.</p></div><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{features.map(({ icon: Icon, title, description }) => <Card key={title} className="border-border/80 shadow-sm"><CardContent className="p-6"><div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10"><Icon className="h-5 w-5 text-primary" /></div><h3 className="font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p></CardContent></Card>)}</div></section>

      <section className="bg-muted/40"><div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-start lg:px-8"><div><p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Registration, your way</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Capture the details your race team needs.</h2><p className="mt-4 leading-7 text-muted-foreground">RacePass collects more than a name and payment reference. Participants can provide the standard information your team needs for communication, race-day preparation, and check-in.</p></div><div className="grid gap-4 sm:grid-cols-3">{registrationDetails.map(({ title, description }) => <Card key={title} className="border-border/80 bg-background shadow-sm"><CardContent className="p-5"><ClipboardList className="h-5 w-5 text-primary" /><h3 className="mt-4 font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p></CardContent></Card>)}</div><Card className="border-primary/20 bg-background shadow-none lg:col-span-2"><CardContent className="p-5"><p className="font-bold">About breakfast and extra race-day items</p><p className="mt-1 text-sm leading-6 text-muted-foreground">The current registration flow supports one selected ticket tier, including free ₹0 tiers, plus the standard participant details above. If your event needs breakfast selection, merchandise, or custom questions, mention them when you apply so we can understand your workflow before launch.</p></CardContent></Card></div></section>

      <section id="pricing" className="border-y bg-card"><div className="mx-auto max-w-[1500px] px-4 py-20 sm:px-6 lg:px-8"><div className="mx-auto mb-10 max-w-3xl text-center"><p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Race Pass India — Pricing</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">Simple, event-based pricing.</h2><p className="mt-4 text-lg text-muted-foreground">Pay for the scale of your race. No monthly subscription. No fee during participant checkout.</p><p className="mt-3 text-sm leading-6 text-muted-foreground">For pricing, a paid registration counts once the form is complete and your team has approved the payment. Free ₹0 registrations count once confirmed; unfinished forms and pending or unverified payments do not count.</p><p className="mt-3 text-sm leading-6 text-muted-foreground">Your event&apos;s registration money goes straight to you — we never touch it.</p></div>{plansError ? <Card className="mx-auto max-w-xl"><CardContent className="p-6 text-center text-sm text-muted-foreground">Pricing is temporarily unavailable. Please try again shortly.</CardContent></Card> : !plans ? <p className="py-10 text-center text-muted-foreground">Loading current pricing…</p> : <><div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{plans.plans.map((plan) => <PlanCard key={plan.id} plan={plan} />)}</div><div className="mt-8 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]"><Card className="border-primary/20 bg-primary/5"><CardContent className="p-6"><div className="flex items-start gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><WalletCards className="h-5 w-5" /></div><div><p className="text-lg font-black">UPI-only payments for now.</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Participants pay you directly through the UPI ID you provide. They submit a UTR or payment reference, and your team reviews and approves it before the registration is counted.</p><p className="mt-3 text-xs leading-5 text-muted-foreground">Your bank or UPI provider may require PAN, Aadhaar or another government ID, and bank details for its KYC process. Keep those documents with your provider; RacePass does not currently collect them in the organizer profile.</p></div></div></CardContent></Card>{plans.foundingProgram.enabled && <Card className="border-[#ff9933]/30 bg-[#fff8ef]"><CardContent className="p-6"><p className="text-sm font-bold uppercase tracking-[0.16em] text-[#b45c00]">Founding Organizer Program</p><p className="mt-3 text-xl font-black text-[#101b35]">Your first event is free, no matter the size.</p><p className="mt-2 text-sm leading-6 text-[#5d4a36]">We&apos;re building this with you. Eligible founding organizers get their first event fully waived.</p></CardContent></Card>}</div></>}</div></section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8"><div className="grid gap-5 md:grid-cols-3"><Card className="border-border/80"><CardContent className="p-6"><p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">For Participants</p><h2 className="mt-3 text-2xl font-black">Just a registration form.</h2><p className="mt-3 leading-7 text-muted-foreground">Pay the event fee your organizer sets — nothing extra from us, ever.</p></CardContent></Card><Card className="border-border/80"><CardContent className="p-6"><p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">For Organizers</p><h2 className="mt-3 text-2xl font-black">Less chaos on race day.</h2><p className="mt-3 leading-7 text-muted-foreground">Replace Google Forms, WhatsApp chaos, and spreadsheet bib lists with one toolkit. Your money settles directly to your own account.</p></CardContent></Card><Card className="border-border/80 bg-[#101b35] text-white"><CardContent className="p-6"><p className="text-sm font-bold uppercase tracking-[0.16em] text-[#ffb866]">For Us</p><h2 className="mt-3 text-2xl font-black">Built by people who run races.</h2><p className="mt-3 leading-7 text-white/70">We know what breaks on race day — and we&apos;re fixing it.</p></CardContent></Card></div></section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8"><div className="mx-auto mb-10 max-w-2xl text-center"><p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">How onboarding works</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">From application to race day.</h2></div><div className="grid gap-6 md:grid-cols-4">{steps.map((step) => <div key={step.number} className="relative border-t-2 border-primary/20 pt-5"><p className="text-sm font-black text-primary">{step.number}</p><h3 className="mt-3 font-bold">{step.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p></div>)}</div></section>

      <section className="relative overflow-hidden bg-[#101b35] px-4 py-16 text-center text-white sm:px-6 lg:py-20"><div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808]" /><div className="relative mx-auto max-w-2xl"><LineChart className="mx-auto h-8 w-8 text-[#ff9933]" /><h2 className="mt-4 text-3xl font-black sm:text-4xl">Ready to bring your next race online?</h2><p className="mt-4 text-white/70">Apply today. Once approved, your organizer dashboard and pricing view are ready to go.</p><Button asChild size="lg" className="mt-7 rounded-xl bg-white font-bold text-[#101b35] hover:bg-white/90"><Link to="/signup?type=organizer">Start your organizer application <ArrowRight className="ml-2 h-4 w-4" /></Link></Button></div></section>
    </Layout>
  );
};

export default OrganizerInfo;
