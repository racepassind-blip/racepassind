import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/api";
import { csvCell } from "@/lib/csv";
import { ChevronLeft, ChevronRight } from "lucide-react";

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

interface SettlementPreview {
  confirmedParticipantCount: number;
  requiredPaise: number;
  availablePaise: number;
  afterPaise: number;
}

export default function AdminCredits() {
  const [rows, setRows] = useState<TopupRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [settings, setSettings] = useState<PaymentSettings>({ method: "UPI", upiId: "", payeeName: "SportPass India" });
  const [message, setMessage] = useState("");
  const [eventId, setEventId] = useState("");
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [saving, setSaving] = useState(false);
  const [organizerFilter, setOrganizerFilter] = useState("ALL");
  const [eventFilter, setEventFilter] = useState("ALL");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [topupSummary, setTopupSummary] = useState({ total: 0, pending: 0, approvedCreditsPaise: 0 });
  const [organizerOptions, setOrganizerOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [eventOptions, setEventOptions] = useState<Array<{ id: string; name: string }>>([]);
  const ledgerPageSize = 50;

  const load = useCallback(async () => {
    const ledgerParams = new URLSearchParams({ page: String(ledgerPage), page_size: String(ledgerPageSize) });
    if (organizerFilter !== "ALL") ledgerParams.set("organization_id", organizerFilter);
    if (eventFilter !== "ALL") ledgerParams.set("event_id", eventFilter);
    const [topups, payment, ledgerRows] = await Promise.all([
      apiRequest<TopupResponse>(`/admin/credits/topups?status=PENDING&page=${pendingPage}&page_size=25`),
      apiRequest<PaymentSettings>("/admin/credits/payment-settings"), apiRequest<LedgerResponse>(`/admin/credits/ledger?${ledgerParams}`),
    ]);
    setRows(topups.items);
    setPendingTotal(topups.total);
    setTopupSummary(topups.summary);
    setSettings(payment);
    setLedger(ledgerRows.items);
    setLedgerTotal(ledgerRows.total);
    setOrganizerOptions(ledgerRows.organizerOptions);
    setEventOptions(ledgerRows.eventOptions);
  }, [eventFilter, ledgerPage, organizerFilter, pendingPage]);
  useEffect(() => { void load(); }, [load]);

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
    const rejectionReason = action === "reject" ? window.prompt("Reason for rejecting this top-up:", "")?.trim() : null;
    if (action === "reject" && !rejectionReason) return;
    await apiRequest(`/admin/credits/topups/${id}/${action}`, { method: "POST", body: action === "reject" ? JSON.stringify({ rejection_reason: rejectionReason }) : undefined });
    await load();
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

  return <AdminDashboardLayout>
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div><p className="text-sm font-medium text-primary">Finance workspace</p><h1 className="text-3xl font-bold tracking-tight">SportPass Credits</h1><p className="mt-1 text-muted-foreground">Manage UPI top-ups and post-event Credit settlements.</p></div>
      <div className="grid gap-4 sm:grid-cols-3"><Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total top-up requests</p><p className="text-3xl font-bold">{topupSummary.total.toLocaleString("en-IN")}</p></CardContent></Card><Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Approved Credits</p><p className="text-3xl font-bold">{money(topupSummary.approvedCreditsPaise)}</p></CardContent></Card><Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Ledger movements</p><p className="text-3xl font-bold">{ledgerTotal.toLocaleString("en-IN")}</p></CardContent></Card></div>
      <Card><CardHeader><CardTitle>Pending top-ups</CardTitle><CardDescription>Confirm the UTR in your bank account before approving.</CardDescription></CardHeader><CardContent>{pending.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No pending top-ups right now.</div> : <div className="space-y-3">{pending.map((row) => <div key={row.id} className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><p className="text-lg font-semibold">{money(row.amountPaise)}</p><Badge variant="outline">UPI</Badge></div><p className="mt-1 font-medium">{row.organizationName}</p><p className="text-sm text-muted-foreground">UTR: <span className="font-mono text-foreground">{row.utrReference}</span></p><p className="text-xs text-muted-foreground">Requested {new Date(row.requestedAt).toLocaleString("en-IN")}</p></div><div className="flex gap-2"><Button onClick={() => void act(row.id, "approve")}>Approve</Button><Button variant="outline" onClick={() => void act(row.id, "reject")}>Reject</Button></div></div>)}</div>}{pendingTotal > 25 && <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">Page {pendingPage} of {Math.ceil(pendingTotal / 25)}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={pendingPage <= 1} onClick={() => setPendingPage((page) => Math.max(1, page - 1))}>Previous</Button><Button variant="outline" size="sm" disabled={pendingPage >= Math.ceil(pendingTotal / 25)} onClick={() => setPendingPage((page) => page + 1)}>Next</Button></div></div>}</CardContent></Card>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card><CardHeader><CardTitle>UPI payment destination</CardTitle><CardDescription>Organizers use these details to purchase prepaid Credits. QR codes include their selected amount.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><label className="text-sm font-medium">UPI ID</label><Input value={settings.upiId || ""} onChange={(e) => setSettings({ ...settings, upiId: e.target.value })} placeholder="sportpassind@gmail.com" /></div><div className="space-y-2"><label className="text-sm font-medium">Payee name</label><Input value={settings.payeeName || ""} onChange={(e) => setSettings({ ...settings, payeeName: e.target.value })} placeholder="SportPass India" /></div></div><div className="flex flex-wrap items-center gap-3"><Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save UPI details"}</Button><Badge variant="secondary">UPI active</Badge>{message && <span className="text-sm text-muted-foreground">{message}</span>}</div>{settings.qrDataUrl && <div className="flex items-center gap-4 rounded-lg border bg-muted/20 p-4"><img className="h-36 w-36 rounded-md border bg-white p-2" src={settings.qrDataUrl} alt="SportPass UPI QR code" /><div><p className="font-medium">Preview QR</p><p className="text-sm text-muted-foreground">The organizer QR includes the amount and organizer name at checkout.</p></div></div>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Top-up overview</CardTitle><CardDescription>Requests waiting for payment verification.</CardDescription></CardHeader><CardContent><p className="text-4xl font-bold">{topupSummary.pending}</p><p className="text-sm text-muted-foreground">pending requests</p><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div className="rounded-lg bg-muted/40 p-3"><p className="text-muted-foreground">All requests</p><p className="text-xl font-semibold">{topupSummary.total}</p></div><div className="rounded-lg bg-muted/40 p-3"><p className="text-muted-foreground">Method</p><p className="text-xl font-semibold">UPI</p></div></div></CardContent></Card>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div><CardTitle>Credit ledger</CardTitle><CardDescription>Filter Credit purchases and deductions by organizer and event.</CardDescription></div>
          <Button variant="outline" disabled={filteredLedger.length === 0} onClick={exportLedgerCsv}>Export CSV</Button>
        </CardHeader>
        <CardContent><div className="mb-5 grid gap-3 sm:grid-cols-2"><div><label className="mb-1.5 block text-sm font-medium">Organizer</label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={organizerFilter} onChange={e => { setOrganizerFilter(e.target.value); setLedgerPage(1); }}><option value="ALL">All organizers</option>{organizers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div><div><label className="mb-1.5 block text-sm font-medium">Event</label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={eventFilter} onChange={e => { setEventFilter(e.target.value); setLedgerPage(1); }}><option value="ALL">All events</option>{events.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div></div>{filteredLedger.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No Credit entries match these filters.</div> : <div className="space-y-3">{filteredLedger.map((row) => <div key={row.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{row.organizationName}</p><Badge variant="outline">{row.type.replaceAll("_", " ")}</Badge></div><p className="text-sm text-muted-foreground">{row.description}</p><p className="text-xs text-muted-foreground">{row.eventName ? `Event: ${row.eventName} · ` : ""}{new Date(row.createdAt).toLocaleString("en-IN")}</p></div><div className="text-left sm:text-right"><p className={`font-bold ${row.amountPaise >= 0 ? "text-emerald-600" : "text-destructive"}`}>{row.amountPaise >= 0 ? "+" : ""}{money(row.amountPaise)}</p><p className="text-xs text-muted-foreground">Balance {money(row.balanceAfterPaise)}</p></div></div>)}</div>}{ledgerTotal > ledgerPageSize && <div className="mt-5 flex items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">Page {ledgerPage} of {Math.ceil(ledgerTotal / ledgerPageSize)} · {ledgerTotal.toLocaleString("en-IN")} entries</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={ledgerPage <= 1} onClick={() => setLedgerPage((page) => Math.max(1, page - 1))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" disabled={ledgerPage >= Math.ceil(ledgerTotal / ledgerPageSize)} onClick={() => setLedgerPage((page) => page + 1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>}</CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Manual event settlement</CardTitle><CardDescription>Use this for organizations configured for manual settlement after an event.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex flex-col gap-3 sm:flex-row"><Input value={eventId} onChange={(e) => setEventId(e.target.value)} placeholder="Paste event UUID" /><Button variant="outline" disabled={!eventId} onClick={() => void apiRequest(`/admin/credits/events/${eventId}/settlement-preview`).then(setPreview)}>Preview settlement</Button></div>{preview && <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">Participants</p><p className="text-xl font-semibold">{preview.confirmedParticipantCount}</p></div><div><p className="text-xs text-muted-foreground">Required</p><p className="text-xl font-semibold">{money(preview.requiredPaise)}</p></div><div><p className="text-xs text-muted-foreground">Available</p><p className="text-xl font-semibold">{money(preview.availablePaise)}</p></div><div><p className="text-xs text-muted-foreground">After settlement</p><p className={`text-xl font-semibold ${preview.afterPaise < 0 ? "text-destructive" : "text-emerald-600"}`}>{money(preview.afterPaise)}</p></div><div className="sm:col-span-4"><Button disabled={preview.afterPaise < 0} onClick={() => void apiRequest(`/admin/credits/events/${eventId}/settle`, { method: "POST" }).then(() => apiRequest(`/admin/credits/events/${eventId}/settlement-preview`)).then(setPreview)}>Deduct event Credits</Button>{preview.afterPaise < 0 && <span className="ml-3 text-sm text-destructive">Insufficient balance.</span>}</div></div>}</CardContent></Card>
    </div>
  </AdminDashboardLayout>;
}
