import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api";

export interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  createdAt: string;
  details: Record<string, unknown>;
}

export function PaymentAuditHistory({ items }: { items: AuditEntry[] }) {
  return <ol className="space-y-3 text-sm">{items.length === 0 && <li className="text-muted-foreground">No recorded actions.</li>}
    {items.map(item => <li key={item.id} className="border-l-2 pl-3">
      <p className="font-medium">{item.action.replaceAll("_", " ")}</p>
      <p className="text-xs text-muted-foreground">{item.actor} · {new Date(item.createdAt).toLocaleString("en-IN")}</p>
      {Object.entries(item.details).map(([key, value]) => value != null && <p key={key} className="break-words text-xs text-muted-foreground">{key}: {String(value)}</p>)}
    </li>)}
  </ol>;
}

interface Review {
  id: string; orderId: string; providerOrderId: string; environment: string;
  eventName: string; organizerName: string; amountPaise: number; status: string;
  resolution: null | { action: string; reason: string; initiatedBy: string; providerRefundId: string | null; providerStatus: string | null };
  history: AuditEntry[];
}

const money = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount / 100);

export function CashfreePaymentReviews({ reloadKey }: { reloadKey: number }) {
  const [items, setItems] = useState<Review[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [includeResolved, setIncludeResolved] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ item: Review; action: "FULFILL" | "REFUND" } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ search, page: String(page), include_resolved: String(includeResolved) });
      void apiRequest<{ items: Review[]; total: number }>(`/admin/cashfree/payment-reviews?${params}`)
        .then(data => { if (active) { setItems(data.items); setTotal(data.total); } })
        .catch(e => { if (active) setError(e instanceof Error ? e.message : "Could not load payment reviews"); })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [search, page, includeResolved, refresh, reloadKey]);

  const submit = async (item: Review, action?: "FULFILL" | "REFUND") => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await apiRequest(`/admin/cashfree/payment-reviews/${item.id}/${action ? "resolve" : "reconcile"}`, {
        method: "POST", ...(action ? { body: JSON.stringify({ action, reason: reason.trim() }) } : {}),
      });
      setSelection(null); setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve payment");
      // A timeout can occur after the decision is saved; reload its durable state.
      setSelection(null);
    } finally { setBusy(false); setRefresh(value => value + 1); }
  };

  return <section aria-label="Cashfree payment reviews" className="space-y-4 rounded-xl border bg-card p-5">
    <div><h2 className="text-lg font-bold">Payments needing booking review</h2>
      <p className="text-sm text-muted-foreground">Cashfree received money but the booking could not be confirmed. Review each payment before confirming tickets or issuing a full refund.</p></div>
    <div className="flex flex-wrap items-center gap-3">
      <Input aria-label="Search payment reviews" className="max-w-sm" placeholder="Event, organizer or Cashfree order" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeResolved} onChange={e => { setIncludeResolved(e.target.checked); setPage(1); }} />Include resolved payments</label>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {loading ? <p className="text-sm text-muted-foreground">Loading payment reviews…</p> : <>
      {items.length === 0 && <p className="text-sm text-muted-foreground">No payments found for this view.</p>}
      {items.map(item => <article key={item.id} className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{item.eventName}</h3><p className="text-sm text-muted-foreground">{item.organizerName}</p></div>
          <div className="text-right"><p className="font-semibold">{money(item.amountPaise)}</p><p className="text-xs">{item.environment === "sandbox" ? "Sandbox · " : ""}{item.status.replaceAll("_", " ")}</p></div></div>
        <p className="break-all font-mono text-xs text-muted-foreground">Cashfree order: {item.providerOrderId}<br />SportPass order: {item.orderId}</p>
        {item.resolution && <div className="rounded bg-muted/30 p-3 text-sm"><p>{item.resolution.action === "FULFILL" ? "Booking confirmed" : "Full refund authorized"} by {item.resolution.initiatedBy}</p>
          <p className="text-muted-foreground">{item.resolution.reason}</p>
          {item.resolution.providerRefundId && <p className="break-all text-xs">Refund: {item.resolution.providerRefundId} · {item.resolution.providerStatus || "Awaiting provider response"}</p>}</div>}
        {!item.resolution && selection?.item.id !== item.id && <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => { setSelection({ item, action: "FULFILL" }); setReason(""); }}>Review booking confirmation</Button>
          <Button variant="outline" disabled={busy} onClick={() => { setSelection({ item, action: "REFUND" }); setReason(""); }}>Review full refund</Button></div>}
        {selection?.item.id === item.id && <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-slate-950">
          <p className="text-sm">{selection.action === "REFUND" ? `This initiates a full refund of ${money(item.amountPaise)} through Cashfree and cancels the unconfirmed paid entries. It cannot be switched to ticket confirmation afterward.` : "This confirms the original booking and queues ticket emails only if the event and reserved tickets remain valid. No additional charge is made."}</p>
          <label className="block text-sm font-medium" htmlFor={`reason-${item.id}`}>Reason for this decision</label>
          <Input id={`reason-${item.id}`} value={reason} maxLength={1000} disabled={busy} onChange={e => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2"><Button disabled={busy || reason.trim().length < 5} onClick={() => void submit(item, selection.action)}>{busy ? "Processing…" : selection.action === "REFUND" ? `Confirm full refund ${money(item.amountPaise)}` : "Confirm booking and issue tickets"}</Button>
            <Button variant="outline" disabled={busy} onClick={() => setSelection(null)}>Cancel</Button></div>
        </div>}
        {item.resolution?.action === "REFUND" && item.status !== "REFUNDED" && <Button variant="outline" disabled={busy} onClick={() => void submit(item)}>{busy ? "Checking…" : "Resume / check refund"}</Button>}
        <details><summary className="cursor-pointer text-sm font-medium">Payment and resolution history</summary><div className="mt-3"><PaymentAuditHistory items={item.history} /></div></details>
      </article>)}
    </>}
    <div className="flex items-center justify-between text-sm"><p>{total} matching payments</p><div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={loading || busy || page === 1} onClick={() => setPage(value => value - 1)}>Previous reviews</Button>
      <Button variant="outline" size="sm" disabled={loading || busy || page * 20 >= total} onClick={() => setPage(value => value + 1)}>Next reviews</Button></div></div>
  </section>;
}
