import { Fragment, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, Clock3, FileCheck2, Receipt, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";

function formatINR(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Organizer Platform Fee billing (5% + ₹10 per paid registration)
// This is now the ONLY billing model. The legacy plan/slab billing has been
// removed from the UI.
// ---------------------------------------------------------------------------

type PlatformFeeStatus = "accruing" | "payment_due" | "paid" | "overdue" | "waived";

interface FeeBreakdown {
  percentageBasisPoints: number;
  percentagePercent: number;
  registrationRevenuePaise: number;
  percentageComponentPaise: number;
  perRegistrationPaise: number;
  paidRegistrationCount: number;
  flatComponentPaise: number;
  grossFeePaise: number;
  discountPaise: number;
  finalAmountPaise: number;
}

interface CategoryBreakdown {
  categoryId: string | null;
  categoryName: string;
  paidRegistrations: number;
  freeRegistrations: number;
  revenuePaise: number;
  unitPricePaise: number;
}

interface PlatformFeeRecord {
  id: string | null;
  eventId: string;
  eventName: string;
  eventStatus: string;
  organizationId: string;
  organizationName: string;
  invoiceNumber: string | null;
  paidRegistrationCount: number;
  registrationRevenuePaise: number;
  percentageBasisPoints: number;
  perRegistrationPaise: number;
  grossFeePaise: number;
  discountPaise: number;
  finalAmountPaise: number;
  currency: string;
  billingStatus: PlatformFeeStatus;
  dueAt: string | null;
  finalizedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  notes: string | null;
  feeBreakdown: FeeBreakdown;
  categoryBreakdown: CategoryBreakdown[];
}

function breakdownFor(record: PlatformFeeRecord): FeeBreakdown {
  if (record.feeBreakdown) return record.feeBreakdown;
  const percentageComponentPaise = Math.round(record.registrationRevenuePaise * record.percentageBasisPoints / 10000);
  const flatComponentPaise = record.perRegistrationPaise * record.paidRegistrationCount;
  return {
    percentageBasisPoints: record.percentageBasisPoints,
    percentagePercent: record.percentageBasisPoints / 100,
    registrationRevenuePaise: record.registrationRevenuePaise,
    percentageComponentPaise,
    perRegistrationPaise: record.perRegistrationPaise,
    paidRegistrationCount: record.paidRegistrationCount,
    flatComponentPaise,
    grossFeePaise: record.grossFeePaise,
    discountPaise: record.discountPaise,
    finalAmountPaise: record.finalAmountPaise,
  };
}

const FeeCalculation = ({ breakdown }: { breakdown: FeeBreakdown }) => (
  <div className="rounded-lg border bg-muted/20 p-4">
    <p className="mb-3 text-sm font-semibold">How this fee is calculated</p>
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">{breakdown.percentagePercent}% of revenue ({formatINR(breakdown.registrationRevenuePaise)})</span><span className="font-medium">{formatINR(breakdown.percentageComponentPaise)}</span></div>
      <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">{formatINR(breakdown.perRegistrationPaise)} × {breakdown.paidRegistrationCount} paid reg{breakdown.paidRegistrationCount === 1 ? "" : "s"}</span><span className="font-medium">{formatINR(breakdown.flatComponentPaise)}</span></div>
      <div className="flex items-center justify-between gap-4 border-t pt-2"><span className="font-medium">Gross fee</span><span className="font-semibold">{formatINR(breakdown.grossFeePaise)}</span></div>
      {breakdown.discountPaise > 0 && <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">Discount</span><span className="font-medium text-accent-foreground">-{formatINR(breakdown.discountPaise)}</span></div>}
      <div className="flex items-center justify-between gap-4 border-t pt-2"><span className="font-bold">Payable</span><span className="text-base font-black">{formatINR(breakdown.finalAmountPaise)}</span></div>
    </div>
  </div>
);

const CategoryDetail = ({ categories }: { categories: CategoryBreakdown[] }) => {
  if (!categories || categories.length === 0) return <p className="text-sm text-muted-foreground">No registrations yet.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-2">Category</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Paid regs</th><th className="px-4 py-2">Free regs</th><th className="px-4 py-2">Price / reg</th><th className="px-4 py-2">Revenue</th></tr></thead>
        <tbody className="divide-y">
          {categories.map((category) => {
            const isPaid = category.paidRegistrations > 0 || category.unitPricePaise > 0;
            return (
              <tr key={category.categoryId ?? category.categoryName}>
                <td className="px-4 py-2 font-medium">{category.categoryName}</td>
                <td className="px-4 py-2"><Badge variant={isPaid ? "secondary" : "outline"}>{isPaid ? "Paid" : "Free"}</Badge></td>
                <td className="px-4 py-2 text-muted-foreground">{category.paidRegistrations.toLocaleString("en-IN")}</td>
                <td className="px-4 py-2 text-muted-foreground">{category.freeRegistrations.toLocaleString("en-IN")}</td>
                <td className="px-4 py-2 text-muted-foreground">{category.unitPricePaise > 0 ? formatINR(category.unitPricePaise) : "—"}</td>
                <td className="px-4 py-2 font-medium">{formatINR(category.revenuePaise)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

interface PlatformFeeConfig {
  label: string;
  percentageBasisPoints: number;
  percentagePercent: number;
  perRegistrationPaise: number;
  currency: string;
  defaultDueDays: number;
  updatedAt: string | null;
}

interface PlatformFeeResponse {
  config: PlatformFeeConfig;
  records: PlatformFeeRecord[];
}

function feeStatusLabel(status: PlatformFeeStatus) {
  return status === "payment_due" ? "Payment due" : status === "accruing" ? "Accruing" : status.charAt(0).toUpperCase() + status.slice(1);
}

function feeStatusVariant(status: PlatformFeeStatus) {
  if (status === "paid" || status === "waived") return "default" as const;
  if (status === "overdue") return "destructive" as const;
  return "secondary" as const;
}

// Rupee input helpers (UI works in rupees; API expects paise).
function rupeesToPaise(value: string): number {
  const rupees = Number.parseFloat(value);
  if (Number.isNaN(rupees) || rupees < 0) return 0;
  return Math.round(rupees * 100);
}

const PlatformFeesTab = () => {
  const [config, setConfig] = useState<PlatformFeeConfig | null>(null);
  const [records, setRecords] = useState<PlatformFeeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [discountDrafts, setDiscountDrafts] = useState<Record<string, string>>({});
  const [dueDaysDrafts, setDueDaysDrafts] = useState<Record<string, string>>({});
  const [dueDateDrafts, setDueDateDrafts] = useState<Record<string, string>>({});
  const [referenceDrafts, setReferenceDrafts] = useState<Record<string, string>>({});
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiRequest<PlatformFeeResponse>("/admin/platform-fees");
      setConfig(data.config);
      setRecords(data.records);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load platform fees.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const toggle = (eventId: string) => setExpanded((current) => ({ ...current, [eventId]: !current[eventId] }));

  const upsert = (updated: PlatformFeeRecord) => {
    setRecords((current) => current.map((item) => {
      if (item.eventId !== updated.eventId) return item;
      // Mutation responses don't recompute the per-category split, so keep the
      // existing categoryBreakdown when the response comes back empty.
      const categoryBreakdown = updated.categoryBreakdown?.length ? updated.categoryBreakdown : item.categoryBreakdown;
      return { ...item, ...updated, categoryBreakdown };
    }));
  };

  const raiseBill = async (record: PlatformFeeRecord) => {
    setActionKey(record.eventId);
    try {
      const discountPaise = rupeesToPaise(discountDrafts[record.eventId] ?? "");
      const dueDaysRaw = dueDaysDrafts[record.eventId];
      const body: Record<string, unknown> = { discount_paise: discountPaise };
      if (dueDaysRaw && Number.parseInt(dueDaysRaw, 10) > 0) body.due_days = Number.parseInt(dueDaysRaw, 10);
      const updated = await apiRequest<PlatformFeeRecord>(`/admin/platform-fees/events/${record.eventId}/raise`, { method: "POST", body: JSON.stringify(body) });
      upsert(updated);
      toast.success(`Bill ${updated.invoiceNumber ?? ""} raised.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not raise the bill.");
    } finally {
      setActionKey(null);
    }
  };

  const applyDiscount = async (record: PlatformFeeRecord) => {
    if (!record.id) return;
    setActionKey(record.id);
    try {
      const discountPaise = rupeesToPaise(discountDrafts[record.eventId] ?? "");
      const updated = await apiRequest<PlatformFeeRecord>(`/admin/platform-fees/${record.id}/discount`, { method: "POST", body: JSON.stringify({ discount_paise: discountPaise }) });
      upsert(updated);
      toast.success("Discount applied.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply the discount.");
    } finally {
      setActionKey(null);
    }
  };

  const setDueDate = async (record: PlatformFeeRecord) => {
    if (!record.id) return;
    const raw = dueDateDrafts[record.eventId];
    if (!raw) { toast.error("Pick a due date first."); return; }
    setActionKey(record.id);
    try {
      const updated = await apiRequest<PlatformFeeRecord>(`/admin/platform-fees/${record.id}/due-date`, { method: "POST", body: JSON.stringify({ due_at: new Date(raw).toISOString() }) });
      upsert(updated);
      toast.success("Due date updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not set the due date.");
    } finally {
      setActionKey(null);
    }
  };

  const markPaid = async (record: PlatformFeeRecord) => {
    if (!record.id) return;
    setActionKey(record.id);
    try {
      const updated = await apiRequest<PlatformFeeRecord>(`/admin/platform-fees/${record.id}/paid`, { method: "POST", body: JSON.stringify({ payment_reference: referenceDrafts[record.eventId] || null, notes: notesDrafts[record.eventId] || null }) });
      upsert(updated);
      toast.success("Payment recorded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record the payment.");
    } finally {
      setActionKey(null);
    }
  };

  const markOverdue = async (record: PlatformFeeRecord) => {
    if (!record.id) return;
    setActionKey(record.id);
    try {
      const updated = await apiRequest<PlatformFeeRecord>(`/admin/platform-fees/${record.id}/overdue`, { method: "POST" });
      upsert(updated);
      toast.success("Marked overdue.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not mark overdue.");
    } finally {
      setActionKey(null);
    }
  };

  const waive = async (record: PlatformFeeRecord) => {
    if (!record.id) return;
    setActionKey(record.id);
    try {
      const updated = await apiRequest<PlatformFeeRecord>(`/admin/platform-fees/${record.id}/waive`, { method: "POST", body: JSON.stringify({ notes: notesDrafts[record.eventId] || "Waived by admin" }) });
      upsert(updated);
      toast.success("Bill waived.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not waive the bill.");
    } finally {
      setActionKey(null);
    }
  };

  const accruing = records.filter((record) => record.billingStatus === "accruing").length;
  const due = records.filter((record) => record.billingStatus === "payment_due").length;
  const overdue = records.filter((record) => record.billingStatus === "overdue").length;
  const outstanding = records
    .filter((record) => record.billingStatus === "payment_due" || record.billingStatus === "overdue")
    .reduce((sum, record) => sum + record.finalAmountPaise, 0);

  return (
    <div className="space-y-8">
      <div className="flex justify-end"><Button variant="outline" onClick={() => void load()} disabled={loading} className="gap-2"><RefreshCw className="h-4 w-4" /> Refresh</Button></div>

      {config && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5 text-primary" /> {config.label}</CardTitle>
            <CardDescription>SportPass fee for paid events = {config.percentagePercent}% of registration revenue + {formatINR(config.perRegistrationPaise)} per paid registration. Free events never accrue a platform fee.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>Example: a {formatINR(60000)} registration → {config.percentagePercent}% = {formatINR(rupeesToPaise("600") * config.percentageBasisPoints / 10000)} + {formatINR(config.perRegistrationPaise)} = <span className="font-semibold text-foreground">{formatINR(Math.round(60000 * config.percentageBasisPoints / 10000) + config.perRegistrationPaise)}</span> SportPass fee.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardContent className="flex items-center gap-3 p-5"><Clock3 className="h-5 w-5 text-muted-foreground" /><div><p className="text-2xl font-black">{accruing}</p><p className="text-sm text-muted-foreground">Accruing</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-5"><FileCheck2 className="h-5 w-5 text-primary" /><div><p className="text-2xl font-black">{due}</p><p className="text-sm text-muted-foreground">Payment due</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-5"><XCircle className="h-5 w-5 text-destructive" /><div><p className="text-2xl font-black">{overdue}</p><p className="text-sm text-muted-foreground">Overdue</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-5"><Receipt className="h-5 w-5 text-primary" /><div><p className="text-2xl font-black">{formatINR(outstanding)}</p><p className="text-sm text-muted-foreground">Outstanding</p></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organizer platform fees</CardTitle>
          <CardDescription>Review the calculated fee from actual paid registrations, apply a discount if required, raise the bill, set a due date, and record payment. Amounts are frozen once a bill is raised.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1300px] text-left text-sm">
              <thead className="border-y bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Organizer / event</th>
                  <th className="px-5 py-3">Paid regs</th>
                  <th className="px-5 py-3">Revenue</th>
                  <th className="px-5 py-3">Gross fee</th>
                  <th className="px-5 py-3">Discount</th>
                  <th className="px-5 py-3">Payable</th>
                  <th className="px-5 py-3">Due</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr><td colSpan={9} className="px-5 py-12 text-center text-muted-foreground">Loading platform fees…</td></tr>
                ) : records.length === 0 ? (
                  <tr><td colSpan={9} className="px-5 py-12 text-center text-muted-foreground">No paid events yet. Free events do not accrue a SportPass fee.</td></tr>
                ) : (
                  records.map((record) => (
                    <Fragment key={record.eventId}>
                    <tr className="align-top">
                      <td className="px-5 py-4"><button type="button" onClick={() => toggle(record.eventId)} className="flex items-start gap-2 text-left">{expanded[record.eventId] ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}<span><span className="block font-semibold">{record.organizationName}</span><span className="block text-xs text-muted-foreground">{record.eventName} · {record.eventStatus}</span>{record.invoiceNumber && <span className="block text-xs text-muted-foreground">Invoice: {record.invoiceNumber}</span>}</span></button></td>
                      <td className="px-5 py-4 text-muted-foreground">{record.paidRegistrationCount.toLocaleString("en-IN")}</td>
                      <td className="px-5 py-4 text-muted-foreground">{formatINR(record.registrationRevenuePaise)}</td>
                      <td className="px-5 py-4"><p className="font-medium">{formatINR(record.grossFeePaise)}</p></td>
                      <td className="px-5 py-4 text-muted-foreground">{record.discountPaise > 0 ? `-${formatINR(record.discountPaise)}` : "—"}</td>
                      <td className="px-5 py-4"><p className="font-bold">{formatINR(record.finalAmountPaise)}</p></td>
                      <td className="px-5 py-4 text-muted-foreground">{formatDate(record.dueAt)}</td>
                      <td className="px-5 py-4"><Badge variant={feeStatusVariant(record.billingStatus)}>{feeStatusLabel(record.billingStatus)}</Badge>{record.paymentReference && <p className="mt-1 text-xs text-muted-foreground">Ref: {record.paymentReference}</p>}</td>
                      <td className="px-5 py-4">
                        <div className="min-w-64 space-y-2">
                          {record.billingStatus === "accruing" && (
                            <>
                              <div className="space-y-1">
                                <Label htmlFor={`raise-discount-${record.eventId}`} className="text-xs">Discount (₹)</Label>
                                <Input id={`raise-discount-${record.eventId}`} inputMode="decimal" value={discountDrafts[record.eventId] ?? ""} onChange={(event) => setDiscountDrafts((current) => ({ ...current, [record.eventId]: event.target.value }))} placeholder="0" />
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor={`raise-duedays-${record.eventId}`} className="text-xs">Due in (days)</Label>
                                <Input id={`raise-duedays-${record.eventId}`} inputMode="numeric" value={dueDaysDrafts[record.eventId] ?? ""} onChange={(event) => setDueDaysDrafts((current) => ({ ...current, [record.eventId]: event.target.value }))} placeholder={String(config?.defaultDueDays ?? 14)} />
                              </div>
                              <Button size="sm" className="w-full gap-1" onClick={() => void raiseBill(record)} disabled={actionKey === record.eventId}><FileCheck2 className="h-4 w-4" /> {actionKey === record.eventId ? "Raising…" : "Generate / Raise bill"}</Button>
                            </>
                          )}
                          {(record.billingStatus === "payment_due" || record.billingStatus === "overdue") && record.id && (
                            <>
                              <div className="space-y-1">
                                <Label htmlFor={`discount-${record.eventId}`} className="text-xs">Discount (₹)</Label>
                                <div className="flex gap-2">
                                  <Input id={`discount-${record.eventId}`} inputMode="decimal" value={discountDrafts[record.eventId] ?? ""} onChange={(event) => setDiscountDrafts((current) => ({ ...current, [record.eventId]: event.target.value }))} placeholder={String(record.discountPaise / 100)} />
                                  <Button size="sm" variant="outline" onClick={() => void applyDiscount(record)} disabled={actionKey === record.id}>Apply</Button>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor={`due-${record.eventId}`} className="text-xs">Due date</Label>
                                <div className="flex gap-2">
                                  <Input id={`due-${record.eventId}`} type="date" value={dueDateDrafts[record.eventId] ?? ""} onChange={(event) => setDueDateDrafts((current) => ({ ...current, [record.eventId]: event.target.value }))} />
                                  <Button size="sm" variant="outline" onClick={() => void setDueDate(record)} disabled={actionKey === record.id}>Set</Button>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor={`ref-${record.eventId}`} className="text-xs">Payment reference / UTR</Label>
                                <Input id={`ref-${record.eventId}`} value={referenceDrafts[record.eventId] ?? ""} onChange={(event) => setReferenceDrafts((current) => ({ ...current, [record.eventId]: event.target.value }))} placeholder="UTR / receipt number" />
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor={`fee-notes-${record.eventId}`} className="text-xs">Notes</Label>
                                <Input id={`fee-notes-${record.eventId}`} value={notesDrafts[record.eventId] ?? ""} onChange={(event) => setNotesDrafts((current) => ({ ...current, [record.eventId]: event.target.value }))} placeholder="Optional" />
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button size="sm" className="flex-1 gap-1" onClick={() => void markPaid(record)} disabled={actionKey === record.id}><CheckCircle2 className="h-4 w-4" /> Mark paid</Button>
                                {record.billingStatus === "payment_due" && <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => void markOverdue(record)} disabled={actionKey === record.id}>Overdue</Button>}
                                <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => void waive(record)} disabled={actionKey === record.id}><XCircle className="h-4 w-4" /> Waive</Button>
                              </div>
                            </>
                          )}
                          {record.billingStatus === "paid" && <p className="flex items-center gap-1 text-xs text-accent-foreground"><CheckCircle2 className="h-4 w-4" /> Paid {formatDate(record.paidAt)}</p>}
                          {record.billingStatus === "waived" && <p className="text-xs text-muted-foreground">Waived — nothing to pay.</p>}
                        </div>
                      </td>
                    </tr>
                    {expanded[record.eventId] && (
                      <tr className="bg-muted/10">
                        <td colSpan={9} className="px-5 py-5">
                          <div className="grid gap-5 lg:grid-cols-2">
                            <FeeCalculation breakdown={breakdownFor(record)} />
                            <div>
                              <p className="mb-3 text-sm font-semibold">Registrations by category</p>
                              <CategoryDetail categories={record.categoryBreakdown ?? []} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const AdminBilling = () => {
  const navigate = useNavigate();

  return (
    <AdminDashboardLayout>
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} aria-label="Back to dashboard"><ArrowLeft className="h-4 w-4" /></Button>
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck className="h-4 w-4" /> Admin-only billing ledger</div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Organizer platform fees</h1>
              <p className="mt-2 max-w-2xl text-muted-foreground">SportPass charges 5% of registration revenue + ₹10 per paid registration on paid events. Race participant payments are not affected.</p>
            </div>
          </div>
        </div>

        <PlatformFeesTab />
      </div>
    </AdminDashboardLayout>
  );
};

export default AdminBilling;
