import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  IndianRupee,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/api";

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
  platformFeeRefundAmount: number;
  refundReason: string;
  participantComments: string | null;
  organizerComments: string | null;
  status: string;
  refundUtr: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  refundedAt: string | null;
  confirmedAt: string | null;
  event: { id: string; name: string } | null;
  participant: { id: string; name: string; email: string | null; phone: string | null } | null;
  registration: { id: string; registrationReference: string; ticket: { name: string } | null } | null;
}

interface EventOption {
  id: string;
  name: string;
}

const STATUS_LABELS: Record<string, string> = {
  REQUESTED: "Requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PROCESSING: "Processing",
  REFUND_SENT: "Refund sent",
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
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{STATUS_LABELS[status] ?? status}</span>;
}

function formatPaise(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ── Review modal ─────────────────────────────────────────────────────────────
function ReviewModal({
  refund,
  onClose,
  onDone,
}: {
  refund: RefundRecord;
  onClose: () => void;
  onDone: (updated: RefundRecord) => void;
}) {
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [approvedAmount, setApprovedAmount] = useState(
    String((refund.requestedRefundAmount / 100).toFixed(2))
  );
  const [comments, setComments] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!decision) return;
    if (decision === "reject" && !comments.trim()) {
      toast.error("Rejection reason is required");
      return;
    }
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        decision,
        organizer_comments: comments.trim() || null,
      };
      if (decision === "approve") {
        payload.approved_amount_paise = Math.round(parseFloat(approvedAmount) * 100);
      }
      const updated = await apiRequest<RefundRecord>(`/organizer/refunds/${refund.id}/review`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast.success(decision === "approve" ? "Refund approved" : "Refund rejected");
      onDone(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit decision");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Review refund request</p>
            <p className="mt-0.5 text-sm font-semibold">{refund.participant?.name}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Summary */}
          <div className="rounded-xl border bg-muted/20 p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Event</span><span className="font-medium">{refund.event?.name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Reference</span><span className="font-mono">{refund.registration?.registrationReference}</span></div>
            <Separator />
            <div className="flex justify-between"><span className="text-muted-foreground">Registration fee paid</span><span>{formatPaise(refund.originalRegistrationAmount)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">SportPass fee paid</span><span>{formatPaise(refund.originalPlatformFee)}</span></div>
            <div className="flex justify-between font-semibold border-t pt-2"><span>Total paid</span><span>{formatPaise(refund.originalTotalPaid)}</span></div>
            <Separator />
            <div className="flex justify-between text-primary font-semibold"><span>Requested refund</span><span>{formatPaise(refund.requestedRefundAmount)}</span></div>
            <div className="flex flex-col gap-1"><span className="text-muted-foreground">Reason</span><span className="font-medium">{refund.refundReason}</span></div>
            {refund.participantComments && <div className="flex flex-col gap-1"><span className="text-muted-foreground">Comments</span><span className="text-sm">{refund.participantComments}</span></div>}
          </div>

          {/* Decision */}
          <div className="flex gap-2">
            <button
              onClick={() => setDecision("approve")}
              className={`flex-1 rounded-lg border py-2.5 text-sm font-semibold transition-colors ${decision === "approve" ? "border-green-500 bg-green-50 text-green-700" : "hover:bg-muted/50"}`}
            >✓ Approve</button>
            <button
              onClick={() => setDecision("reject")}
              className={`flex-1 rounded-lg border py-2.5 text-sm font-semibold transition-colors ${decision === "reject" ? "border-red-400 bg-red-50 text-red-700" : "hover:bg-muted/50"}`}
            >✗ Reject</button>
          </div>

          {decision === "approve" && (
            <div className="space-y-2">
              <Label className="text-xs">Approved refund amount (₹)</Label>
              <Input
                type="number"
                min={0}
                max={refund.originalTotalPaid / 100}
                step="0.01"
                value={approvedAmount}
                onChange={(e) => setApprovedAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Max: {formatPaise(refund.originalTotalPaid)}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs">{decision === "reject" ? "Rejection reason *" : "Note for participant (optional)"}</Label>
            <Textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder={decision === "reject" ? "Explain why the refund request is being declined..." : "Add a note..."}
              maxLength={1000}
              className="min-h-[70px] text-sm"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button
              className={`flex-1 ${decision === "reject" ? "bg-red-600 hover:bg-red-700" : ""}`}
              onClick={() => void submit()}
              disabled={!decision || loading}
            >
              {loading ? "Submitting…" : decision === "approve" ? "Approve refund" : decision === "reject" ? "Reject refund" : "Select a decision"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Mark sent modal ───────────────────────────────────────────────────────────
function MarkSentModal({
  refund,
  onClose,
  onDone,
}: {
  refund: RefundRecord;
  onClose: () => void;
  onDone: (updated: RefundRecord) => void;
}) {
  const [utr, setUtr] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!utr.trim()) { toast.error("UTR / transaction reference is required"); return; }
    setLoading(true);
    try {
      const updated = await apiRequest<RefundRecord>(`/organizer/refunds/${refund.id}/mark-sent`, {
        method: "POST",
        body: JSON.stringify({ refund_utr: utr.trim(), organizer_comments: notes.trim() || null }),
      });
      toast.success("Refund marked as sent");
      onDone(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark refund as sent");
    } finally {
      setLoading(false);
    }
  };

  const amount = refund.approvedRefundAmount ?? refund.requestedRefundAmount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <p className="font-bold">Process Refund — Direct UPI</p>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="rounded-xl border bg-muted/20 p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Participant</span><span className="font-medium">{refund.participant?.name}</span></div>
            {refund.participant?.email && <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span>{refund.participant.email}</span></div>}
            {refund.participant?.phone && <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span>{refund.participant.phone}</span></div>}
            <div className="flex justify-between font-semibold text-primary border-t pt-2"><span>Approved refund</span><span>{formatPaise(amount)}</span></div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-1">
            <p className="font-semibold">Important</p>
            <p>Please send {formatPaise(amount)} directly to the participant using your UPI or banking app. SportPass does not transfer this money on your behalf.</p>
            <p className="mt-1">Once sent, enter the UTR / transaction reference below.</p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">UTR / Transaction reference *</Label>
            <Input
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
              placeholder="e.g. 407312345678"
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Note (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className="min-h-[60px] text-sm" />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button className="flex-1" onClick={() => void submit()} disabled={loading}>
              {loading ? "Saving…" : "Mark refund sent"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────
function RefundDetailDrawer({ refund, onClose }: { refund: RefundRecord; onClose: () => void }) {
  const amount = refund.approvedRefundAmount ?? refund.requestedRefundAmount;
  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Refund details</p>
            <p className="mt-0.5 font-mono text-sm">{refund.registration?.registrationReference}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-5 p-5 text-sm">
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</p>
            <div className="flex items-center gap-2">{statusBadge(refund.status)}</div>
          </section>
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Participant</p>
            <p className="font-semibold">{refund.participant?.name}</p>
            {refund.participant?.email && <p className="text-muted-foreground">{refund.participant.email}</p>}
            {refund.participant?.phone && <p className="text-muted-foreground">{refund.participant.phone}</p>}
          </section>
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Event</p>
            <p>{refund.event?.name}</p>
          </section>
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Amounts</p>
            <div className="space-y-1 rounded-lg border bg-muted/20 p-3">
              <div className="flex justify-between"><span className="text-muted-foreground">Registration fee</span><span>{formatPaise(refund.originalRegistrationAmount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">SportPass fee</span><span>{formatPaise(refund.originalPlatformFee)}</span></div>
              <div className="flex justify-between border-t pt-1 font-semibold"><span>Total paid</span><span>{formatPaise(refund.originalTotalPaid)}</span></div>
              <div className="flex justify-between text-primary font-bold border-t pt-1"><span>Refund amount</span><span>{formatPaise(amount)}</span></div>
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
              <p>Requested: {formatDate(refund.requestedAt)}</p>
              {refund.reviewedAt && <p>Reviewed: {formatDate(refund.reviewedAt)}</p>}
              {refund.refundedAt && <p>Sent: {formatDate(refund.refundedAt)}</p>}
              {refund.confirmedAt && <p>Confirmed: {formatDate(refund.confirmedAt)}</p>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const OrganizerRefunds = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") ?? "all");
  const [eventFilter, setEventFilter] = useState(searchParams.get("event_id") ?? "all");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<RefundRecord | null>(null);
  const [markSentTarget, setMarkSentTarget] = useState<RefundRecord | null>(null);
  const [detailTarget, setDetailTarget] = useState<RefundRecord | null>(null);

  useEffect(() => {
    void apiRequest<EventOption[]>("/organizer/events")
      .then(setEvents)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("refund_status", statusFilter);
    if (eventFilter !== "all") params.set("event_id", eventFilter);
    if (cursor) params.set("cursor", cursor);
    params.set("limit", "50");

    setLoading(true);
    setError(null);
    void apiRequest<{ refunds: RefundRecord[]; hasMore: boolean; nextCursor: string | null }>(
      `/organizer/refunds?${params}`
    )
      .then((data) => {
        setRefunds(data.refunds);
        setNextCursor(data.nextCursor);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load refunds"))
      .finally(() => setLoading(false));
  }, [statusFilter, eventFilter, cursor]);

  const handleRefundUpdated = (updated: RefundRecord) => {
    setRefunds((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setReviewTarget(null);
    setMarkSentTarget(null);
  };

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
    <OrganizerDashboardLayout>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Refunds</h1>
            <p className="mt-1 text-sm text-muted-foreground">Review and process refund requests from participants.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setCursor(null)} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 rounded-xl border bg-card p-4">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Status</p>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCursor(null); }}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Event</p>
            <Select value={eventFilter} onValueChange={(v) => { setEventFilter(v); setCursor(null); }}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All events</SelectItem>
                {events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border bg-card">
          {loading ? (
            <div className="p-12 text-center text-muted-foreground">Loading refunds…</div>
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
                    <th className="px-4 py-3 text-left font-semibold">Event</th>
                    <th className="px-4 py-3 text-left font-semibold">Method</th>
                    <th className="px-4 py-3 text-right font-semibold">Paid</th>
                    <th className="px-4 py-3 text-right font-semibold">Refund</th>
                    <th className="px-4 py-3 text-left font-semibold">Requested</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b cursor-pointer hover:bg-muted/40 transition-colors last:border-0"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("button")) return;
                        setDetailTarget(r);
                      }}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">{r.participant?.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{r.registration?.registrationReference}</p>
                      </td>
                      <td className="px-4 py-3 max-w-[180px]">
                        <p className="truncate">{r.event?.name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground">{r.paymentProvider === "DIRECT_UPI" ? "Direct UPI" : r.paymentProvider}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{formatPaise(r.originalTotalPaid)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-primary">
                        {formatPaise(r.approvedRefundAmount ?? r.requestedRefundAmount)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(r.requestedAt)}</td>
                      <td className="px-4 py-3">{statusBadge(r.status)}</td>
                      <td className="px-4 py-3 text-right">
                        {r.status === "REQUESTED" && (
                          <Button size="sm" variant="outline" onClick={() => setReviewTarget(r)}>Review</Button>
                        )}
                        {r.status === "APPROVED" && (
                          <Button size="sm" onClick={() => setMarkSentTarget(r)}>Process refund</Button>
                        )}
                        {["REFUND_SENT", "REFUNDED", "REJECTED"].includes(r.status) && (
                          <Button size="sm" variant="ghost" onClick={() => setDetailTarget(r)}>View details</Button>
                        )}
                      </td>
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

      {reviewTarget && (
        <ReviewModal refund={reviewTarget} onClose={() => setReviewTarget(null)} onDone={handleRefundUpdated} />
      )}
      {markSentTarget && (
        <MarkSentModal refund={markSentTarget} onClose={() => setMarkSentTarget(null)} onDone={handleRefundUpdated} />
      )}
      {detailTarget && (
        <RefundDetailDrawer refund={detailTarget} onClose={() => setDetailTarget(null)} />
      )}
    </OrganizerDashboardLayout>
  );
};

export default OrganizerRefunds;
