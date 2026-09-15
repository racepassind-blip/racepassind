import { useEffect, useState } from "react";
import { ArrowLeft, CircleHelp, Gift, IndianRupee, ShieldCheck, Sparkles, WalletCards } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { OrganizerWorkspaceTabs } from "@/components/OrganizerWorkspaceTabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/api";

type BillingUnit = "per_event" | "per_registration";

interface PricingPlan {
  id: string;
  code: string;
  name: string;
  minConfirmedRegistrations: number;
  maxConfirmedRegistrations: number | null;
  pricePaise: number;
  billingUnit: BillingUnit;
  currency: string;
  active: boolean;
  sortOrder: number;
}

interface EventPricing {
  id: string;
  name: string;
  status: string;
  confirmedRegistrations: number;
  raceNumber: number;
  applicablePlan: PricingPlan | null;
  applicablePricePaise: number;
  discountPaise: number;
  finalAmountPaise: number;
  billingStatus: "waived" | "not_billed" | "payment_due" | "overdue" | "paid_manual";
  dueAt: string | null;
  finalizedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
}

interface OrganizationPricing {
  id: string;
  name: string;
  confirmedRegistrations: number;
  foundingProgram: { enabled: boolean; eligible: boolean; freeRacesCount: number };
  events: EventPricing[];
}

interface PricingResponse {
  plans: PricingPlan[];
  foundingProgram: { enabled: boolean; freeRacesCount: number; defaultDiscountPercent: number };
  organizations: OrganizationPricing[];
}

