import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Landmark, ShieldCheck } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Button } from "@/components/ui/button";
import { FinanceSummary, PaymentAuditTable, type PaymentAuditRow, type PaymentAuditSummary } from "@/components/PaymentAuditTable";
import { apiRequest, downloadApiFile } from "@/lib/api";

type Settlement = { organizerPayablePaise: number; settledAmountPaise: number; outstandingAmountPaise: number; grossCollectionsPaise: number; refundsPaise: number };
type Response = { event: { id: string; name: string; paymentMode: string }; settlement: Settlement; payments: { items: PaymentAuditRow[]; total: number; page: number; summary: PaymentAuditSummary } };
const emptySummary: PaymentAuditSummary = { paymentCount: 0, grossCollectedPaise: 0, refundedPaise: 0, needsAttentionCount: 0, awaitingCount: 0 };

export default function OrganizerEventFinance() {
  const { eventId = "" } = useParams(); const navigate = useNavigate();
  const [data, setData] = useState<Response | null>(null); const [search, setSearch] = useState(""); const [status, setStatus] = useState("all"); const [page, setPage] = useState(1); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const load = useCallback(async () => { if (!eventId) return; setLoading(true); setError(""); try { const query = new URLSearchParams({ search, status, page: String(page) }); setData(await apiRequest<Response>(`/organizer/events/${eventId}/finance?${query}`)); } catch (err) { setError(err instanceof Error ? err.message : "Could not load event finances."); } finally { setLoading(false); } }, [eventId, page, search, status]);
  useEffect(() => { const timeout = window.setTimeout(() => void load(), search ? 250 : 0); return () => window.clearTimeout(timeout); }, [load, search]);
  const report = data?.payments; const summary = report?.summary ?? emptySummary; const settlement = data?.settlement;
  const exportCsv = () => { const query = new URLSearchParams({ search, status }); void downloadApiFile(`/organizer/events/${eventId}/finance/export?${query}`, "event-payment-audit.csv").catch(err => setError(err instanceof Error ? err.message : "Could not download CSV.")); };
  return <OrganizerDashboardLayout eventId={eventId}><div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><Button variant="ghost" className="-ml-2 gap-2 px-2 text-muted-foreground" onClick={() => navigate(`/organizer/events/${eventId}`)}><ArrowLeft className="h-4 w-4" />Event overview</Button><p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-primary">Event finance</p><h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">{data?.event.name || "Event finances"}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Your verified collections, refunds, and the amount recorded as payable to your organization.</p></div><div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-950"><Landmark className="mr-2 inline h-4 w-4 text-emerald-700" /><span className="font-semibold">Read-only payment evidence.</span> Payouts are recorded by SportPass after bank or UPI confirmation.</div></div>
    <FinanceSummary summary={summary} organizer={{ payable: settlement?.organizerPayablePaise ?? 0, settled: settlement?.settledAmountPaise ?? 0, outstanding: settlement?.outstandingAmountPaise ?? 0 }} />
    {summary.needsAttentionCount > 0 && <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">{summary.needsAttentionCount} payment {summary.needsAttentionCount === 1 ? "needs" : "need"} SportPass review</p><p className="mt-1 text-amber-900/80">No action is required from you unless the SportPass team contacts you. The full reference is visible below.</p></div></div>}
    {error && <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
    <PaymentAuditTable items={report?.items ?? []} total={report?.total ?? 0} page={page} loading={loading} search={search} status={status} onSearch={value => { setSearch(value); setPage(1); }} onStatus={value => { setStatus(value); setPage(1); }} onPage={setPage} onRefresh={() => void load()} onExport={exportCsv} />
    <p className="text-xs leading-5 text-muted-foreground">“Payable” is calculated from verified production collections, minus applicable SportPass fees and completed refunds, plus any recorded correction. It is not a bank-transfer confirmation.</p>
  </div></OrganizerDashboardLayout>;
}
