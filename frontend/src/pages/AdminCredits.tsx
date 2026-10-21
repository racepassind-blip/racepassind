import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/api";
import { csvCell } from "@/lib/csv";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { AdminBills } from "@/components/AdminBills";

const money = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

interface TopupRow {
  id: string;
  organizationName: string;
  amountPaise: number;
  utrReference: string;
  requestedAt: string;
}

interface LedgerRow {
  id: string;
  organizationName: string;
  type: string;
  amountPaise: number;
  balanceAfterPaise: number;
  eventName: string | null;
  registrationId: string | null;
  registrationReference: string | null;
  description: string;
  reason: string | null;
  createdAt: string;
}

interface PaymentSettings {
  method: "UPI";
  upiId: string | null;
  payeeName: string;
  qrDataUrl?: string | null;
}

interface TopupResponse {
  items: TopupRow[];
  total: number;
  summary: { total: number; pending: number; approvedCreditsPaise: number };
}

interface LedgerResponse {
  items: LedgerRow[];
  total: number;
  truncated: boolean;
  organizerOptions: Array<{ id: string; name: string }>;
  eventOptions: Array<{ id: string; name: string }>;
}

interface EventCreditSummary {
  eventId: string;
  eventName: string;
  registrationCount: number;
  confirmedParticipantCount: number;
  calculatedFeePaise: number;
  chargedPaise: number;
  discountPaise: number;
  netFeePaise: number;
  availablePaise: number;
}