function formatINR(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function formatRange(plan: PricingPlan) {
  return plan.maxConfirmedRegistrations === null
    ? `${plan.minConfirmedRegistrations}+ confirmed registrations`
    : `${plan.minConfirmedRegistrations}–${plan.maxConfirmedRegistrations} confirmed registrations`;
}

function formatRate(plan: PricingPlan) {
  if (plan.pricePaise === 0) return { amount: "Free", suffix: "forever" };
  return { amount: formatINR(plan.pricePaise), suffix: plan.billingUnit === "per_registration" ? "/ registration" : "/ event" };
}

function billingLabel(status: EventPricing["billingStatus"]) {
  return status === "paid_manual" ? "Paid manually" : status === "payment_due" ? "Payment due" : status === "overdue" ? "Overdue" : status === "waived" ? "Waived" : "Not billed";
}

function billingVariant(status: EventPricing["billingStatus"]) {
  if (status === "paid_manual" || status === "waived") return "default" as const;
  if (status === "overdue") return "destructive" as const;
  return "secondary" as const;
}

function formatDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function PlanCard({ plan }: { plan: PricingPlan }) {
  const rate = formatRate(plan);
  const featured = plan.code === "growth";
  return (
    <Card className={`relative flex h-full flex-col overflow-hidden ${featured ? "border-primary shadow-md ring-1 ring-primary/20" : "border-border/80"}`}>
      {featured && <Badge className="absolute right-4 top-4 bg-primary text-primary-foreground">Popular for growing races</Badge>}
      <CardHeader className="min-h-[175px] border-b bg-muted/20">
        <div className="flex items-center gap-2"><CardTitle className="text-xl">{plan.name}</CardTitle>{plan.code === "community" && <Badge variant="secondary">Start here</Badge>}</div>
        <CardDescription>{formatRange(plan)}</CardDescription>
        <div className="mt-auto pt-6"><span className="text-4xl font-black tracking-tight">{rate.amount}</span><span className="ml-1 text-sm font-medium text-muted-foreground">{rate.suffix}</span></div>
      </CardHeader>
      <CardContent className="flex-1 p-5"><p className="text-sm leading-6 text-muted-foreground">Paid registrations use your UPI details. Participants submit a UTR or payment reference for your team to review.</p>{plan.billingUnit === "per_registration" && <p className="mt-5 rounded-xl bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">Large-race pricing is calculated as {formatINR(plan.pricePaise)} × confirmed registrations.</p>}</CardContent>
    </Card>
  );
}

const OrganizerPricing = () => {
  const navigate = useNavigate();
  const [pricing, setPricing] = useState<PricingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<PricingResponse>("/organizer/pricing", { signal: controller.signal })
      .then(setPricing)
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Could not load pricing.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <OrganizerDashboardLayout showNavigation={false}>
      <div className="mx-auto max-w-[1500px] space-y-10 px-4 py-10 sm:px-6 lg:px-8">
        <OrganizerWorkspaceTabs />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3"><Button variant="ghost" size="icon" onClick={() => navigate("/organizer")} aria-label="Back to organizer dashboard"><ArrowLeft className="h-4 w-4" /></Button><div><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><Sparkles className="h-4 w-4" /> Sport Pass India pricing</div><h1 className="text-3xl font-black tracking-tight sm:text-4xl">Simple, event-based pricing</h1><p className="mt-2 max-w-3xl text-muted-foreground">Pay for the scale of your race. No monthly subscription, no participant checkout fee, and no cut of your registration money. SportPass selects your plan from confirmed registrations.</p></div></div>
          <Badge variant="outline" className="gap-2 px-3 py-1.5"><ShieldCheck className="h-4 w-4" /> Transparent by design</Badge>
        </div>

        {loading ? <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading plans…</CardContent></Card> : error ? <Card><CardContent className="p-6 text-sm text-destructive">{error}</CardContent></Card> : pricing ? (
          <>
            {pricing.foundingProgram.enabled && <Card className="overflow-hidden border-[#ff9933]/30 bg-[#fff8ef]"><CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#ff9933] text-[#101b35]"><Gift className="h-5 w-5" /></div><div><p className="text-sm font-bold uppercase tracking-[0.16em] text-[#b45c00]">Founding Organizer Program</p><p className="mt-2 text-xl font-black text-[#101b35]">Your first event is free, no matter the size.</p><p className="mt-1 text-sm text-[#5d4a36]">After your first event, the normal plan applies. We&apos;re building this with you.</p></div></div><Badge className="w-fit bg-[#101b35] text-white">100% waived</Badge></CardContent></Card>}

            <section><div className="mb-5"><p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Plans &amp; rates</p><h2 className="mt-2 text-2xl font-black tracking-tight">Pricing based on confirmed registrations</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Paid registrations count after the form is complete and your team approves the UPI payment. Free ₹0 registrations count once confirmed.</p></div><div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{pricing.plans.map((plan) => <PlanCard key={plan.id} plan={plan} />)}</div></section>

            <Card className="border-primary/20 bg-primary/5"><CardContent className="flex items-start gap-4 p-6"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><WalletCards className="h-5 w-5" /></div><div><p className="text-lg font-black">UPI-only participant payments for now.</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Participants pay directly to your UPI ID, submit a UTR or payment reference, and wait for your team to verify it. SportPass does not process card or net-banking payments at this stage.</p><p className="mt-3 text-xs leading-5 text-muted-foreground">Your bank or UPI provider may require PAN, Aadhaar or another government ID, plus bank details, for KYC. Keep those documents with your provider; SportPass does not currently collect them in the organizer profile.</p></div></CardContent></Card>

            <section><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Your event preview</p><h2 className="mt-2 text-2xl font-black tracking-tight">What you will pay</h2></div><div className="flex items-center gap-2 text-sm text-muted-foreground"><IndianRupee className="h-4 w-4 text-primary" /> Organizer billing is separate from participant payments</div></div>
              {pricing.organizations.map((organization) => <div key={organization.id} className="mb-8"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-xl font-bold">{organization.name}</h3><p className="mt-1 text-sm text-muted-foreground">{organization.confirmedRegistrations.toLocaleString("en-IN")} confirmed registrations across your events</p></div>{organization.foundingProgram.enabled && organization.foundingProgram.eligible && <p className="flex items-center gap-2 text-sm font-medium text-accent-foreground"><Gift className="h-4 w-4 text-accent" /> First event free under the founding program</p>}</div>
                {organization.events.length === 0 ? <Card><CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><CircleHelp className="h-5 w-5" /> Create your first event to see its pricing preview here.</CardContent></Card> : <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Event</th><th className="px-5 py-3">Confirmed</th><th className="px-5 py-3">Plan & rate</th><th className="px-5 py-3">Event fee</th><th className="px-5 py-3">Final amount</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y">{organization.events.map((event) => { const rate = event.applicablePlan ? formatRate(event.applicablePlan) : null; return <tr key={event.id}><td className="px-5 py-4"><p className="font-semibold">{event.name}</p><p className="text-xs text-muted-foreground">Race {event.raceNumber} · {event.status}</p></td><td className="px-5 py-4 text-muted-foreground">{event.confirmedRegistrations.toLocaleString("en-IN")}</td><td className="px-5 py-4"><p className="font-medium">{event.applicablePlan?.name ?? "Not matched"}</p>{rate && <p className="text-xs text-muted-foreground">{rate.amount} {rate.suffix}</p>}</td><td className="px-5 py-4">{formatINR(event.applicablePricePaise)}{event.applicablePlan?.billingUnit === "per_registration" && <p className="text-xs text-muted-foreground">rate × confirmed</p>}</td><td className="px-5 py-4 font-bold">{formatINR(event.finalAmountPaise)}{event.discountPaise > 0 && <span className="ml-2 text-xs font-normal text-accent-foreground">-{formatINR(event.discountPaise)}</span>}</td><td className="px-5 py-4"><Badge variant={billingVariant(event.billingStatus)}>{billingLabel(event.billingStatus)}</Badge>{event.dueAt && (event.billingStatus === "payment_due" || event.billingStatus === "overdue") && <p className="mt-1 text-xs text-muted-foreground">Due {formatDate(event.dueAt)}</p>}</td></tr>; })}</tbody></table></div></Card>}
              </div>)}
            </section>

            <section className="grid gap-5 md:grid-cols-3"><Card className="border-border/80"><CardContent className="p-6"><p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">For Participants</p><h2 className="mt-3 text-xl font-black">Nothing extra at checkout.</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Participants pay only the event fee you set. SportPass never adds a checkout fee.</p></CardContent></Card><Card className="border-border/80"><CardContent className="p-6"><p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">For Organizers</p><h2 className="mt-3 text-xl font-black">Your money stays yours.</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Registration money settles directly to your own account through your event&apos;s UPI setup.</p></CardContent></Card><Card className="border-border/80"><CardContent className="p-6"><p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">For SportPass</p><h2 className="mt-3 text-xl font-black">Built for race day.</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">We built this because we&apos;ve run these events ourselves. The goal is simple: fewer things break on race day.</p></CardContent></Card></section>
          </>
        ) : null}
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerPricing;
