import { useEffect, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";

import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { apiRequest } from "@/lib/api";
import { CashfreePaymentReviews, PaymentAuditHistory, type AuditEntry } from "@/components/CashfreePaymentReviews";

interface RefundRecord {
  id: string;
  registrationId: string;
  eventId: string;
  paymentMethod: string;
  paymentProvider: string;
  originalRegistrationAmount: number;
  originalPlatformFee: number;
  originalTotalPaid: number;
  requestedRefundAmount: number;
  approvedRefundAmount: number | null;
  refundReason: string;
  participantComments: string | null;
  organizerComments: string | null;
  status: string;
  refundUtr: string | null;
  providerRefundId?: string | null;
  providerRefundStatus?: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  refundedAt: string | null;
  confirmedAt: string | null;
  event: { id: string; name: string } | null;
  participant: { id: string; name: string; email: string | null; phone: string | null } | null;
  organization: { id: string; name: string } | null;
  registration: { id: string; registrationReference: string; ticket: { name: string } | null } | null;
}

const STATUS_LABELS: Record<string, string> = {
  REQUESTED: "Requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PROCESSING: "Processing",
  REFUND_SENT: "Sent",
  REFUNDED: "Refunded",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

function statusBadge(status: string) {
  const variants: Record<string, string> = {
    REQUESTED: "bg-amber-100 text-amber-800 border-amber-200",
    APPROVED: "bg-blue-100 text-blue-800 border-blue-200",
    REJECTED: "bg-red-100 text-red-800 border-red-200",
    REFUND_SENT: "bg-purple-100 text-purple-800 border-purple-200",
    REFUNDED: "bg-green-100 text-green-800 border-green-200",
    FAILED: "bg-red-100 text-red-800 border-red-200",
    CANCELLED: "bg-slate-100 text-slate-700 border-slate-200",
  };
  const cls = variants[status] ?? "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function refundBadge(refund: RefundRecord) {
  if (refund.paymentProvider === "CASHFREE" && refund.status === "APPROVED" &&
      (refund.providerRefundStatus === "REJECTED" || refund.providerRefundStatus === "CANCELLED")) {
    return <span className="inline-flex rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">Needs resolution</span>;
  }
  return statusBadge(refund.status);
}

function fmt(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function DetailDrawer({ refund, onClose, onUpdated }: { refund: RefundRecord; onClose: () => void; onUpdated: (updated: RefundRecord) => void }) {
  const amount = refund.approvedRefundAmount ?? refund.requestedRefundAmount;
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setHistory([]); setHistoryError(null);
    void apiRequest<{ items: AuditEntry[] }>(`/admin/refunds/${refund.id}/history`)
      .then(data => { if (active) setHistory(data.items); })
      .catch(() => { if (active) setHistoryError("Could not load the audit history"); });
    return () => { active = false; };
  }, [refund]);
  const runCashfreeRefund = async () => {
    if (processing) return;
    setProcessing(true); setActionError(null);
    try {
      const action = refund.providerRefundStatus === "CANCELLED" || refund.providerRefundStatus === "REJECTED"
        ? "reconcile" : "process";
      await apiRequest(`/admin/refunds/${refund.id}/cashfree/${action}`, { method: "POST" });
      onUpdated(await apiRequest<RefundRecord>(`/admin/refunds/${refund.id}`));
    } catch (error) { setActionError(error instanceof Error ? error.message : "Cashfree refund could not be checked"); }
    finally { setProcessing(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Refund detail</p>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{refund.id}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-5 p-5 text-sm">
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</p>
            {refundBadge(refund)}
          </section>
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Participant</p>
            <p className="font-semibold">{refund.participant?.name}</p>
            {refund.participant?.email && <p className="text-muted-foreground">{refund.participant.email}</p>}
            {refund.participant?.phone && <p className="text-muted-foreground">{refund.participant.phone}</p>}
          </section>
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Organizer</p>
            <p>{refund.organization?.name}</p>
          </section>
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Event</p>
            <p>{refund.event?.name}</p>
            <p className="text-xs text-muted-foreground font-mono">{refund.registration?.registrationReference}</p>
          </section>
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Amounts</p>
            <div className="space-y-1 rounded-lg border bg-muted/20 p-3">
              <div className="flex justify-between"><span className="text-muted-foreground">Registration fee</span><span>{fmt(refund.originalRegistrationAmount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">SportPass fee</span><span>{fmt(refund.originalPlatformFee)}</span></div>
              <div className="flex justify-between border-t pt-1 font-semibold"><span>Total paid</span><span>{fmt(refund.originalTotalPaid)}</span></div>
              <div className="flex justify-between text-primary font-bold border-t pt-1"><span>Refund amount</span><span>{fmt(amount)}</span></div>
            </div>
          </section>
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Reason</p>
            <p>{refund.refundReason}</p>
            {refund.participantComments && <p className="mt-1 text-muted-foreground">{refund.participantComments}</p>}
          </section>
          {refund.organizerComments && (
            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Organizer note</p>
              <p>{refund.organizerComments}</p>
            </section>
          )}
          {refund.refundUtr && (
            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">UTR / Reference</p>
              <p className="font-mono">{refund.refundUtr}</p>
            </section>
          )}
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Timeline</p>
            <div className="space-y-1 text-muted-foreground">
              <p>Requested: {fmtDate(refund.requestedAt)}</p>
              {refund.reviewedAt && <p>Reviewed: {fmtDate(refund.reviewedAt)}</p>}
              {refund.refundedAt && <p>Sent: {fmtDate(refund.refundedAt)}</p>}
              {refund.confirmedAt && <p>Confirmed: {fmtDate(refund.confirmedAt)}</p>}
            </div>
          </section>
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Provider</p>
            <p>{refund.paymentProvider} · {refund.paymentMethod}</p>
            {refund.providerRefundStatus && <p>Cashfree status: {refund.providerRefundStatus}</p>}
            {refund.providerRefundId && <p className="font-mono text-xs">{refund.providerRefundId}</p>}
            {refund.paymentProvider === "CASHFREE" && refund.status === "APPROVED" && (
              refund.providerRefundStatus === "CANCELLED" || refund.providerRefundStatus === "REJECTED" ?
              <p className="mt-2 text-sm text-destructive">Cashfree did not complete this refund. Recheck its final status before arranging a separate resolution; this screen will not issue a second payment.</p> : null
            )}
            {refund.paymentProvider === "CASHFREE" && refund.status === "APPROVED" && (
              <Button className="mt-3" disabled={processing} onClick={() => void runCashfreeRefund()}>
                {processing ? "Checking…" : refund.providerRefundStatus === "CANCELLED" || refund.providerRefundStatus === "REJECTED" ? "Recheck Cashfree status" : refund.providerRefundId ? "Resume / check Cashfree refund" : `Issue Cashfree refund ${fmt(amount)}`}
              </Button>
            )}
            {actionError && <p className="mt-2 text-destructive">{actionError}</p>}
          </section>
          <section><p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Audit history</p>
            {historyError ? <p className="text-destructive">{historyError}</p> : <PaymentAuditHistory items={history} />}</section>
        </div>
      </div>
    </div>
  );
}

const AdminRefunds = () => {
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [organizerFilter, setOrganizerFilter] = useState("all");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterOptions, setFilterOptions] = useState<{ events: { id: string; name: string }[]; organizers: { id: string; name: string }[] }>({ events: [], organizers: [] });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<RefundRecord | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void apiRequest<typeof filterOptions>(`/admin/refunds/filter-options?search=${encodeURIComponent(filterSearch)}`)
        .then((data) => { if (active) setFilterOptions(data); })
        .catch(() => { if (active) setFilterOptions({ events: [], organizers: [] }); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [filterSearch]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("refund_status", statusFilter);
    if (eventFilter !== "all") params.set("event_id", eventFilter);
    if (organizerFilter !== "all") params.set("organizer_id", organizerFilter);
    if (cursor) params.set("cursor", cursor);
    params.set("limit", "50");

    setLoading(true);
    setError(null);
    void apiRequest<{ refunds: RefundRecord[]; hasMore: boolean; nextCursor: string | null }>(
      `/admin/refunds?${params}`
    )
      .then((data) => {
        setRefunds(data.refunds);
        setNextCursor(data.nextCursor);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load refunds"))
      .finally(() => setLoading(false));
  }, [statusFilter, eventFilter, organizerFilter, cursor, reloadKey]);

  const goPrev = () => {
    setCursor(cursorHistory[cursorHistory.length - 1] ?? null);
    setCursorHistory((h) => h.slice(0, -1));
  };
  const goNext = () => {
    if (!nextCursor) return;
    setCursorHistory((h) => [...h, cursor ?? ""]);
    setCursor(nextCursor);
  };

  return (
    <AdminDashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Refunds</h1>
            <p className="mt-1 text-sm text-muted-foreground">Audit trail for all refund requests across SportPass.</p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => { setCursor(null); setReloadKey((value) => value + 1); }}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>

        <CashfreePaymentReviews reloadKey={reloadKey} />

        {/* Filters */}
        <div className="flex flex-wrap gap-3 rounded-xl border bg-card p-4">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Status</p>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCursor(null); setCursorHistory([]); }}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Find event or organizer</p>
            <Input className="w-56" value={filterSearch} onChange={(event) => setFilterSearch(event.target.value)} placeholder="Search names" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Organizer</p>
            <Select value={organizerFilter} onValueChange={(value) => { setOrganizerFilter(value); setCursor(null); setCursorHistory([]); }}>
              <SelectTrigger className="w-56"><SelectValue placeholder="All organizers" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All organizers</SelectItem>
                {filterOptions.organizers.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Event</p>
            <Select value={eventFilter} onValueChange={(value) => { setEventFilter(value); setCursor(null); setCursorHistory([]); }}>
              <SelectTrigger className="w-56"><SelectValue placeholder="All events" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All events</SelectItem>
                {filterOptions.events.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border bg-card">
          {loading ? (
            <div className="p-12 text-center text-muted-foreground">Loading…</div>
          ) : error ? (
            <div className="flex items-center gap-2 p-8 text-destructive"><AlertCircle className="h-4 w-4" />{error}</div>
          ) : refunds.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">No refunds found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Participant</th>
                    <th className="px-4 py-3 text-left font-semibold">Organizer</th>
                    <th className="px-4 py-3 text-left font-semibold">Event</th>
                    <th className="px-4 py-3 text-left font-semibold">Method</th>
                    <th className="px-4 py-3 text-right font-semibold">Paid</th>
                    <th className="px-4 py-3 text-right font-semibold">Refund</th>
                    <th className="px-4 py-3 text-left font-semibold">Requested</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b cursor-pointer hover:bg-muted/40 transition-colors last:border-0"
                      onClick={() => setDetail(r)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">{r.participant?.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{r.registration?.registrationReference}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{r.organization?.name}</td>
                      <td className="px-4 py-3 max-w-[160px]"><p className="truncate">{r.event?.name}</p></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{r.paymentProvider === "DIRECT_UPI" ? "Direct UPI" : r.paymentProvider}</td>
                      <td className="px-4 py-3 text-right font-semibold">{fmt(r.originalTotalPaid)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-primary">{fmt(r.approvedRefundAmount ?? r.requestedRefundAmount)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(r.requestedAt)}</td>
                      <td className="px-4 py-3">{refundBadge(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Showing up to 50 refunds per page.</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={goPrev} disabled={cursorHistory.length === 0 || loading}>
              <ChevronLeft className="mr-1 h-4 w-4" />Previous
            </Button>
            <Button variant="outline" size="sm" onClick={goNext} disabled={!nextCursor || loading}>
              Next<ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {detail && <DetailDrawer refund={detail} onClose={() => setDetail(null)} onUpdated={(updated) => { setDetail(updated); setReloadKey((value) => value + 1); }} />}
    </AdminDashboardLayout>
  );
};

export default AdminRefunds;