export default function AdminCredits({ view = "all" }: { view?: "all" | "topups" | "ledger" | "settings" }) {
  const [params] = useSearchParams();
  const [rows, setRows] = useState<TopupRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [settings, setSettings] = useState<PaymentSettings>({ method: "UPI", upiId: "", payeeName: "SportPass India" });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [organizerFilter, setOrganizerFilter] = useState(params.get("organization_id") || "ALL");
  const [eventFilter, setEventFilter] = useState(params.get("event_id") || "ALL");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => { setOrganizerFilter(params.get("organization_id") || "ALL"); setEventFilter(params.get("event_id") || "ALL"); setLedgerPage(1); }, [params]);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [topupSummary, setTopupSummary] = useState({ total: 0, pending: 0, approvedCreditsPaise: 0 });
  const [organizerOptions, setOrganizerOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [eventOptions, setEventOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [eventSummary, setEventSummary] = useState<EventCreditSummary | null>(null);
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const discountBusy = useRef(false);
  const subtractionBusy = useRef(false);
  const [correctionAmount, setCorrectionAmount] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const loadVersion = useRef(0);
  const ledgerPageSize = 50;

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setEventSummary(null);
    const ledgerParams = new URLSearchParams({ page: String(ledgerPage), page_size: String(ledgerPageSize) });
    if (organizerFilter !== "ALL") ledgerParams.set("organization_id", organizerFilter);
    if (eventFilter !== "ALL") ledgerParams.set("event_id", eventFilter);
    const [topups, payment, ledgerRows] = await Promise.all([
      apiRequest<TopupResponse>(`/admin/credits/topups?status=PENDING&page=${pendingPage}&page_size=25`),
      apiRequest<PaymentSettings>("/admin/credits/payment-settings"), apiRequest<LedgerResponse>(`/admin/credits/ledger?${ledgerParams}`),
    ]);
    const summary = eventFilter === "ALL" ? null : await apiRequest<EventCreditSummary>(`/admin/credits/events/${eventFilter}/summary`);
    if (version !== loadVersion.current) return;
    setRows(topups.items);
    setPendingTotal(topups.total);
    setTopupSummary(topups.summary);
    setSettings(payment);
    setLedger(ledgerRows.items);
    setLedgerTotal(ledgerRows.total);
    setOrganizerOptions(ledgerRows.organizerOptions);
    setEventOptions(ledgerRows.eventOptions);
    setEventSummary(summary);
  }, [eventFilter, ledgerPage, organizerFilter, pendingPage]);
  useEffect(() => { setLoading(true); setError(""); void load().catch(e => setError(e.message || "Could not load Credits")).finally(() => setLoading(false)); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await apiRequest("/admin/credits/payment-settings", { method: "PUT", body: JSON.stringify({ method: "UPI", upi_id: settings.upiId, payee_name: settings.payeeName }) });
      setMessage("UPI payment details saved.");
      await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not save settings"); }
    finally { setSaving(false); }
  };
  const act = async (id: string, action: string) => {
    if (saving) return;
    const rejectionReason = action === "reject" ? window.prompt("Reason for rejecting this top-up:", "")?.trim() : null;
    if (action === "reject" && !rejectionReason) return;
    setSaving(true); setError("");
    try {
      await apiRequest(`/admin/credits/topups/${id}/${action}`, { method: "POST", body: action === "reject" ? JSON.stringify({ rejection_reason: rejectionReason }) : undefined });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update top-up"); }
    finally { setSaving(false); }
  };
  const pending = rows;
  const organizers = useMemo(() => organizerOptions.map((option) => [option.id, option.name] as const), [organizerOptions]);
  const events = useMemo(() => eventOptions.map((option) => [option.id, option.name] as const), [eventOptions]);
  const filteredLedger = ledger;
  const exportLedgerCsv = async () => {
    const params = new URLSearchParams({ export: "true" });
    if (organizerFilter !== "ALL") params.set("organization_id", organizerFilter);
    if (eventFilter !== "ALL") params.set("event_id", eventFilter);
    const response = await apiRequest<LedgerResponse>(`/admin/credits/ledger?${params}`);
    const headers = ["Date", "Organizer", "Event", "Registration number", "Registration UUID", "Transaction type", "Description", "Reason", "Amount (Credits)", "Balance after (Credits)"];
    const lines = response.items.map((row) => [
      csvCell(new Date(row.createdAt).toLocaleString("en-IN")),
      csvCell(row.organizationName, true),
      csvCell(row.eventName || "Account-level", true),
      csvCell(row.registrationReference || "", true),
      csvCell(row.registrationId || "", true),
      csvCell(row.type, true),
      csvCell(row.description, true),
      csvCell(row.reason || "", true),
      csvCell((row.amountPaise / 100).toFixed(2)),
      csvCell((row.balanceAfterPaise / 100).toFixed(2)),
    ].join(","));
    const blob = new Blob([[headers.map((header) => csvCell(header)).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sportpass-credit-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    if (response.truncated) setMessage("CSV export was limited to the newest 5,000 matching ledger entries.");
  };
  const applyEventDiscount = async () => {
    if (!eventSummary || eventSummary.eventId !== eventFilter || discountBusy.current) return;
    const rupees = Number(discountAmount);
    if (!/^\d+(\.\d{1,2})?$/.test(discountAmount.trim()) || !Number.isSafeInteger(Math.round(rupees * 100)) || rupees <= 0 || Math.round(rupees * 100) > eventSummary.netFeePaise) { setError("Enter a positive discount within the remaining fee, using at most two decimal places."); return; }
    if (discountReason.trim().length < 3) { setError("Enter a reason of at least three characters."); return; }
    discountBusy.current = true;
    setSaving(true); setError("");
    try {
      const storageKey = `credit-discount:${eventSummary.eventId}`;
      const body = { amount_paise: Math.round(rupees * 100), reason: discountReason.trim() };
      const fingerprint = JSON.stringify(body);
      const previous = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      const key = previous?.fingerprint === fingerprint ? previous.key : crypto.randomUUID();
      sessionStorage.setItem(storageKey, JSON.stringify({ fingerprint, key }));
      await apiRequest(`/admin/credits/events/${eventSummary.eventId}/discount`, { method: "POST", body: JSON.stringify({ ...body, idempotency_key: key }) });
      sessionStorage.removeItem(storageKey);
      setDiscountAmount(""); setDiscountReason(""); setMessage("Discount returned to the organizer’s Credits."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not apply discount"); }
    finally { discountBusy.current = false; setSaving(false); }
  };
  const subtractCredits = async () => {
    if (subtractionBusy.current || organizerFilter === "ALL") return;
    const amount = Math.round(Number(correctionAmount) * 100);
    if (!/^\d+(\.\d{1,2})?$/.test(correctionAmount.trim()) || !Number.isSafeInteger(amount) || amount <= 0 || correctionReason.trim().length < 3) {
      setError("Enter a positive amount with at most two decimals and a reason of at least three characters."); return;
    }
    const name = organizerOptions.find(o => o.id === organizerFilter)?.name || organizerFilter;
    if (!window.confirm(`Subtract ${money(amount)} Credits from ${name}? Reason: ${correctionReason.trim()}`)) return;
    subtractionBusy.current = true; setSaving(true); setError(""); setMessage("");
    try {
      const body = { organization_id: organizerFilter, amount_paise: amount, reason: correctionReason.trim() };
      const fingerprint = JSON.stringify(body);
      const storageKey = `credit-subtraction:${organizerFilter}`;
      const previous = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      const key = previous?.fingerprint === fingerprint ? previous.key : crypto.randomUUID();
      sessionStorage.setItem(storageKey, JSON.stringify({ fingerprint, key }));
      const result = await apiRequest<{ balanceAfterPaise: number }>("/admin/credits/subtract", { method: "POST", body: JSON.stringify({ ...body, idempotency_key: key }) });
      sessionStorage.removeItem(storageKey);
      setCorrectionAmount(""); setCorrectionReason("");
      setMessage(`Credits subtracted from ${name}. Balance after correction: ${money(result.balanceAfterPaise)}.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not subtract Credits"); }
    finally { subtractionBusy.current = false; setSaving(false); }
  };

  return <AdminDashboardLayout>
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div><h2 className="text-2xl font-bold tracking-tight">{view === "topups" ? "Verify credit top-ups" : view === "settings" ? "Credit payment settings" : "SportPass Credits"}</h2><p className="mt-1 text-sm text-muted-foreground">Organizer prepaid balances cover SportPass fees. These are separate from participant collections.</p></div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {message && <p role="status">{message}</p>}
      {loading && <p role="status">Loading Credits…</p>}
      {(view === "all" || view === "ledger") && <AdminBills organizers={organizerOptions} />}
      {(view === "all" || view === "ledger") && <Card><CardHeader><CardTitle>Correct excess Credits</CardTitle><CardDescription>Subtract an incorrectly approved amount. A permanent ledger entry records the reason and admin. The balance cannot go below zero.</CardDescription></CardHeader><CardContent className="space-y-3"><label className="block text-sm">Organizer<select aria-label="Correction organizer" className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={organizerFilter} disabled={saving} onChange={e => { setOrganizerFilter(e.target.value); setEventFilter("ALL"); setLedgerPage(1); setCorrectionAmount(""); setCorrectionReason(""); }}><option value="ALL">Select an organizer</option>{organizerOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label><Input aria-label="Credits to subtract" placeholder="Amount to subtract (₹)" inputMode="decimal" value={correctionAmount} onChange={e => setCorrectionAmount(e.target.value)} disabled={saving} /><Input aria-label="Correction reason" placeholder="Reason and original top-up / UTR reference" maxLength={1000} value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} disabled={saving} /><Button variant="destructive" disabled={saving || organizerFilter === "ALL"} onClick={() => void subtractCredits()}>Subtract Credits</Button></CardContent></Card>}
      {(view === "all" || view === "ledger") && <div className="grid gap-4 sm:grid-cols-3"><Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total top-up requests</p><p className="text-3xl font-bold">{topupSummary.total.toLocaleString("en-IN")}</p></CardContent></Card><Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Approved Credits</p><p className="text-3xl font-bold">{money(topupSummary.approvedCreditsPaise)}</p></CardContent></Card><Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Ledger movements</p><p className="text-3xl font-bold">{ledgerTotal.toLocaleString("en-IN")}</p></CardContent></Card></div>}
      {eventSummary && eventSummary.eventId === eventFilter && !loading && (view === "all" || view === "ledger") && <Card className="border-primary/20"><CardHeader><CardTitle>Event Credit Summary — {eventSummary.eventName}</CardTitle><CardDescription>Credits are charged as registrations are approved. Discounts are recorded as a separate, auditable credit back to the organizer.</CardDescription></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Approved registrations</p><p className="mt-1 text-xl font-bold">{eventSummary.registrationCount}</p><p className="text-xs text-muted-foreground">{eventSummary.confirmedParticipantCount} participants</p></div><div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Calculated fee (all approved registrations)</p><p className="mt-1 text-xl font-bold">{money(eventSummary.calculatedFeePaise)}</p></div><div className="rounded-lg bg-emerald-50 p-3"><p className="text-xs text-emerald-800">Discount given</p><p className="mt-1 text-xl font-bold text-emerald-800">{money(eventSummary.discountPaise)}</p></div><div className="rounded-lg bg-primary/10 p-3"><p className="text-xs text-primary">Net Credits charged</p><p className="mt-1 text-xl font-bold text-primary">{money(eventSummary.netFeePaise)}</p></div></div><div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_2fr_auto]"><Input aria-label="Discount amount in rupees" type="number" min="0.01" step="0.01" value={discountAmount} onChange={(event) => setDiscountAmount(event.target.value)} placeholder="Discount ₹" disabled={saving || eventSummary.netFeePaise <= 0} /><Input aria-label="Discount reason" value={discountReason} onChange={(event) => setDiscountReason(event.target.value)} placeholder="Reason for discount" maxLength={1000} disabled={saving || eventSummary.netFeePaise <= 0} /><Button onClick={() => void applyEventDiscount()} disabled={saving || eventSummary.netFeePaise <= 0}>{saving ? "Applying…" : "Give discount"}</Button></div><p className="text-xs text-muted-foreground">Credits originally charged: {money(eventSummary.chargedPaise)}. Maximum additional discount available: {money(eventSummary.netFeePaise)}. The organizer’s current Credit balance is {money(eventSummary.availablePaise)}.</p></CardContent></Card>}
      {(view === "all" || view === "topups") && <Card><CardHeader><CardTitle>Pending top-ups</CardTitle><CardDescription>Confirm the UTR in your bank account before approving.</CardDescription></CardHeader><CardContent>{pending.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No pending top-ups right now.</div> : <div className="space-y-3">{pending.map((row) => <div key={row.id} className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><p className="text-lg font-semibold">{money(row.amountPaise)}</p><Badge variant="outline">UPI</Badge></div><p className="mt-1 font-medium">{row.organizationName}</p><p className="text-sm text-muted-foreground">UTR: <span className="font-mono text-foreground">{row.utrReference}</span></p><p className="text-xs text-muted-foreground">Requested {new Date(row.requestedAt).toLocaleString("en-IN")}</p></div><div className="flex gap-2"><Button disabled={saving} onClick={() => void act(row.id, "approve")}>Approve</Button><Button disabled={saving} variant="outline" onClick={() => void act(row.id, "reject")}>Reject</Button></div></div>)}</div>}{pendingTotal > 25 && <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">Page {pendingPage} of {Math.ceil(pendingTotal / 25)}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={pendingPage <= 1} onClick={() => setPendingPage((page) => Math.max(1, page - 1))}>Previous</Button><Button variant="outline" size="sm" disabled={pendingPage >= Math.ceil(pendingTotal / 25)} onClick={() => setPendingPage((page) => page + 1)}>Next</Button></div></div>}</CardContent></Card>}
      {(view === "all" || view === "settings") && <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card><CardHeader><CardTitle>UPI payment destination</CardTitle><CardDescription>Organizers use these details to purchase prepaid Credits. QR codes include their selected amount.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><label className="text-sm font-medium">UPI ID</label><Input value={settings.upiId || ""} onChange={(e) => setSettings({ ...settings, upiId: e.target.value })} placeholder="sportpassind@gmail.com" /></div><div className="space-y-2"><label className="text-sm font-medium">Payee name</label><Input value={settings.payeeName || ""} onChange={(e) => setSettings({ ...settings, payeeName: e.target.value })} placeholder="SportPass India" /></div></div><div className="flex flex-wrap items-center gap-3"><Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save UPI details"}</Button><Badge variant="secondary">UPI active</Badge>{message && <span className="text-sm text-muted-foreground">{message}</span>}</div>{settings.qrDataUrl && <div className="flex items-center gap-4 rounded-lg border bg-muted/20 p-4"><img className="h-36 w-36 rounded-md border bg-white p-2" src={settings.qrDataUrl} alt="SportPass UPI QR code" /><div><p className="font-medium">Preview QR</p><p className="text-sm text-muted-foreground">The organizer QR includes the amount and organizer name at checkout.</p></div></div>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Top-up overview</CardTitle><CardDescription>Requests waiting for payment verification.</CardDescription></CardHeader><CardContent><p className="text-4xl font-bold">{topupSummary.pending}</p><p className="text-sm text-muted-foreground">pending requests</p><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div className="rounded-lg bg-muted/40 p-3"><p className="text-muted-foreground">All requests</p><p className="text-xl font-semibold">{topupSummary.total}</p></div><div className="rounded-lg bg-muted/40 p-3"><p className="text-muted-foreground">Method</p><p className="text-xl font-semibold">UPI</p></div></div></CardContent></Card>
      </div>}
      {(view === "all" || view === "ledger") && <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div><CardTitle>Credit ledger</CardTitle><CardDescription>Filter Credit purchases and deductions by organizer and event.</CardDescription></div>
          <Button variant="outline" disabled={filteredLedger.length === 0} onClick={exportLedgerCsv}>Export CSV</Button>
        </CardHeader>
        <CardContent><div className="mb-5 grid gap-3 sm:grid-cols-2"><div><label className="mb-1.5 block text-sm font-medium">Organizer</label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={organizerFilter} onChange={e => { setOrganizerFilter(e.target.value); setLedgerPage(1); }}><option value="ALL">All organizers</option>{organizers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div><div><label className="mb-1.5 block text-sm font-medium">Event</label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={eventFilter} onChange={e => { setEventFilter(e.target.value); setLedgerPage(1); }}><option value="ALL">All events</option>{events.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div></div>{filteredLedger.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No Credit entries match these filters.</div> : <div className="space-y-3">{filteredLedger.map((row) => <div key={row.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{row.organizationName}</p><Badge variant="outline">{row.type.replaceAll("_", " ")}</Badge></div><p className="text-sm text-muted-foreground">{row.description}</p>{row.reason && <p className="text-sm">Reason: {row.reason}</p>}<p className="text-xs text-muted-foreground">{row.eventName ? `Event: ${row.eventName} · ` : ""}{new Date(row.createdAt).toLocaleString("en-IN")}</p></div><div className="text-left sm:text-right"><p className={`font-bold ${row.amountPaise >= 0 ? "text-emerald-600" : "text-destructive"}`}>{row.amountPaise >= 0 ? "+" : ""}{money(row.amountPaise)}</p><p className="text-xs text-muted-foreground">Balance {money(row.balanceAfterPaise)}</p></div></div>)}</div>}{ledgerTotal > ledgerPageSize && <div className="mt-5 flex items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">Page {ledgerPage} of {Math.ceil(ledgerTotal / ledgerPageSize)} · {ledgerTotal.toLocaleString("en-IN")} entries</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={ledgerPage <= 1} onClick={() => setLedgerPage((page) => Math.max(1, page - 1))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" disabled={ledgerPage >= Math.ceil(ledgerTotal / ledgerPageSize)} onClick={() => setLedgerPage((page) => page + 1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>}</CardContent>
      </Card>}
    </div>
  </AdminDashboardLayout>;
}
