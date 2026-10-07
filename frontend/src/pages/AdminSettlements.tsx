import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/api";

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
  useEffect(() => {
    let active = true;
    apiRequest<{ items: Summary[]; total: number }>(`/admin/settlement-events?search=${encodeURIComponent(search)}&page=${page}`)
      .then(r => { if (active) { setEvents(r.items); setTotal(r.total); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [search, page, selected]);
  if (selected) return <><Button className="m-4" onClick={() => setSelected("")}>Back to events</Button><EventLedger key={selected} selectedEventId={selected} /></>;
  return <AdminDashboardLayout><main className="space-y-6 p-6"><h1 className="text-3xl font-bold">Organizer settlements</h1><p>Record manual bank transfers and UPI payments. Recording a settlement does not send money.</p><Input aria-label="Search events or organizers" placeholder="Search events or organizers" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />{error && <p role="alert">{error}</p>}<div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>Event / organizer</th><th>Paid registrations</th><th>Settled</th><th>Pending</th><th>Outstanding</th><th /></tr></thead><tbody>{events.map(e => <tr className="border-b" key={e.eventId}><td className="py-4">{e.eventName}<p>{e.organizerName}</p><small>{e.paymentMode}</small></td><td>{e.paidRegistrationCount}</td><td>{money(e.settledAmountPaise)}</td><td>{money(e.pendingSettlementPaise)}</td><td>{money(e.outstandingAmountPaise)}</td><td><Button onClick={() => setSelected(e.eventId)}>Open ledger</Button></td></tr>)}</tbody></table></div><div className="flex gap-4"><Button disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button><span>Page {page} · {total} events</span><Button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}>Next</Button></div></main></AdminDashboardLayout>;
}

function EventLedger({ selectedEventId }: { selectedEventId: string }) {
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

  return <AdminDashboardLayout><div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
    <div><p className="text-sm font-medium text-primary">Finance workspace</p><h1 className="text-3xl font-bold tracking-tight">Organizer settlements</h1><p className="mt-1 text-muted-foreground">Reconcile managed registrations and record partial organizer transfers.</p></div>
    <Button onClick={() => void load()} disabled={loading || busy}>{loading ? "Loading…" : "Refresh ledger"}</Button>
    {summary && <>
      {summary.recoverablePaise > 0 && <p role="alert" className="text-destructive">Recoverable from organizer: {money(summary.recoverablePaise)}</p>}
      {summary.reservationShortfallPaise > 0 && <p role="alert" className="text-destructive">Pending transfers exceed available funds by {money(summary.reservationShortfallPaise)}. Reduce or cancel them.</p>}
      <Card><CardHeader><CardTitle>{summary.eventName}</CardTitle><CardDescription>{summary.organizerName} · {summary.paymentMode}</CardDescription></CardHeader><CardContent>
        <div className="grid gap-4 sm:grid-cols-3"><Metric label="Paid registrations" value={String(summary.paidRegistrationCount)} /><Metric label="Participants" value={String(summary.paidParticipantCount)} /><Metric label="Refunded registrations" value={String(summary.refundedRegistrationCount)} /></div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3"><Metric label="Gross collected" value={money(summary.grossCollectionsPaise)} /><Metric label="Gross organizer payable" value={money(summary.grossOrganizerPayablePaise)} /><Metric label="Refund deductions" value={money(summary.refundsPaise)} /><Metric label="Adjustments" value={money(summary.adjustmentsPaise)} /><Metric label="Already settled" value={money(summary.settledAmountPaise)} /><Metric label="Pending transfers" value={money(summary.pendingSettlementPaise)} /><Metric label="Outstanding" value={money(summary.outstandingAmountPaise)} strong /><Metric label="Available to settle" value={money(summary.availableToSettlePaise)} strong /></div>
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

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className={strong ? "text-2xl font-bold" : "text-xl font-semibold"}>{value}</p></div>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block space-y-2"><span className="text-sm font-medium">{label}</span>{children}</label>; }
