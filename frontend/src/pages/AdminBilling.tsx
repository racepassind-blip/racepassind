import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, FileCheck2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";

type BillingUnit = "per_event" | "per_registration";

interface BillingRecord {
  id: string | null;
  eventId: string;
  eventName: string;
  eventStatus: string;
  organizationId: string;
  organizationName: string;
  planName: string | null;
  billingUnit: BillingUnit | null;
  confirmedRegistrations: number;
  applicablePricePaise: number;
  discountPaise: number;
  finalAmountPaise: number;
  billingStatus: "waived" | "not_billed" | "payment_due" | "overdue" | "paid_manual";
  dueAt: string | null;
  finalizedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  notes: string | null;
}

function formatINR(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function statusLabel(status: BillingRecord["billingStatus"]) {
  return status === "paid_manual" ? "Paid manually" : status === "payment_due" ? "Payment due" : status === "not_billed" ? "Not billed" : status === "waived" ? "Waived" : "Overdue";
}

function statusVariant(status: BillingRecord["billingStatus"]) {
  if (status === "paid_manual" || status === "waived") return "default" as const;
  if (status === "overdue") return "destructive" as const;
  return "secondary" as const;
}

function billingUnitLabel(unit: BillingUnit | null) {
  return unit === "per_registration" ? "Per registration" : "Per event";
}

const AdminBilling = () => {
  const navigate = useNavigate();
  const [records, setRecords] = useState<BillingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [referenceDrafts, setReferenceDrafts] = useState<Record<string, string>>({});
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try { setRecords(await apiRequest<BillingRecord[]>("/admin/billing")); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not load billing records."); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const finalize = async (record: BillingRecord) => {
    setActionId(record.eventId);
    try {
      const updated = await apiRequest<BillingRecord>(`/admin/billing/events/${record.eventId}/finalize`, { method: "POST", body: JSON.stringify({ due_days: 14 }) });
      setRecords((current) => current.map((item) => item.eventId === updated.eventId ? updated : item));
      toast.success(updated.billingStatus === "waived" ? "Billing waived under the founding program." : "Billing finalized with a 14-day due period.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not finalize billing."); }
    finally { setActionId(null); }
  };

  const markPaid = async (record: BillingRecord) => {
    if (!record.id) return;
    setActionId(record.id);
    try {
      const updated = await apiRequest<BillingRecord>(`/admin/billing/${record.id}/paid`, { method: "POST", body: JSON.stringify({ payment_reference: referenceDrafts[record.id] || null, notes: notesDrafts[record.id] || null }) });
      setRecords((current) => current.map((item) => item.id === updated.id ? updated : item));
      toast.success("Manual payment recorded.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not record payment."); }
    finally { setActionId(null); }
  };

  const waive = async (record: BillingRecord) => {
    if (!record.id) return;
    setActionId(record.id);
    try {
      const updated = await apiRequest<BillingRecord>(`/admin/billing/${record.id}/waive`, { method: "POST", body: JSON.stringify({ notes: notesDrafts[record.id] || "Waived by admin" }) });
      setRecords((current) => current.map((item) => item.id === updated.id ? updated : item));
      toast.success("Billing record waived.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not waive billing."); }
    finally { setActionId(null); }
  };

  const notBilled = records.filter((record) => record.billingStatus === "not_billed").length;
  const due = records.filter((record) => record.billingStatus === "payment_due").length;
  const overdue = records.filter((record) => record.billingStatus === "overdue").length;

  return (
    <AdminDashboardLayout>
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><Button variant="ghost" size="icon" onClick={() => navigate("/admin/plans")} aria-label="Back to plans"><ArrowLeft className="h-4 w-4" /></Button><div><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck className="h-4 w-4" /> Admin-only billing ledger</div><h1 className="text-3xl font-black tracking-tight sm:text-4xl">Organizer billing</h1><p className="mt-2 max-w-2xl text-muted-foreground">Finalize an event after the race, give the organizer a payment window, and record manual payment or a waiver. Race participant payments are not affected.</p></div></div><Button variant="outline" onClick={() => void load()} disabled={loading} className="gap-2"><RefreshCw className="h-4 w-4" /> Refresh</Button></div>
        <div className="grid gap-4 sm:grid-cols-3"><Card><CardContent className="flex items-center gap-3 p-5"><FileCheck2 className="h-5 w-5 text-muted-foreground" /><div><p className="text-2xl font-black">{notBilled}</p><p className="text-sm text-muted-foreground">Not finalized</p></div></CardContent></Card><Card><CardContent className="flex items-center gap-3 p-5"><Clock3 className="h-5 w-5 text-primary" /><div><p className="text-2xl font-black">{due}</p><p className="text-sm text-muted-foreground">Payment due</p></div></CardContent></Card><Card><CardContent className="flex items-center gap-3 p-5"><XCircle className="h-5 w-5 text-destructive" /><div><p className="text-2xl font-black">{overdue}</p><p className="text-sm text-muted-foreground">Overdue</p></div></CardContent></Card></div>
        <Card><CardHeader><CardTitle>Event billing records</CardTitle><CardDescription>Use the 14-day default due period as a starting point. Finalized amounts are snapshots and do not change when plan settings change later.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="border-y bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Event / organizer</th><th className="px-5 py-3">Usage</th><th className="px-5 py-3">Plan & unit</th><th className="px-5 py-3">Amount</th><th className="px-5 py-3">Due</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></tr></thead><tbody className="divide-y">{loading ? <tr><td colSpan={7} className="px-5 py-12 text-center text-muted-foreground">Loading billing records…</td></tr> : records.length === 0 ? <tr><td colSpan={7} className="px-5 py-12 text-center text-muted-foreground">No events are available for billing yet.</td></tr> : records.map((record) => <tr key={record.eventId} className="align-top"><td className="px-5 py-4"><p className="font-semibold">{record.eventName}</p><p className="text-xs text-muted-foreground">{record.organizationName} · {record.eventStatus}</p></td><td className="px-5 py-4 text-muted-foreground">{record.confirmedRegistrations} confirmed</td><td className="px-5 py-4"><p>{record.planName ?? "—"}</p><p className="text-xs text-muted-foreground">{billingUnitLabel(record.billingUnit)}</p></td><td className="px-5 py-4"><p className="font-bold">{formatINR(record.finalAmountPaise)}</p>{record.discountPaise > 0 && <p className="text-xs text-accent-foreground">-{formatINR(record.discountPaise)} discount</p>}</td><td className="px-5 py-4 text-muted-foreground">{formatDate(record.dueAt)}</td><td className="px-5 py-4"><Badge variant={statusVariant(record.billingStatus)}>{statusLabel(record.billingStatus)}</Badge>{record.paymentReference && <p className="mt-1 text-xs text-muted-foreground">Ref: {record.paymentReference}</p>}</td><td className="px-5 py-4"><div className="min-w-56 space-y-2">{record.billingStatus === "not_billed" && <Button size="sm" className="w-full gap-2" onClick={() => void finalize(record)} disabled={actionId === record.eventId}><FileCheck2 className="h-4 w-4" />{actionId === record.eventId ? "Finalizing…" : "Finalize · 14 days"}</Button>}{(record.billingStatus === "payment_due" || record.billingStatus === "overdue") && record.id && <><div className="space-y-1"><Label htmlFor={`reference-${record.id}`} className="text-xs">Payment reference</Label><Input id={`reference-${record.id}`} value={referenceDrafts[record.id] ?? ""} onChange={(event) => setReferenceDrafts((current) => ({ ...current, [record.id!]: event.target.value }))} placeholder="UTR / receipt number" /></div><div className="space-y-1"><Label htmlFor={`notes-${record.id}`} className="text-xs">Notes</Label><Input id={`notes-${record.id}`} value={notesDrafts[record.id] ?? ""} onChange={(event) => setNotesDrafts((current) => ({ ...current, [record.id!]: event.target.value }))} placeholder="Optional" /></div><div className="flex gap-2"><Button size="sm" className="flex-1 gap-1" onClick={() => void markPaid(record)} disabled={actionId === record.id}><CheckCircle2 className="h-4 w-4" /> Paid</Button><Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => void waive(record)} disabled={actionId === record.id}><XCircle className="h-4 w-4" /> Waive</Button></div></>}{record.billingStatus === "paid_manual" && <p className="flex items-center gap-1 text-xs text-accent-foreground"><CheckCircle2 className="h-4 w-4" /> Payment recorded {formatDate(record.paidAt)}</p>}{record.billingStatus === "waived" && <p className="text-xs text-muted-foreground">No payment required.</p>}</div></td></tr>)}</tbody></table></div></CardContent></Card>
      </div>
    </AdminDashboardLayout>
  );
};

export default AdminBilling;
