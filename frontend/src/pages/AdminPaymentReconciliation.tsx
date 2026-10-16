import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, RefreshCw, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, downloadApiFile } from "@/lib/api";

type Entry = {
  registration_id: string; registration_reference: string | null; registration_status: string;
  participant_name: string; event_id: string; event_name: string; organizer_name: string;
  checkout_id: string; provider_order_id: string | null; payment_ids: string[];
  environment: string; created_at: string; ledger_status: string; checkout_status: string;
  amount_paise: number | null; fee_paise: number; collected_paise: number | null; refund_paise: number | null;
  resolution_reason: string | null; resolution_status: string | null; resolution_refund_id: string | null;
  receipts: { paymentId: string; amountPaise: number; disposition: string; createdAt: string }[];
  refunds: { id: string; providerRefundId: string | null; status: string; providerStatus: string | null; amountPaise: number | null; requestedAt: string; refundedAt: string | null }[];
};
type Report = { items: Entry[]; total: number; page: number; pageSize: number;
  summary: { collectedPaise: number; refundedPaise: number; attentionCount: number } };
const statuses: Record<string, string> = { all: "All statuses", successful: "Collected", awaiting: "Awaiting payment", needs_review: "Needs review", refund_in_progress: "Refund in progress", refunded: "Refunded", partially_refunded: "Partly refunded", expired: "Expired", failed: "Failed", cancelled: "Cancelled", not_required: "Payment not required" };
const money = (value: number | null) => value === null ? "Unavailable" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value / 100);
const date = (value: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`));
const control = "h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm";

export default function AdminPaymentReconciliation() {
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [eventId, setEventId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("all");
  const [environment, setEnvironment] = useState("production");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => { setSubmittedSearch(search.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const filters = new URLSearchParams({ search: submittedSearch, status, environment });
  if (eventId) filters.set("event_id", eventId);
  if (from) filters.set("date_from", from);
  if (to) filters.set("date_to", to);
  const filterKey = filters.toString();
  const invalidDates = Boolean(from && to && from > to);
  const report = useQuery({ queryKey: ["admin-cashfree-ledger", filterKey, page],
    queryFn: ({ signal }) => apiRequest<Report>(`/admin/cashfree-ledger?${filterKey}&page=${page}`, { signal }),
    enabled: !invalidDates });
  const events = useQuery({ queryKey: ["admin-cashfree-ledger-events"],
    queryFn: ({ signal }) => apiRequest<{ items: { id: string; name: string; organizer: string }[] }>("/admin/cashfree-ledger/events", { signal }) });
  const change = (setter: (value: string) => void) => (value: string) => { setter(value); setPage(1); setExportError(""); };
  const clear = () => { setSearch(""); setSubmittedSearch(""); setEventId(""); setFrom(""); setTo(""); setStatus("all"); setEnvironment("production"); setPage(1); };
  const exportCsv = async () => {
    setExporting(true); setExportError("");
    try { await downloadApiFile(`/admin/cashfree-ledger/export?${filterKey}`, "cashfree-registration-ledger.csv"); }
    catch (error) { setExportError(error instanceof Error ? error.message : "Export failed. Try again."); }
    finally { setExporting(false); }
  };
  const data = invalidDates ? undefined : report.data;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 25));
  const metrics = [["Registrations", data?.total.toLocaleString()], ["Verified collections", data && money(data.summary.collectedPaise)], ["Completed refunds", data && money(data.summary.refundedPaise)], ["Needs attention", data?.summary.attentionCount.toLocaleString()]];
  return <AdminDashboardLayout><div className="mx-auto max-w-[1500px] space-y-5 px-4 py-6 sm:px-6 lg:px-8">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Finance workspace</p><h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Cashfree ledger</h1><p className="mt-2 text-sm text-muted-foreground">Every event registration, its payment references, and refund history in one place.</p></div>
      <div className="flex gap-2"><Button variant="outline" disabled={report.isFetching || invalidDates} onClick={() => void report.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button><Button disabled={exporting || invalidDates || !data || report.isFetching || submittedSearch !== search.trim()} onClick={() => void exportCsv()}><Download className="mr-2 h-4 w-4" />{exporting ? "Exporting…" : "Export CSV"}</Button></div>
    </div>
    <section aria-label="Ledger filters" className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
      <label className="block space-y-1.5 text-xs font-semibold">Search references or participant<div className="flex items-center gap-2 rounded-md border bg-background px-3"><Search className="h-4 w-4 shrink-0 text-muted-foreground" /><input className="h-10 w-full min-w-0 bg-transparent text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="Name, registration, Cashfree order, payment or refund ID" value={search} onChange={e => setSearch(e.target.value)} /></div></label>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="space-y-1.5 text-xs font-semibold">Event<select className={control} value={eventId} onChange={e => change(setEventId)(e.target.value)}><option value="">All events</option>{events.data?.items.map(event => <option key={event.id} value={event.id}>{event.name} · {event.organizer}</option>)}</select></label>
        <label className="space-y-1.5 text-xs font-semibold">From date (IST)<Input type="date" value={from} onChange={e => change(setFrom)(e.target.value)} /></label>
        <label className="space-y-1.5 text-xs font-semibold">To date (IST)<Input type="date" value={to} min={from || undefined} onChange={e => change(setTo)(e.target.value)} /></label>
        <label className="space-y-1.5 text-xs font-semibold">Payment status<select className={control} value={status} onChange={e => change(setStatus)(e.target.value)}>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="space-y-1.5 text-xs font-semibold">Environment<select className={control} value={environment} onChange={e => change(setEnvironment)(e.target.value)}><option value="production">Live payments</option><option value="sandbox">Sandbox payments</option><option value="all">Live + sandbox</option></select></label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">Dates filter checkout creation time in IST. Totals and CSV cover all matching registrations.</p><button className="text-xs font-semibold text-primary hover:underline" onClick={clear}>Clear filters</button></div>
      {events.isError && <p role="alert" className="text-sm text-destructive">Could not load event options. <button className="underline" onClick={() => void events.refetch()}>Retry</button></p>}
    </section>
    {(invalidDates || report.isError || exportError) && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{invalidDates ? "Choose an end date on or after the start date." : exportError || report.error?.message}</p>}
    {environment !== "production" && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{environment === "sandbox" ? "Showing test payments only." : "Totals include live and test payments."} Use Live payments for financial reconciliation.</p>}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{metrics.map(([label, value]) => <div key={label} className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 break-words text-xl font-bold tabular-nums sm:text-2xl">{value ?? "—"}</p></div>)}</div>
    <section aria-label="Cashfree registration ledger" className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3"><h2 className="font-bold">Registration ledger</h2><span className="text-xs text-muted-foreground">One row per registration · amounts in INR</span></div>
      <div className="hidden grid-cols-[1.2fr_1fr_1fr_1.3fr_1fr] gap-4 border-b bg-muted/40 px-4 py-3 text-xs font-semibold text-muted-foreground lg:grid"><span>Registration / participant</span><span>Event / date</span><span>Payment status</span><span>Cashfree references</span><span>Amounts</span></div>
      {report.isFetching && <p role="status" className="p-10 text-center text-sm text-muted-foreground">Loading ledger…</p>}
      {!report.isFetching && !report.isError && data?.items.length === 0 && <div className="p-10 text-center"><p className="font-semibold">No registrations match these filters</p><p className="mt-1 text-sm text-muted-foreground">Change the event, date range, or payment status.</p></div>}
      {!report.isFetching && !report.isError && data?.items.map(row => <article key={`${row.checkout_id}-${row.registration_id}`} className="border-b last:border-b-0">
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1.3fr_1fr]">
          <div className="min-w-0"><p className="break-all font-mono text-xs font-semibold">{row.registration_reference || row.registration_id}</p><p className="mt-1 text-sm font-medium">{row.participant_name}</p><p className="mt-1 text-xs capitalize text-muted-foreground">Registration: {row.registration_status}</p></div>
          <div><Link className="text-sm font-semibold hover:text-primary hover:underline" to={`/organizer/events/${row.event_id}/finance`}>{row.event_name}</Link><p className="text-xs text-muted-foreground">{row.organizer_name}</p><p className="mt-1 text-xs text-muted-foreground">{date(row.created_at)} IST</p></div>
          <div><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${row.ledger_status === "successful" ? "bg-emerald-100 text-emerald-800" : ["needs_review", "refund_in_progress", "failed"].includes(row.ledger_status) ? "bg-amber-100 text-amber-900" : "bg-muted text-muted-foreground"}`}>{statuses[row.ledger_status] || row.ledger_status}</span>{row.environment !== "production" && <p className="mt-2 text-xs font-semibold text-amber-700">Sandbox</p>}</div>
          <div className="min-w-0 space-y-1 break-all font-mono text-xs"><p><span className="font-sans text-muted-foreground">Order: </span>{row.provider_order_id || "Not assigned"}</p><p><span className="font-sans text-muted-foreground">Payment: </span>{row.payment_ids.join(", ") || "No verified receipt"}</p></div>
          <div className="text-xs tabular-nums"><p className="text-base font-bold">{money(row.amount_paise)}</p><p className="mt-1 text-muted-foreground">Fee {money(row.fee_paise)}</p><p className="text-muted-foreground">Refunded {money(row.refund_paise)}</p></div>
        </div>
        <details className="px-4 pb-4 text-xs"><summary className="w-fit cursor-pointer font-semibold text-primary">Payment & refund details</summary><div className="mt-3 space-y-2 rounded-lg bg-muted/30 p-3">
          <p className="break-all">SportPass checkout: {row.checkout_id} · Recorded payment state: {row.checkout_status}</p>
          {row.receipts.map(receipt => <p key={receipt.paymentId} className="break-all">Receipt {receipt.paymentId} · {money(receipt.amountPaise)} (whole checkout) · {receipt.disposition} · {date(receipt.createdAt)} IST</p>)}
          {!row.receipts.length && <p>No verified Cashfree receipt has been recorded.</p>}
          {row.refunds.map(refund => <p key={refund.id} className="break-all">Refund {refund.providerRefundId || refund.id} · {refund.status}{refund.providerStatus ? ` / ${refund.providerStatus}` : ""} · {money(refund.amountPaise)} · Requested {date(refund.requestedAt)}{refund.refundedAt ? ` · Completed ${date(refund.refundedAt)}` : ""} IST</p>)}
          {row.resolution_status && <p className="break-all">Admin resolution: {row.resolution_status} · {row.resolution_reason} {row.resolution_refund_id ? ` · Refund ${row.resolution_refund_id}` : ""}</p>}
          {!row.refunds.length && !row.resolution_status && <p>No refunds or admin resolutions recorded.</p>}
          <Link className="inline-block font-semibold text-primary hover:underline" to="/admin/refunds">Open payment reviews & refunds →</Link>
        </div></details>
      </article>)}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{data?.total ?? 0} registrations · Page {page} of {pages}</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1 || report.isFetching} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={!data || page >= pages || report.isFetching} onClick={() => setPage(page + 1)}>Next</Button></div></div>
    </section>
    <p className="text-xs leading-5 text-muted-foreground">This ledger covers event registrations recorded in SportPass. Individual failed gateway attempts and Cashfree bank settlements are available in the Cashfree dashboard. <Link to="/admin/settlements" className="font-semibold text-primary hover:underline">View organizer payouts →</Link></p>
  </div></AdminDashboardLayout>;
}
