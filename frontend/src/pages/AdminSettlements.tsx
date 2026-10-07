import { ComponentType, FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/api";
import { ArrowLeft, ArrowRight, Banknote, CalendarRange, IndianRupee, RefreshCw, Search, Users } from "lucide-react";

type Summary = {
  eventId: string; recoverablePaise: number; reservationShortfallPaise: number;
  eventName: string; organizerName: string | null; paymentMode: string;
  paidRegistrationCount: number; paidParticipantCount: number; refundedRegistrationCount: number;
  grossCollectionsPaise: number; grossOrganizerPayablePaise: number; refundsPaise: number;
  adjustmentsPaise: number; organizerPayablePaise: number; settledAmountPaise: number;
  pendingSettlementPaise: number; outstandingAmountPaise: number; availableToSettlePaise: number;
};
type Settlement = { id: string; version: number; amountPaise: number; method: string; referenceNumber: string | null; settlementDate: string; status: string; notes: string | null; createdByName?: string; createdAt?: string };
type Form = { amount: string; method: "BANK_TRANSFER" | "UPI" | "OTHER"; reference: string; date: string; status: "PENDING" | "PAID" | "FAILED" | "CANCELLED"; notes: string };

const emptyForm = (): Form => ({ amount: "", method: "BANK_TRANSFER", reference: "", date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), status: "PENDING", notes: "" });
const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);

export function parsePaise(value: string) {
  if (!/^-?\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error("Enter rupees with at most two decimal places");
  const [whole, fraction = ""] = value.trim().replace("-", "").split(".");
  const amount = (Number(whole) * 100 + Number(fraction.padEnd(2, "0"))) * (value.trim().startsWith("-") ? -1 : 1);
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > 2147483647) throw new Error("Amount exceeds supported limit");
  return amount;
}

