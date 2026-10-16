import { AlertTriangle, ArrowLeft, ArrowRight, Download, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type PaymentAuditRow = {
  checkoutId: string; eventId: string; eventName: string; organizationName: string; status: string; gatewayStatus: string;
  settlementStatus: string; amountPaise: number; platformFeePaise: number; refundPaise: number; cashfreeOrderId: string | null;
  cashfreePaymentIds: string[]; registrationReferences: string[]; receiptDispositions: string[]; createdAt: string | null;
  receiptedAt: string | null; needsAttention: boolean; resolution: { action: string; status: string; reason: string; providerRefundId: string | null } | null;
};

export type PaymentAuditSummary = { paymentCount: number; grossCollectedPaise: number; refundedPaise: number; needsAttentionCount: number; awaitingCount: number };

const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
const date = (value: string | null) => value ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "—";
const labels: Record<string, string> = { successful: "Collected", awaiting: "Awaiting payment", paid_needs_review: "Needs review", needs_review: "Needs review", refunded: "Refunded", partially_refunded: "Partly refunded", refund_in_progress: "Refund in progress", expired: "Expired" };
const badge: Record<string, string> = { successful: "bg-emerald-100 text-emerald-800", awaiting: "bg-slate-100 text-slate-700", paid_needs_review: "bg-amber-100 text-amber-800", needs_review: "bg-amber-100 text-amber-800", refunded: "bg-violet-100 text-violet-800", partially_refunded: "bg-violet-100 text-violet-800", refund_in_progress: "bg-orange-100 text-orange-800", expired: "bg-slate-100 text-slate-600" };

export function FinanceSummary({ summary, organizer }: { summary: PaymentAuditSummary; organizer?: { payable: number; settled: number; outstanding: number } }) {
  const values = organizer ? [
    ["Collected", money(summary.grossCollectedPaise), "Verified Cashfree collections"],
    ["Refunded", money(summary.refundedPaise), "Completed refunds"],
    ["Your payable", money(organizer.payable), "After SportPass fees and refunds"],
    ["Outstanding", money(organizer.outstanding), "Not yet marked paid out"],
  ] : [
    ["Collected", money(summary.grossCollectedPaise), "Successful Cashfree payments"],
    ["Refunded", money(summary.refundedPaise), "Completed refunds"],
    ["Needs attention", String(summary.needsAttentionCount), "Payment or refund requires review"],
    ["Awaiting", String(summary.awaitingCount), "Checkout started, not collected"],
  ];
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{values.map(([label, value, note]) => <div key={label} className="rounded-xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-black tracking-tight tabular-nums">{value}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{note}</p></div>)}</div>;
}

export function PaymentAuditTable({ items, total, page, loading, search, status, onSearch, onStatus, onPage, onRefresh, onExport, showEvent = false }: {
  items: PaymentAuditRow[]; total: number; page: number; loading: boolean; search: string; status: string;
  onSearch: (value: string) => void; onStatus: (value: string) => void; onPage: (page: number) => void; onRefresh: () => void; onExport: () => void; showEvent?: boolean;
}) {
  return <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
    <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="font-bold">Payment audit</h2><p className="mt-0.5 text-sm text-muted-foreground">Search Cashfree order, payment ID, or SportPass registration reference.</p></div>
      <div className="flex gap-2"><Button variant="outline" size="sm" onClick={onRefresh} aria-label="Refresh payment audit"><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button><Button size="sm" variant="outline" onClick={onExport}><Download className="mr-2 h-4 w-4" />CSV</Button></div>
    </div>
    <div className="grid gap-3 border-b bg-muted/20 p-4 md:grid-cols-[minmax(0,1fr)_210px]">
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={event => onSearch(event.target.value)} placeholder="Order ID, payment ID, registration reference…" aria-label="Search payment audit" /></div>
      <Select value={status} onValueChange={onStatus}><SelectTrigger aria-label="Filter payment status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="successful">Collected</SelectItem><SelectItem value="awaiting">Awaiting payment</SelectItem><SelectItem value="paid_needs_review">Needs review</SelectItem><SelectItem value="refund_in_progress">Refund in progress</SelectItem><SelectItem value="refunded">Refunded</SelectItem><SelectItem value="partially_refunded">Partly refunded</SelectItem></SelectContent></Select>
    </div>
    {loading ? <div className="py-16 text-center text-sm text-muted-foreground">Loading payment records…</div> : !items.length ? <div className="py-16 text-center"><Search className="mx-auto h-8 w-8 text-muted-foreground/50" /><p className="mt-3 font-semibold">No payment records match</p><p className="mt-1 text-sm text-muted-foreground">Try a different reference or status.</p></div> : <>
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[1040px] text-left text-sm"><thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground"><tr>{showEvent && <th className="px-5 py-3">Event</th>}<th className="px-5 py-3">Payment evidence</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">References</th><th className="px-5 py-3">Created</th></tr></thead><tbody className="divide-y">{items.map(item => <tr key={`${item.checkoutId}-${item.eventId}`} className={item.needsAttention ? "bg-amber-50/45" : ""}>{showEvent && <td className="px-5 py-4"><p className="font-semibold">{item.eventName}</p><p className="text-xs text-muted-foreground">{item.organizationName}</p></td>}<td className="px-5 py-4"><p className="font-mono text-xs font-semibold">{item.cashfreeOrderId || "Cashfree order pending"}</p><p className="mt-1 text-xs text-muted-foreground">{item.cashfreePaymentIds.join(", ") || "No verified payment ID yet"}</p></td><td className="px-4 py-4"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${badge[item.status] || "bg-slate-100 text-slate-700"}`}>{labels[item.status] || item.status}</span>{item.resolution && <p className="mt-1 max-w-52 truncate text-xs text-muted-foreground" title={item.resolution.reason}>{item.resolution.action}: {item.resolution.status}</p>}</td><td className="px-4 py-4"><p className="font-semibold tabular-nums">{money(item.amountPaise)}</p><p className="text-xs text-muted-foreground">Fee {money(item.platformFeePaise)} · refund {money(item.refundPaise)}</p></td><td className="px-4 py-4 font-mono text-xs text-muted-foreground">{item.registrationReferences.join(", ") || "—"}</td><td className="px-5 py-4 text-xs text-muted-foreground">{date(item.createdAt)}</td></tr>)}</tbody></table></div>
      <div className="divide-y md:hidden">{items.map(item => <article key={`${item.checkoutId}-${item.eventId}`} className={`p-4 ${item.needsAttention ? "bg-amber-50/45" : ""}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0">{showEvent && <p className="mb-1 truncate text-xs font-semibold text-muted-foreground">{item.eventName}</p>}<p className="truncate font-mono text-xs font-semibold">{item.cashfreeOrderId || "Cashfree order pending"}</p><p className="mt-1 text-sm font-bold tabular-nums">{money(item.amountPaise)}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${badge[item.status] || "bg-slate-100 text-slate-700"}`}>{labels[item.status] || item.status}</span></div><div className="mt-3 grid grid-cols-2 gap-3 text-xs"><p className="text-muted-foreground">Payment ID<br /><span className="font-mono text-foreground">{item.cashfreePaymentIds[0] || "—"}</span></p><p className="text-muted-foreground">Registration<br /><span className="font-mono text-foreground">{item.registrationReferences[0] || "—"}</span></p></div>{item.needsAttention && <p className="mt-3 flex gap-1.5 text-xs text-amber-800"><AlertTriangle className="h-4 w-4 shrink-0" />{item.resolution?.reason || "This payment needs an admin review."}</p>}</article>)}</div>
    </>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3"><p className="text-sm text-muted-foreground">{total} payment {total === 1 ? "record" : "records"} · Page {page}</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 1 || loading} onClick={() => onPage(page - 1)}><ArrowLeft className="mr-1 h-4 w-4" />Previous</Button><Button size="sm" variant="outline" disabled={page * 25 >= total || loading} onClick={() => onPage(page + 1)}>Next<ArrowRight className="ml-1 h-4 w-4" /></Button></div></div>
  </section>;
}
