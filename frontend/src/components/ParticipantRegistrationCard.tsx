import { useState } from "react";
import { Clock3, MapPin, MessageCircle, QrCode, Ticket, Trophy, X } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ParticipantRegistration } from "@/hooks/useParticipantRegistrations";
import { apiRequest } from "@/lib/api";
import { formatRegistrationAmount, formatRegistrationDate, registrationStatusDetails } from "@/lib/registration-format";

export function RegistrationStatusBadge({ status }: { status: string }) {
  const details = registrationStatusDetails[status] ?? { label: status, variant: "outline" as const, icon: Clock3 };
  const StatusIcon = details.icon;
  return (
    <Badge variant={details.variant} className="gap-1.5">
      <StatusIcon className="h-3.5 w-3.5" />
      {details.label}
    </Badge>
  );
}

const REFUND_REASONS = [
  "Cannot attend",
  "Injury or medical reason",
  "Personal emergency",
  "Duplicate registration",
  "Event change",
  "Other",
];

function formatPaise(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

function refundStatusLabel(status: string) {
  const map: Record<string, { label: string; color: string }> = {
    REQUESTED: { label: "Refund requested", color: "text-amber-700" },
    APPROVED: { label: "Refund approved", color: "text-blue-700" },
    REJECTED: { label: "Refund declined", color: "text-red-700" },
    REFUND_SENT: { label: "Refund sent", color: "text-purple-700" },
    REFUNDED: { label: "Refund confirmed", color: "text-green-700" },
    FAILED: { label: "Refund failed", color: "text-red-700" },
    CANCELLED: { label: "Refund cancelled", color: "text-slate-600" },
  };
  return map[status] ?? { label: status, color: "text-muted-foreground" };
}

interface RefundResult {
  id: string;
  status: string;
  requestedRefundAmount: number;
  approvedRefundAmount: number | null;
  refundUtr: string | null;
  refundedAt: string | null;
  confirmedAt: string | null;
}

export function ParticipantRegistrationCard({
  registration,
  onRefundUpdated,
}: {
  registration: ParticipantRegistration;
  onRefundUpdated?: (registrationId: string, refund: RefundResult) => void;
}) {
  const checkedInLabel =
    registration.checkInStatus === "checked_in"
      ? `Checked in${registration.checkedInAt ? ` · ${new Date(registration.checkedInAt).toLocaleString("en-IN")}` : ""}`
      : "Not checked in";

  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundComments, setRefundComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmingReceipt, setConfirmingReceipt] = useState(false);

  const refund = registration.refund;
  const eligible = registration.refundEligible;

  const submitRefundRequest = async () => {
    if (!refundReason) { toast.error("Please select a reason for your refund request"); return; }
    setSubmitting(true);
    try {
      const result = await apiRequest<{ refund: RefundResult }>(`/registrations/${registration.id}/refund-request`, {
        method: "POST",
        body: JSON.stringify({ refund_reason: refundReason, participant_comments: refundComments.trim() || null }),
      });
      toast.success("Refund request submitted. The organizer will review it shortly.");
      setShowRefundForm(false);
      onRefundUpdated?.(registration.id, result.refund ?? result as unknown as RefundResult);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit refund request");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmRefundReceived = async () => {
    if (!refund) return;
    setConfirmingReceipt(true);
    try {
      const result = await apiRequest<RefundResult>(`/refunds/${refund.id}/confirm-received`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast.success("Refund receipt confirmed. Thank you!");
      onRefundUpdated?.(registration.id, result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not confirm refund receipt");
    } finally {
      setConfirmingReceipt(false);
    }
  };

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl">{registration.event.name}</CardTitle>
            <CardDescription className="mt-1 flex items-center gap-1.5">
              {formatRegistrationDate(registration.event.date)}
              <span aria-hidden="true">·</span>
              <MapPin className="h-3.5 w-3.5" />
              {registration.event.location}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <RegistrationStatusBadge status={registration.status} />
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link to={`/event/${encodeURIComponent(registration.event.id)}/results`}>
                <Trophy className="h-3.5 w-3.5" /> View results
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Registration reference</p>
            <p className="mt-1 font-mono font-semibold">{registration.registrationReference}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Participants</p>
            <p className="mt-1 font-medium">
              {registration.participants?.map((m) => m.participant.name).join(" · ") || registration.participantName}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Ticket</p>
            <p className="mt-1 flex items-center gap-1.5 font-medium">
              <Ticket className="h-3.5 w-3.5 text-muted-foreground" />{registration.ticketType.name}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Payment</p>
            <p className="mt-1 font-medium capitalize">{registration.paymentStatus.replaceAll("_", " ")}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Amount</p>
            <p className="mt-1 font-semibold text-primary">
              {formatRegistrationAmount(registration.amountPaise, registration.currency)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Check-in</p>
            <p className="mt-1 font-medium">{checkedInLabel}</p>
          </div>
        </div>

        {/* QR ticket */}
        {registration.ticket && (
          <div className="border-t border-dashed pt-5 text-center">
            <p className="mb-3 flex items-center justify-center gap-2 text-sm font-semibold">
              <QrCode className="h-4 w-4 text-accent" />Event ticket QR
            </p>
            <img
              src={registration.ticket.qrDataUrl}
              alt={`Ticket QR for ${registration.event.name}`}
              className="mx-auto h-52 w-52 rounded-lg bg-white p-2"
            />
            <p className="mt-3 text-xs text-muted-foreground">
              This QR contains only an opaque ticket credential. Keep it private and show it at check-in.
            </p>
            {registration.event.whatsappGroupUrl && (
              <Button asChild size="sm" variant="outline" className="mt-4 gap-2">
                <a href={registration.event.whatsappGroupUrl} target="_blank" rel="noreferrer">
                  <MessageCircle className="h-4 w-4" /> Join WhatsApp group
                </a>
              </Button>
            )}
          </div>
        )}

        {/* ── Refund section ─────────────────────────────────────── */}

        {/* Existing refund status */}
        {refund && (
          <div className="border-t pt-4">
            <div className="rounded-xl border bg-muted/20 p-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className={`font-semibold ${refundStatusLabel(refund.status).color}`}>
                  {refundStatusLabel(refund.status).label}
                </p>
                {refund.approvedRefundAmount != null && (
                  <span className="font-bold text-primary">{formatPaise(refund.approvedRefundAmount)}</span>
                )}
              </div>

              {refund.status === "REFUND_SENT" && (
                <>
                  <p className="text-muted-foreground">
                    Your refund of{" "}
                    <span className="font-semibold text-foreground">
                      {formatPaise(refund.approvedRefundAmount ?? refund.requestedRefundAmount)}
                    </span>{" "}
                    has been processed by the organizer.
                  </p>
                  {refund.refundUtr && (
                    <p className="text-muted-foreground">
                      Reference / UTR: <span className="font-mono font-semibold text-foreground">{refund.refundUtr}</span>
                    </p>
                  )}
                  {refund.refundedAt && (
                    <p className="text-muted-foreground text-xs">
                      Sent on {new Date(refund.refundedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full gap-2 mt-1"
                    onClick={() => void confirmRefundReceived()}
                    disabled={confirmingReceipt}
                  >
                    {confirmingReceipt ? "Confirming…" : "Confirm refund received"}
                  </Button>
                </>
              )}

              {refund.status === "REFUNDED" && refund.confirmedAt && (
                <p className="text-muted-foreground text-xs">
                  Receipt confirmed on{" "}
                  {new Date(refund.confirmedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Request refund button — only when eligible and no active refund */}
        {!refund && eligible && !showRefundForm && (
          <div className="border-t pt-4">
            <button
              type="button"
              onClick={() => setShowRefundForm(true)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              Request Refund
            </button>
          </div>
        )}

        {/* Refund request form */}
        {showRefundForm && (
          <div className="border-t pt-4">
            <div className="rounded-xl border bg-muted/20 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-sm">Request a refund</p>
                <button
                  type="button"
                  onClick={() => setShowRefundForm(false)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Refund requests are reviewed by the organizer. Processing times may vary.
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Reason for cancellation *</Label>
                <Select value={refundReason} onValueChange={setRefundReason}>
                  <SelectTrigger><SelectValue placeholder="Select a reason…" /></SelectTrigger>
                  <SelectContent>
                    {REFUND_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Additional comments (optional)</Label>
                <Textarea
                  value={refundComments}
                  onChange={(e) => setRefundComments(e.target.value)}
                  placeholder="Any additional details..."
                  maxLength={1000}
                  className="min-h-[70px] text-sm"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowRefundForm(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => void submitRefundRequest()}
                  disabled={submitting || !refundReason}
                >
                  {submitting ? "Submitting…" : "Submit refund request"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
