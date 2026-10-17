import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { OrganizerWorkspaceTabs } from "@/components/OrganizerWorkspaceTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, downloadApiFile } from "@/lib/api";
import OrganizerRefunds from "./OrganizerRefunds";

type Overview = { events: { id: string; name: string; paymentMode: string }[];
  summary: { organizerPayablePaise: number; settledAmountPaise: number; outstandingAmountPaise: number; pendingSettlementPaise: number };
  payouts: { id: string; eventName: string; amountPaise: number; status: string; reference: string | null; date: string; method: string }[] };
type Ledger = { total: number; summary: { collectedPaise: number; refundedPaise: number }; items: {
  registration_id: string; registration_reference: string | null; participant_name: string; event_name: string;
  ledger_status: string; amount_paise: number | null; fee_paise: number; refund_paise: number;
  created_at: string; provider_order_id: string | null; payment_ids: string[];
}[] };
const money = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value / 100);
const statuses = { all: "All statuses", successful: "Collected", awaiting: "Awaiting payment", needs_review: "Needs review", refund_in_progress: "Refund in progress", refunded: "Refunded", partially_refunded: "Partly refunded", expired: "Expired", failed: "Failed" };
const selectClass = "h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm";

export function OrganizerFinanceRedirect({ refunds = false }: { refunds?: boolean }) {
  const { eventId } = useParams();
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  if (eventId) next.set("event_id", eventId);
  if (refunds) next.set("tab", "refunds");
  return <Navigate replace to={`/organizer/payments?${next}`} />;
}

