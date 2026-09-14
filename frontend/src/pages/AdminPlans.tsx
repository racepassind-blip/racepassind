import { useEffect, useState } from "react";
import { ArrowLeft, Check, RefreshCw, Save, Settings2, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  active: boolean;
  sortOrder: number;
}

interface OrganizationOption { id: string; name: string; status: string; eligible: boolean; }
interface AdminPricing { plans: PricingPlan[]; foundingProgram: { enabled: boolean; freeRacesCount: number; defaultDiscountBasisPoints: number }; organizations: OrganizationOption[]; }
interface PlanDraft { name: string; minimum: string; maximum: string; price: string; billingUnit: BillingUnit; active: boolean; sortOrder: string; }

function toRupees(paise: number) { return (paise / 100).toFixed(2); }
function toPaise(value: string) {
  if (!/^\d+(?:\.\d{0,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
function draftFromPlan(plan: PricingPlan): PlanDraft { return { name: plan.name, minimum: String(plan.minConfirmedRegistrations), maximum: plan.maxConfirmedRegistrations === null ? "" : String(plan.maxConfirmedRegistrations), price: toRupees(plan.pricePaise), billingUnit: plan.billingUnit, active: plan.active, sortOrder: String(plan.sortOrder) }; }
function formatRange(plan: PricingPlan) { return plan.maxConfirmedRegistrations === null ? `${plan.minConfirmedRegistrations}+ confirmed` : `${plan.minConfirmedRegistrations}–${plan.maxConfirmedRegistrations} confirmed`; }

const AdminPlans = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<AdminPricing | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PlanDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingPlan, setSavingPlan] = useState<string | null>(null);
  const [savingProgram, setSavingProgram] = useState(false);
  const [program, setProgram] = useState({ enabled: true, freeRacesCount: "1", discountPercent: "100" });
  const [eligibleIds, setEligibleIds] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiRequest<AdminPricing>("/admin/plans");
      setData(response);
      setDrafts(Object.fromEntries(response.plans.map((plan) => [plan.id, draftFromPlan(plan)])));
      setProgram({ enabled: response.foundingProgram.enabled, freeRacesCount: String(response.foundingProgram.freeRacesCount), discountPercent: String(response.foundingProgram.defaultDiscountBasisPoints / 100) });
      setEligibleIds(response.organizations.filter((organization) => organization.eligible).map((organization) => organization.id));
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not load pricing configuration."); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const updateDraft = (id: string, patch: Partial<PlanDraft>) => setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  const savePlan = async (plan: PricingPlan) => {
    const draft = drafts[plan.id];
    if (!draft) return;
    const pricePaise = toPaise(draft.price);
    const minimum = Number(draft.minimum);
    const maximum = draft.maximum.trim() ? Number(draft.maximum) : null;
    const sortOrder = Number(draft.sortOrder);
    if (pricePaise === null || !Number.isInteger(minimum) || minimum < 0 || (maximum !== null && (!Number.isInteger(maximum) || maximum < minimum)) || !Number.isInteger(sortOrder) || sortOrder < 0) { toast.error("Check the plan name, registration range, price, and order."); return; }
    setSavingPlan(plan.id);
    try {
      const updated = await apiRequest<PricingPlan>(`/admin/plans/${plan.id}`, { method: "PUT", body: JSON.stringify({ name: draft.name, min_confirmed_registrations: minimum, max_confirmed_registrations: maximum, price_paise: pricePaise, billing_unit: draft.billingUnit, active: draft.active, sort_order: sortOrder }) });
      setData((current) => current ? { ...current, plans: current.plans.map((item) => item.id === updated.id ? updated : item) } : current);
      setDrafts((current) => ({ ...current, [updated.id]: draftFromPlan(updated) }));
      toast.success(`${updated.name} plan saved.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save plan."); } finally { setSavingPlan(null); }
  };

  const saveProgram = async () => {
    const freeRacesCount = Number(program.freeRacesCount);
    const discountPercent = Number(program.discountPercent);
    if (!Number.isInteger(freeRacesCount) || freeRacesCount < 0 || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) { toast.error("Enter valid founding program values."); return; }
    setSavingProgram(true);
    try {
      await apiRequest("/admin/founding-program", { method: "PUT", body: JSON.stringify({ enabled: program.enabled, free_races_count: freeRacesCount, default_discount_basis_points: Math.round(discountPercent * 100), eligible_organization_ids: eligibleIds }) });
      toast.success("Founding organizer program saved.");
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save founding program."); } finally { setSavingProgram(false); }
  };

  const toggleEligible = (id: string) => setEligibleIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return (
    <AdminDashboardLayout>
      <div className="mx-auto max-w-[1500px] space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><Button variant="ghost" size="icon" onClick={() => navigate("/organizer")} aria-label="Back to organizer dashboard"><ArrowLeft className="h-4 w-4" /></Button><div><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck className="h-4 w-4" /> Admin-only configuration</div><h1 className="text-3xl font-black tracking-tight sm:text-4xl">Race Pass pricing model</h1><p className="mt-2 max-w-3xl text-muted-foreground">Configure the single source of truth for organizer billing. Participant payments remain separate manual UPI payments with no RacePass checkout fee.</p></div></div><Button variant="outline" onClick={() => void load()} disabled={loading} className="gap-2"><RefreshCw className="h-4 w-4" /> Refresh</Button></div>

        {loading ? <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading pricing configuration…</CardContent></Card> : data ? <>
          <section><div className="mb-5"><p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Five simple tiers</p><h2 className="mt-2 text-2xl font-black tracking-tight">Event-based pricing</h2><p className="mt-1 text-sm text-muted-foreground">Active ranges cannot overlap. Use per-registration only for plans such as Marathon; the calculated amount is rate × confirmed registrations.</p></div><div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{data.plans.map((plan) => { const draft = drafts[plan.id]; return <Card key={plan.id} className={draft?.active ? "border-primary/30" : "opacity-75"}><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-xl">{plan.name}</CardTitle><CardDescription className="mt-1">{plan.code} · {formatRange(plan)}</CardDescription></div><Badge variant={draft?.active ? "default" : "outline"}>{draft?.active ? "Active" : "Inactive"}</Badge></div></CardHeader><CardContent className="space-y-4"><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Minimum confirmed</Label><Input type="number" min="0" value={draft?.minimum ?? ""} onChange={(event) => updateDraft(plan.id, { minimum: event.target.value })} /></div><div className="space-y-2"><Label>Maximum confirmed</Label><Input type="number" min="0" placeholder="No limit" value={draft?.maximum ?? ""} onChange={(event) => updateDraft(plan.id, { maximum: event.target.value })} /></div></div><div className="space-y-2"><Label>Rate (₹)</Label><Input inputMode="decimal" value={draft?.price ?? ""} onChange={(event) => updateDraft(plan.id, { price: event.target.value })} /></div><div className="space-y-2"><Label htmlFor={`unit-${plan.id}`}>Billing unit</Label><select id={`unit-${plan.id}`} value={draft?.billingUnit ?? "per_event"} onChange={(event) => updateDraft(plan.id, { billingUnit: event.target.value as BillingUnit })} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="per_event">Per event</option><option value="per_registration">Per registration</option></select></div><div className="flex items-center justify-between rounded-lg border p-3"><Label htmlFor={`active-${plan.id}`}>Active</Label><Switch id={`active-${plan.id}`} checked={draft?.active ?? false} onCheckedChange={(checked) => updateDraft(plan.id, { active: checked })} /></div><div className="flex items-center justify-between gap-3"><div className="space-y-1"><Label>Display order</Label><p className="text-xs text-muted-foreground">Lower appears first.</p></div><Input className="w-20" type="number" min="0" value={draft?.sortOrder ?? ""} onChange={(event) => updateDraft(plan.id, { sortOrder: event.target.value })} /></div><Button className="w-full gap-2" onClick={() => void savePlan(plan)} disabled={savingPlan === plan.id}><Save className="h-4 w-4" />{savingPlan === plan.id ? "Saving…" : "Save plan"}</Button></CardContent></Card>; })}</div></section>

          <section><div className="mb-5"><p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Acquisition offer</p><h2 className="mt-2 text-2xl font-black tracking-tight">Founding Organizer Program</h2><p className="mt-1 text-sm text-muted-foreground">The default product offer is one free first event for selected founding organizations, regardless of event size.</p></div><Card><CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle className="text-xl">Program settings</CardTitle><CardDescription>Eligible organizations receive the configured discount before normal event pricing applies.</CardDescription></div><Switch checked={program.enabled} onCheckedChange={(enabled) => setProgram((current) => ({ ...current, enabled }))} /></div></CardHeader><CardContent className="space-y-6"><div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><Label>Free events</Label><Input type="number" min="0" max="100" value={program.freeRacesCount} onChange={(event) => setProgram((current) => ({ ...current, freeRacesCount: event.target.value }))} /></div><div className="space-y-2"><Label>Default discount (%)</Label><Input type="number" min="0" max="100" step="0.01" value={program.discountPercent} onChange={(event) => setProgram((current) => ({ ...current, discountPercent: event.target.value }))} /></div><div className="flex items-end"><div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground"><Check className="mr-2 inline h-4 w-4 text-accent" />Default: first event free</div></div></div><div className="space-y-3"><div><Label>Eligible organizers</Label><p className="mt-1 text-xs text-muted-foreground">Only selected active organizations receive the founding discount.</p></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.organizations.map((organization) => <label key={organization.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/40"><input type="checkbox" checked={eligibleIds.includes(organization.id)} onChange={() => toggleEligible(organization.id)} className="h-4 w-4 accent-[hsl(var(--primary))]" /><span className="flex-1">{organization.name}<span className="block text-xs text-muted-foreground">{organization.status}</span></span>{eligibleIds.includes(organization.id) && <Badge variant="secondary">Eligible</Badge>}</label>)}</div></div><div className="flex justify-end"><Button className="gap-2" onClick={() => void saveProgram()} disabled={savingProgram}><Settings2 className="h-4 w-4" />{savingProgram ? "Saving…" : "Save founding program"}</Button></div></CardContent></Card></section>
        </> : null}
      </div>
    </AdminDashboardLayout>
  );
};

export default AdminPlans;