export default function AdminSettlements() {
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<Summary[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    apiRequest<{ items: Summary[]; total: number }>(`/admin/settlement-events?search=${encodeURIComponent(search)}&page=${page}`)
      .then(r => { if (active) { setEvents(r.items); setTotal(r.total); } }).catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, page, selected]);
  if (selected) return <EventLedger key={selected} selectedEventId={selected} onBack={() => setSelected("")} />;

  const outstanding = events.reduce((sum, event) => sum + event.outstandingAmountPaise, 0);
  const managed = events.filter(event => event.paymentMode === "CASHFREE_MANAGED").length;
  return <AdminDashboardLayout><div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Finance workspace</p><h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Organizer settlements</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">Review event balances and record manual transfers to organizers. No money is moved from this screen.</p></div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900"><span className="font-semibold">Manual ledger</span><br />Always verify the bank or UPI receipt before marking paid.</div>
    </div>

    <div className="grid gap-3 sm:grid-cols-3">
      <OverviewMetric icon={CalendarRange} label="Events" value={String(total)} />
      <OverviewMetric icon={Banknote} label="Managed on this page" value={String(managed)} />
      <OverviewMetric icon={IndianRupee} label="Outstanding on this page" value={money(outstanding)} accent />
    </div>

    <Card className="overflow-hidden border-slate-200 shadow-sm">
      <div className="flex flex-col gap-3 border-b bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-semibold">Event balances</h2><p className="text-sm text-muted-foreground">Open an event to review collections, corrections and transfer history.</p></div>
        <div className="relative w-full sm:w-80"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" aria-label="Search events or organizers" placeholder="Search event or organizer" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>
      </div>
      {error && <div role="alert" className="m-4 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3 font-semibold">Event</th><th className="px-4 py-3 font-semibold">Registrations</th><th className="px-4 py-3 font-semibold">Settled</th><th className="px-4 py-3 font-semibold">Pending</th><th className="px-4 py-3 font-semibold">Outstanding</th><th className="px-5 py-3" /></tr></thead>
          <tbody className="divide-y divide-slate-100">{events.map(event => <tr className="group bg-white transition-colors hover:bg-orange-50/35" key={event.eventId}>
            <td className="px-5 py-4"><p className="font-semibold text-slate-950">{event.eventName}</p><p className="mt-0.5 text-sm text-muted-foreground">{event.organizerName || "Organizer unavailable"}</p><span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${event.paymentMode === "CASHFREE_MANAGED" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{event.paymentMode === "CASHFREE_MANAGED" ? "Managed payments" : "Direct UPI"}</span></td>
            <td className="px-4 py-4"><p className="font-semibold">{event.paidRegistrationCount}</p><p className="text-xs text-muted-foreground">{event.paidParticipantCount} participants</p></td>
            <td className="px-4 py-4 font-medium tabular-nums">{money(event.settledAmountPaise)}</td>
            <td className="px-4 py-4 tabular-nums text-amber-700">{money(event.pendingSettlementPaise)}</td>
            <td className="px-4 py-4"><p className={`font-bold tabular-nums ${event.outstandingAmountPaise > 0 ? "text-orange-700" : "text-slate-700"}`}>{money(event.outstandingAmountPaise)}</p><p className="text-xs text-muted-foreground">{money(event.availableToSettlePaise)} available</p></td>
            <td className="px-5 py-4 text-right"><Button variant="outline" className="gap-2 border-slate-300 bg-white group-hover:border-primary group-hover:text-primary" onClick={() => setSelected(event.eventId)}>Open ledger <ArrowRight className="h-4 w-4" /></Button></td>
          </tr>)}</tbody>
        </table>
      </div>
      {loading && <div className="py-14 text-center text-sm text-muted-foreground">Loading settlement balances…</div>}
      {!loading && !events.length && !error && <div className="py-14 text-center"><Banknote className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 font-medium">No events found</p><p className="mt-1 text-sm text-muted-foreground">Try a different event or organizer name.</p></div>}
      <div className="flex items-center justify-between border-t bg-slate-50/70 px-4 py-3"><p className="text-sm text-muted-foreground">Page {page} of {Math.max(1, Math.ceil(total / 20))} · {total} events</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}>Next</Button></div></div>
    </Card>
  </div></AdminDashboardLayout>;
}

function EventLedger({ selectedEventId, onBack }: { selectedEventId: string; onBack: () => void }) {
  const eventId = selectedEventId;
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [version, setVersion] = useState(1);
  const [reversal, setReversal] = useState("");
  const [adjustments, setAdjustments] = useState<{ id: string; amountPaise: number; reason: string; kind: string; settlementId: string | null; createdAt: string; createdBy: string }[]>([]);
  const [collectionPage, setCollectionPage] = useState(1);
  const [collectionTotal, setCollectionTotal] = useState(0);
  const [collections, setCollections] = useState<{ id: string; registrationId: string; providerPaymentId: string; totalPaidPaise: number; platformFeePaise: number; organizerPayablePaise: number }[]>([]);
  useEffect(() => {
    let active = true;
    apiRequest<{ total: number; items: typeof collections }>(`/admin/events/${eventId}/settlement-collections?page=${collectionPage}`)
      .then(r => { if (active) { setCollections(r.items); setCollectionTotal(r.total); } }).catch(e => { if (active) setMessage(e.message); });
    return () => { active = false; };
  }, [eventId, collectionPage]);
  const requestKey = (operation: string, body: object) => {
    const storageKey = `settlement:${eventId}:${operation}`;
    const payload = JSON.stringify(body);
    const raw = sessionStorage.getItem(storageKey);
    const previous = raw ? JSON.parse(raw) : null;
    if (previous?.payload === payload) return previous.key;
    const key = crypto.randomUUID(); sessionStorage.setItem(storageKey, JSON.stringify({ payload, key })); return key;
  };
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Settlement[]>([]);
  const [form, setForm] = useState<Form>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!eventId.trim()) return;
    setLoading(true); setMessage("");
    try {
      const [nextSummary, history, corrections] = await Promise.all([
        apiRequest<Summary>(`/admin/events/${eventId.trim()}/settlement-summary`),
        apiRequest<{ items: Settlement[] }>(`/admin/events/${eventId.trim()}/settlements`),
        apiRequest<{ items: typeof adjustments }>(`/admin/events/${eventId}/settlement-adjustments`),
      ]);
      setSummary(nextSummary); setRows(history.items);
      setAdjustments(corrections.items);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load settlement ledger"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [eventId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage("");
    if (saving.current) return;
    let amountPaise: number;
    try { amountPaise = parsePaise(form.amount); } catch (e) { setMessage((e as Error).message); return; }
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) { setMessage("Enter a valid positive amount."); return; }
    const body = { amount_paise: amountPaise, method: form.method, reference_number: form.reference || null, settlement_date: form.date, status: form.status, notes: form.notes || null };
    saving.current = true; setBusy(true);
    try {
      if (editingId) await apiRequest(`/admin/settlements/${editingId}`, { method: "PATCH", body: JSON.stringify({ ...body, event_id: eventId, expected_version: version }) });
      else await apiRequest(`/admin/events/${eventId.trim()}/settlements`, { method: "POST", body: JSON.stringify({ ...body, idempotency_key: requestKey("transfer", body) }) });
      sessionStorage.removeItem(`settlement:${eventId}:transfer`);
      setEditingId(null); setForm(emptyForm()); setMessage("Settlement saved."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save settlement"); }
    finally { saving.current = false; setBusy(false); }
  };

  const edit = (row: Settlement) => {
    setEditingId(row.id);
    setVersion(row.version);
    setForm({ amount: String(row.amountPaise / 100), method: row.method as Form["method"], reference: row.referenceNumber ?? "", date: row.settlementDate, status: "PENDING", notes: row.notes ?? "" });
  };

  const addAdjustment = async (event: FormEvent) => {
    event.preventDefault(); setMessage("");
    if (saving.current) return;
    let amountPaise: number;
    try { amountPaise = parsePaise(adjustmentAmount); } catch (e) { setMessage((e as Error).message); return; }
    if (!Number.isInteger(amountPaise) || amountPaise === 0) { setMessage("Enter a non-zero adjustment amount."); return; }
    saving.current = true; setBusy(true);
    try {
      const body = { amount_paise: amountPaise, reason: adjustmentReason, settlement_id: reversal || null };
      await apiRequest(`/admin/events/${eventId.trim()}/settlement-adjustments`, { method: "POST", body: JSON.stringify({ ...body, idempotency_key: requestKey("adjustment", body) }) });
      sessionStorage.removeItem(`settlement:${eventId}:adjustment`); setReversal("");
      setAdjustmentAmount(""); setAdjustmentReason(""); setMessage("Adjustment added."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not add adjustment"); }
    finally { saving.current = false; setBusy(false); }
  };

  return <AdminDashboardLayout><div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><Button variant="ghost" className="-ml-3 mb-2 h-8 gap-2 text-muted-foreground hover:text-foreground" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back to events</Button><p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Settlement ledger</p><h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{summary?.eventName || "Organizer settlement"}</h1><p className="mt-2 text-muted-foreground">{summary ? `${summary.organizerName || "Organizer"} · ${summary.paymentMode === "CASHFREE_MANAGED" ? "Managed payments" : "Direct UPI"}` : "Loading event ledger…"}</p></div>
      <Button variant="outline" className="gap-2 self-start bg-white sm:self-auto" onClick={() => void load()} disabled={loading || busy}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />{loading ? "Refreshing…" : "Refresh ledger"}</Button>
    </div>
    {summary && <>
      {summary.recoverablePaise > 0 && <p role="alert" className="text-destructive">Recoverable from organizer: {money(summary.recoverablePaise)}</p>}
      {summary.reservationShortfallPaise > 0 && <p role="alert" className="text-destructive">Pending transfers exceed available funds by {money(summary.reservationShortfallPaise)}. Reduce or cancel them.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Available to settle" value={money(summary.availableToSettlePaise)} strong tone="orange" /><Metric label="Outstanding" value={money(summary.outstandingAmountPaise)} strong /><Metric label="Already settled" value={money(summary.settledAmountPaise)} /><Metric label="Pending transfers" value={money(summary.pendingSettlementPaise)} tone="amber" /></div>
      <Card className="border-slate-200 shadow-sm"><CardHeader className="border-b bg-slate-50/60"><CardTitle className="text-lg">Reconciliation snapshot</CardTitle><CardDescription>Verified collection and organizer payable breakdown for this event.</CardDescription></CardHeader><CardContent className="pt-6">
        <div className="grid gap-4 sm:grid-cols-3"><Metric label="Paid registrations" value={String(summary.paidRegistrationCount)} icon={CalendarRange} /><Metric label="Participants" value={String(summary.paidParticipantCount)} icon={Users} /><Metric label="Refunded registrations" value={String(summary.refundedRegistrationCount)} /></div>
        <div className="mt-6 grid gap-4 border-t pt-6 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Gross collected" value={money(summary.grossCollectionsPaise)} /><Metric label="Gross organizer payable" value={money(summary.grossOrganizerPayablePaise)} /><Metric label="Refund deductions" value={money(summary.refundsPaise)} /><Metric label="Adjustments" value={money(summary.adjustmentsPaise)} /></div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>{editingId ? "Edit pending settlement" : "Record settlement"}</CardTitle><CardDescription>Paid settlements are immutable. Correct them with an adjustment entry.</CardDescription></CardHeader><CardContent><form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <Field label="Amount (₹)"><Input inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required /></Field>
        <Field label="Method"><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.method} onChange={e => setForm({ ...form, method: e.target.value as Form["method"] })}><option value="BANK_TRANSFER">Bank transfer</option><option value="UPI">UPI</option><option value="OTHER">Other</option></select></Field>
        <Field label="UTR / reference"><Input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></Field>
        <Field label="Settlement date"><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required /></Field>
        <Field label="Status"><select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Form["status"] })}><option value="PAID">Paid — bank transfer confirmed</option><option value="PENDING">Pending — reserve funds</option>{editingId && <><option value="CANCELLED">Cancelled</option><option value="FAILED">Failed</option></>}</select></Field>
        <Field label="Notes"><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
        <div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : editingId ? "Save changes" : "Record settlement"}</Button>{editingId && <Button disabled={busy} type="button" variant="outline" onClick={() => { setEditingId(null); setForm(emptyForm()); }}>Cancel edit</Button>}</div>
      </form></CardContent></Card>
      <Card><CardHeader><CardTitle>Record correction</CardTitle><CardDescription>A transfer reversal corrects an erroneous paid entry or records funds returned by the bank. It does not recall money. Payable adjustments change the amount owed; enter a signed amount and a supporting reason.</CardDescription></CardHeader><CardContent><form className="grid gap-4 sm:grid-cols-2" onSubmit={addAdjustment}><Field label="Correction type"><select value={reversal} onChange={e => setReversal(e.target.value)} className="w-full border rounded p-2 bg-background"><option value="">Payable adjustment</option>{rows.filter(r => r.status === "PAID").map(r => <option key={r.id} value={r.id}>Reverse {r.referenceNumber} · {money(r.amountPaise)}</option>)}</select></Field><Field label={reversal ? "Amount to reverse (₹, positive)" : "Signed amount (₹)"}><Input inputMode="decimal" value={adjustmentAmount} onChange={e => setAdjustmentAmount(e.target.value)} required /></Field><Field label="Reason / supporting reference"><Input value={adjustmentReason} onChange={e => setAdjustmentReason(e.target.value)} minLength={3} required /></Field><div className="sm:col-span-2"><Button disabled={busy} type="submit" variant="outline">Record correction</Button></div></form></CardContent></Card>
      <Card><CardHeader><CardTitle>Correction history</CardTitle></CardHeader><CardContent>{adjustments.map(a => <div key={a.id} className="border-b py-3"><p>{money(a.amountPaise)} · {a.kind} · {new Date(a.createdAt).toLocaleString()}</p><p>{a.reason}</p>{a.settlementId && <p>Transfer: {rows.find(r => r.id === a.settlementId)?.referenceNumber || a.settlementId}</p>}<p className="text-xs break-all">Recorded by {a.createdBy}</p></div>)}{!adjustments.length && <p>No corrections recorded.</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Verified collections</CardTitle><CardDescription>Frozen registration allocations from verified production payments. Gateway integration is separate; legacy payment approvals are not imported.</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Registration / payment</th><th>Collected</th><th>Platform fee</th><th>Organizer share</th></tr></thead><tbody>{collections.map(c => <tr key={c.id} className="border-b"><td className="py-3 break-all">{c.registrationId}<p>{c.providerPaymentId}</p></td><td>{money(c.totalPaidPaise)}</td><td>{money(c.platformFeePaise)}</td><td>{money(c.organizerPayablePaise)}</td></tr>)}</tbody></table></div>{!collections.length && <p>No verified managed collections.</p>}<div className="mt-4 flex gap-3"><Button disabled={collectionPage === 1} onClick={() => setCollectionPage(p => p - 1)}>Previous collections</Button><span>{collectionTotal} collections</span><Button disabled={collectionPage * 50 >= collectionTotal} onClick={() => setCollectionPage(p => p + 1)}>Next collections</Button></div></CardContent></Card>
      <Card><CardHeader><CardTitle>Settlement history</CardTitle><CardDescription>Original paid amounts are preserved. Linked reversals appear in correction history and reduce the net settled total.</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-3">Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Status</th><th>Notes / recorded by</th><th></th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b"><td className="py-3">{row.settlementDate}</td><td>{money(row.amountPaise)}</td><td>{row.method.replace("_", " ")}</td><td>{row.referenceNumber || "—"}</td><td>{row.status}</td><td>{row.notes}<p>{row.createdByName}</p>{row.createdAt && <small>{new Date(row.createdAt).toLocaleString()}</small>}</td><td className="text-right">{row.status === "PENDING" && <Button disabled={busy} size="sm" variant="outline" onClick={() => edit(row)}>Edit</Button>}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="py-8 text-center text-muted-foreground">No settlements recorded.</p>}</div></CardContent></Card>
    </>}
    {message && <p className="text-sm text-muted-foreground">{message}</p>}
  </div></AdminDashboardLayout>;
}

function OverviewMetric({ icon: Icon, label, value, accent = false }: { icon: ComponentType<{ className?: string }>; label: string; value: string; accent?: boolean }) {
  return <div className={`flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm ${accent ? "border-orange-200" : "border-slate-200"}`}><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${accent ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-600"}`}><Icon className="h-5 w-5" /></span><div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="truncate text-xl font-bold tabular-nums">{value}</p></div></div>;
}
function Metric({ label, value, strong = false, tone, icon: Icon }: { label: string; value: string; strong?: boolean; tone?: "orange" | "amber"; icon?: ComponentType<{ className?: string }> }) {
  return <div className={`rounded-xl border p-4 ${tone === "orange" ? "border-orange-200 bg-orange-50" : tone === "amber" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}><div className="flex items-center gap-2"><p className="text-xs font-medium text-muted-foreground">{label}</p>{Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}</div><p className={`${strong ? "text-2xl" : "text-xl"} mt-1 font-bold tabular-nums`}>{value}</p></div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block space-y-2"><span className="text-sm font-medium">{label}</span>{children}</label>; }