export default function OrganizerPayments() {
  const [params, setParams] = useSearchParams();
  const eventId = params.get("event_id") || "";
  const tab = params.get("tab") || "collections";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const invalidDates = Boolean(from && to && from > to);
  const filters = new URLSearchParams({ search, status });
  if (eventId) filters.set("event_id", eventId);
  if (from) filters.set("date_from", from);
  if (to) filters.set("date_to", to);
  const key = filters.toString();
  const overview = useQuery({ queryKey: ["organizer-payments-overview", eventId],
    queryFn: ({ signal }) => apiRequest<Overview>(`/organizer/payments/overview${eventId ? `?event_id=${eventId}` : ""}`, { signal }) });
  const ledger = useQuery({ queryKey: ["organizer-payments", key, page], enabled: tab === "collections" && !invalidDates,
    queryFn: ({ signal }) => apiRequest<Ledger>(`/organizer/payments?${key}&page=${page}`, { signal }) });
  const changeParam = (name: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(name, value); else next.delete(name); setParams(next); setPage(1); };
  const exportCsv = async () => { setExporting(true); setExportError(""); try { await downloadApiFile(`/organizer/payments/export?${key}`, "event-payments.csv"); } catch (error) { setExportError(error instanceof Error ? error.message : "Export failed"); } finally { setExporting(false); } };
  const summary = overview.data?.summary;
  const selected = overview.data?.events.find(e => e.id === eventId);
  return <OrganizerDashboardLayout showNavigation={false}><div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
    <OrganizerWorkspaceTabs />
    <header><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Organizer workspace</p><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Payments & Settlements</h1><p className="mt-2 text-sm text-muted-foreground">Track participant payments, manage refunds, and see payouts to your organization.</p></header>
    <div className="flex flex-wrap items-end gap-3"><label className="w-full space-y-1 text-sm font-medium sm:w-80">Event<select className={selectClass} value={eventId} onChange={e => changeParam("event_id", e.target.value)}><option value="">All my events</option>{overview.data?.events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label><Button variant="outline" onClick={() => { void overview.refetch(); void ledger.refetch(); }}>Refresh</Button>{eventId && <Button asChild variant="ghost"><Link to={`/organizer/events/${eventId}`}>Event overview</Link></Button>}</div>
    {overview.isError && <p role="alert" className="text-sm text-destructive">{overview.error.message}</p>}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Net payable", money(summary?.organizerPayablePaise)], ["Paid out", money(summary?.settledAmountPaise)], ["Outstanding", money(summary?.outstandingAmountPaise)], ["Payout pending", money(summary?.pendingSettlementPaise)]].map(([label, value]) => <div key={label} className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-xl font-bold tabular-nums">{value}</p></div>)}</div>
    <p className="text-xs text-muted-foreground">Balances cover all dates for the selected event(s), using live Cashfree collections, completed refunds and recorded payout adjustments. Direct UPI payments go to you and are excluded from these balances.</p>
    {selected?.paymentMode === "DIRECT_UPI" && <p className="rounded-lg border bg-card p-3 text-sm">This event collects payments directly. <Link className="font-semibold text-primary" to={`/organizer/registrations?event_id=${eventId}&status=all`}>Review its UPI payments in registrations.</Link></p>}
    <nav aria-label="Payment sections" className="flex gap-2 overflow-x-auto border-b pb-2">{[["collections", "Collections"], ["refunds", "Refunds"], ["payouts", "Payout history"]].map(([value, label]) => <Button key={value} variant={tab === value ? "default" : "ghost"} onClick={() => changeParam("tab", value)}>{label}</Button>)}</nav>
    {tab === "refunds" ? <OrganizerRefunds key={eventId} embedded /> : tab === "payouts" ? <section className="divide-y rounded-xl border bg-card"><h2 className="p-4 font-semibold">Payout history</h2>{overview.isLoading ? <p className="p-4">Loading payouts…</p> : overview.data?.payouts.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No payouts recorded yet.</p> : overview.data?.payouts.map(payout => <article key={payout.id} className="flex flex-wrap justify-between gap-3 p-4"><div><p className="font-semibold">{payout.eventName}</p><p className="mt-1 text-xs text-muted-foreground">{payout.date} · {payout.method.replaceAll("_", " ")}</p><p className="mt-1 break-all text-xs">Reference: {payout.reference || "Pending"}</p></div><div className="text-right"><p className="font-bold">{money(payout.amountPaise)}</p><p className="text-xs">{payout.status}</p></div></article>)}</section> : <>
      <section className="space-y-4 rounded-xl border bg-card p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="space-y-1 text-xs font-semibold">Search<Input value={search} placeholder="Name, registration or payment ID" onChange={e => { setSearch(e.target.value); setPage(1); }} /></label><label className="space-y-1 text-xs font-semibold">Status<select className={selectClass} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="space-y-1 text-xs font-semibold">From date (IST)<Input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label><label className="space-y-1 text-xs font-semibold">To date (IST)<Input type="date" min={from || undefined} value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Dates filter checkout creation time. Export includes all matching pages.</p><Button disabled={exporting || invalidDates || ledger.isFetching || !ledger.data || ledger.isError} variant="outline" onClick={() => void exportCsv()}>{exporting ? "Exporting…" : "Export CSV"}</Button></div></section>
      {(invalidDates || ledger.isError || exportError) && <p role="alert" className="text-sm text-destructive">{invalidDates ? "End date must be on or after start date." : exportError || ledger.error?.message}</p>}
      <section className="overflow-hidden rounded-xl border bg-card"><div className="flex flex-wrap justify-between gap-2 border-b p-4"><h2 className="font-semibold">Cashfree collections</h2><p className="text-xs text-muted-foreground">Filtered collected: {money(ledger.data?.summary.collectedPaise)} · Refunded: {money(ledger.data?.summary.refundedPaise)}</p></div>
      {ledger.isFetching ? <p className="p-8 text-center text-sm">Loading collections…</p> : !invalidDates && !ledger.isError && ledger.data?.items.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">No live Cashfree payments match these filters.</p> : !invalidDates && !ledger.isError && ledger.data?.items.map(row => <article key={row.registration_id} className="grid gap-3 border-b p-4 sm:grid-cols-[1fr_1fr_auto]"><div><p className="font-semibold">{row.participant_name}</p><p className="mt-1 text-xs text-muted-foreground">{row.event_name}</p><p className="mt-1 break-all font-mono text-xs">{row.registration_reference || row.registration_id}</p></div><div className="min-w-0 break-all text-xs"><p>Order: {row.provider_order_id || "Pending"}</p><p className="mt-1">Payment: {row.payment_ids.join(", ") || "Awaiting receipt"}</p><p className="mt-1 text-muted-foreground">{new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(row.created_at) ? row.created_at : `${row.created_at}Z`).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p></div><div><p className="font-bold">{money(row.amount_paise)}</p><p className="text-xs text-muted-foreground">Fee {money(row.fee_paise)} · refund {money(row.refund_paise)}</p><span className="mt-2 inline-block rounded-full bg-muted px-2 py-1 text-xs">{statuses[row.ledger_status as keyof typeof statuses] || row.ledger_status}</span></div></article>)}
      <div className="flex flex-wrap justify-between gap-3 p-3"><p className="text-xs text-muted-foreground">{ledger.data?.total ?? 0} registrations · Page {page}</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 1 || ledger.isFetching} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={!ledger.data || page * 25 >= ledger.data.total || ledger.isFetching} onClick={() => setPage(page + 1)}>Next</Button></div></div></section>
    </>}
  </div></OrganizerDashboardLayout>;
}
