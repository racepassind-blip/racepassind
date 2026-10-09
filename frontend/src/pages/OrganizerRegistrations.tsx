import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRightLeft, Check, ChevronLeft, ChevronRight, Clock3, Download, Mail, RefreshCw, ScanLine, Search, SlidersHorizontal, UserPlus, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/api";
import { scrollToTop } from "@/lib/scroll";
import type { OrganizerVisibility } from "@/hooks/useEvents";
import { useRegistrationRefund } from "@/hooks/useEvents";

interface OrganizerEventOption {
  id: string;
  name: string;
  categories: Array<{
    id: string;
    name: string;
    tickets: Array<{ id: string; name: string }>;
  }>;
  addonConfig?: { addons?: Array<{ id: string; name: string; type?: string; price_paise?: number }> } | null;
}

const PICKUP_POINT_FIELD_ID = "pickup_point_id";

interface EventPickupConfig {
  enabled?: boolean;
  required?: boolean;
  points?: Array<{ id: string; name: string; description?: string; address?: string }>;
}

interface OrganizerEventDetail {
  pickupPoints?: EventPickupConfig;
}

interface PickupSummaryResponse {
  enabled: boolean;
  required: boolean;
  points: Array<{ id: string; name: string; count: number }>;
  unassignedParticipants: number;
}

type RegistrationStatus = "awaiting_payment" | "pending_verification" | "AWAITING_SPORTPASS_CREDITS" | "confirmed" | "rejected" | "expired" | "checked_in";
type Decision = "approve" | "reject";
type FilterKey = "eventId" | "categoryId" | "ticketId" | "status" | "paymentStatus" | "checkInStatus" | "search" | "participant" | "email" | "phone" | "registrationReference";

interface RegistrationFilters {
  eventId: string;
  categoryId: string;
  ticketId: string;
  status: string;
  paymentStatus: string;
  checkInStatus: string;
  search: string;
  participant: string;
  email: string;
  phone: string;
  registrationReference: string;
}

interface OrganizerRegistration {
  id: string;
  registrationReference: string;
  event: { id: string; name: string };
  participant: { name: string; email: string | null; phone: string | null };
  participants?: Array<{ index: number; participant: { name: string; email: string | null; phone: string | null }; responses?: Record<string, unknown> }>;
  participantCount?: number;
  ticket: { id: string; name: string; category: string | null };
  amountPaise: number;
  receivedAmountPaise: number | null;
  source: "online" | "manual";
  isManualEntry: boolean;
  status: RegistrationStatus;
  paymentStatus: string;
  emailStatus: string | null;
  checkInStatus: "checked_in" | "not_checked_in";
  checkedInAt: string | null;
  utrReference: string | null;
  createdAt: string;
  submittedAt: string | null;
  decisionReason: string | null;
  reviewedAt: string | null;
  responses: Record<string, unknown>;
  selections: Record<string, { selected?: string; qty?: number }>;
  computedTotal: { addonTotalPaise?: number; totalPaise?: number; eventWaiver?: { title?: string; text?: string; accepted?: boolean; acceptedAt?: string } };
  transferWarning?: string | null;
  // Refund info (if a refund exists for this registration)
  refundStatus?: string;
  refundAmount?: number;
  refundUtr?: string | null;
}

interface RegistrationPage {
  items: OrganizerRegistration[];
  nextCursor: string | null;
  hasMore: boolean;
  visibility: OrganizerVisibility;
}

const EMPTY_FILTERS: RegistrationFilters = {
  eventId: "",
  categoryId: "",
  ticketId: "",
  status: "pending",
  paymentStatus: "all",
  checkInStatus: "all",
  search: "",
  participant: "",
  email: "",
  phone: "",
  registrationReference: "",
};

function paymentBadge(status: string) {
  if (status === "approved") return <Badge variant="default">Approved</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  if (status === "not_required") return <Badge variant="default">Free</Badge>;
  if (status === "expired") return <Badge variant="outline">Expired</Badge>;
  return <Badge variant="secondary">{status === "reference_submitted" ? "Reference submitted" : "Pending"}</Badge>;
}

function registrationBadge(status: RegistrationStatus) {
  const variant = status === "confirmed" || status === "checked_in" ? "default" : status === "rejected" || status === "expired" ? "destructive" : "secondary";
  return <Badge variant={variant}>{status === "AWAITING_SPORTPASS_CREDITS" ? "Awaiting SportPass Credits" : status.replaceAll("_", " ")}</Badge>;
}

function emailBadge(status: string | null) {
  if (status === "SENT") return <Badge variant="default">Sent</Badge>;
  if (status === "PENDING_LIMIT") return <Badge variant="secondary">Pending · limit</Badge>;
  if (status === "FAILED") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="outline">Not sent</Badge>;
}

function refundStatusBadge(status: string) {
  const variants: Record<string, string> = {
    REQUESTED: "bg-amber-100 text-amber-800 border-amber-200",
    APPROVED: "bg-blue-100 text-blue-800 border-blue-200",
    REJECTED: "bg-red-100 text-red-800 border-red-200",
    REFUND_SENT: "bg-purple-100 text-purple-800 border-purple-200",
    REFUNDED: "bg-green-100 text-green-800 border-green-200",
  };
  const label = {
    REQUESTED: "Requested",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    REFUND_SENT: "Sent",
    REFUNDED: "Refunded",
  }[status] ?? status;
  const cls = variants[status] ?? "bg-slate-100 text-slate-700 border-slate-200";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

function formatINR(amountPaise: number) {
  return `₹${(amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Registration detail drawer ───────────────────────────────────────────────

interface RegistrationDetailDrawerProps {
  registration: OrganizerRegistration | null;
  eventTickets: Array<{ id: string; name: string; categoryId: string; categoryName: string; pricePaise?: number }>;
  addonDefs: Record<string, string>;
  pickupNameById: Map<string, string>;
  onClose: () => void;
  onTransferDone: (updated: OrganizerRegistration) => void;
  onResendEmail: (registration: OrganizerRegistration) => Promise<void>;
  resendingId: string | null;
}

function RegistrationDetailDrawer({ registration, eventTickets, addonDefs, pickupNameById, onClose, onTransferDone, onResendEmail, resendingId }: RegistrationDetailDrawerProps) {
  const [showTransfer, setShowTransfer] = useState(false);
  const [targetTicketId, setTargetTicketId] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [transferring, setTransferring] = useState(false);

  // Fetch refund info if registration has a refund
  const { data: refundData } = useRegistrationRefund(registration?.id);
  
  useEffect(() => {
    setShowTransfer(false);
    setTargetTicketId("");
    setTransferReason("");
  }, [registration?.id]);

  if (!registration) return null;

  const transferableTickets = eventTickets.filter((t) => t.id !== registration.ticket.id);

  const doTransfer = async () => {
    if (!targetTicketId) { toast.error("Select a target category first."); return; }
    setTransferring(true);
    try {
      const result = await apiRequest<OrganizerRegistration>(
        `/organizer/events/${registration.event.id}/registrations/${registration.id}/transfer-category`,
        { method: "POST", body: JSON.stringify({ target_ticket_id: targetTicketId, reason: transferReason.trim() || null }) },
      );
      if (result.transferWarning) {
        toast.warning(`Transferred. Note: ${result.transferWarning}`);
      } else {
        toast.success("Participant transferred to new category.");
      }
      onTransferDone(result);
      setShowTransfer(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Transfer failed.");
    } finally {
      setTransferring(false);
    }
  };

  const targetTicket = eventTickets.find((t) => t.id === targetTicketId);
  const currentPaise = registration.amountPaise ?? 0;
  const newPaise = targetTicket?.pricePaise ?? null;
  const diffPaise = newPaise !== null ? newPaise - currentPaise : null;

  const transferNotes: string[] = Array.isArray(registration.responses.__transfer_notes)
    ? (registration.responses.__transfer_notes as string[])
    : [];

  const addonEntries = Object.entries(registration.selections ?? {}).filter(([, v]) => v.selected || (v.qty ?? 0) > 0);
  const responseEntries = Object.entries(registration.responses ?? {}).filter(
    ([k]) => !["full_name","email","phone","team_name","captain_name","captain_email","captain_phone","__transfer_notes",PICKUP_POINT_FIELD_ID,"waiver_accepted"].includes(k)
  );
  const pickupNameFor = (responses?: Record<string, unknown>): string | null => {
    const value = responses?.[PICKUP_POINT_FIELD_ID];
    if (value === undefined || value === null || String(value).trim() === "") return null;
    const id = String(value);
    return pickupNameById.get(id) ?? id;
  };

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Registration detail">
      {/* backdrop */}
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      {/* panel */}
      <div className="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l bg-card shadow-2xl">

        {/* header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Registration</p>
            <p className="mt-0.5 font-mono text-sm font-semibold">{registration.registrationReference}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-6 p-5">

          {/* ── Participant ───────────────────────────────────── */}
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Participant</p>
            <div className="rounded-lg border bg-muted/20 p-4 space-y-1">
              <p className="text-base font-bold">{registration.participant.name}</p>
              {registration.participant.email && (
                <p className="text-sm text-muted-foreground">{registration.participant.email}</p>
              )}
              {registration.participant.phone && (
                <p className="text-sm text-muted-foreground">{registration.participant.phone}</p>
              )}
              {(() => {
                const primaryResponses = registration.participants && registration.participants.length > 0
                  ? (registration.participants.find((member) => member.index === 0)?.responses ?? registration.participants[0].responses)
                  : registration.responses;
                const name = pickupNameFor(primaryResponses);
                return name ? <p className="text-sm"><span className="font-medium">Pickup point:</span> {name}</p> : null;
              })()}
              <div className="flex flex-wrap gap-2 pt-1">
                {registration.isManualEntry && <Badge variant="outline">Manual entry</Badge>}
                {registration.source === "manual" && !registration.isManualEntry && <Badge variant="outline">Offline</Badge>}
              </div>
            </div>
          </section>

          {/* ── Team members ──────────────────────────────────── */}
          {registration.participants && registration.participants.length > 1 && (
            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Team / Group members</p>
              <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                {registration.participants.map((m) => (
                  <div key={m.index} className="text-sm">
                    <span className="font-medium">{m.participant.name}</span>
                    {m.participant.email && <span className="text-muted-foreground"> · {m.participant.email}</span>}
                    {m.participant.phone && <span className="text-muted-foreground"> · {m.participant.phone}</span>}
                    {pickupNameFor(m.responses) && <div className="text-xs text-muted-foreground">Pickup point: {pickupNameFor(m.responses)}</div>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Registration & Payment status ─────────────────── */}
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-muted/20 p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Registration</p>
                {registrationBadge(registration.status)}
                <p className="text-xs text-muted-foreground">Registered {formatDate(registration.createdAt)}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Payment</p>
                {paymentBadge(registration.paymentStatus)}
                {registration.submittedAt && (
                  <p className="text-xs text-muted-foreground">Submitted {formatDate(registration.submittedAt)}</p>
                )}
                {registration.reviewedAt && (
                  <p className="text-xs text-muted-foreground">Reviewed {formatDate(registration.reviewedAt)}</p>
                )}
              </div>
            </div>
            {registration.decisionReason && (
              <div className="mt-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
                <span className="font-semibold">Decision note:</span> {registration.decisionReason}
              </div>
            )}
          </section>

          {/* ── Category & Amount ─────────────────────────────── */}
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Category & Amount</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Category</p>
                <p className="mt-1 font-semibold">{registration.ticket.category ?? "—"}</p>
                <p className="text-xs text-muted-foreground">{registration.ticket.name}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Amount</p>
                <p className="mt-1 font-semibold">{formatINR(registration.amountPaise)}</p>
                {registration.receivedAmountPaise !== null && (
                  <p className="text-xs text-muted-foreground">Received {formatINR(registration.receivedAmountPaise)}</p>
                )}
              </div>
            </div>
          </section>

          {/* ── Check-in ─────────────────────────────────────── */}
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Check-in</p>
            <div className="rounded-lg border bg-muted/20 p-3 flex items-center justify-between">
              <div>
                {registration.checkInStatus === "checked_in"
                  ? <p className="text-sm font-semibold text-emerald-600">✓ Checked in{registration.checkedInAt ? ` on ${formatDate(registration.checkedInAt)}` : ""}</p>
                  : <p className="text-sm text-muted-foreground">Not checked in yet</p>}
              </div>
            </div>
          </section>

          {/* ── UTR / Payment reference ───────────────────────── */}
          {registration.utrReference && (
            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Payment reference (UTR)</p>
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="font-mono text-sm">{registration.utrReference}</p>
              </div>
            </section>
          )}

          {registration.computedTotal.eventWaiver && (
            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Event waiver</p>
              <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                <p className="font-medium">{registration.computedTotal.eventWaiver.title || "Waiver & Declaration"}</p>
                {registration.computedTotal.eventWaiver.text && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{registration.computedTotal.eventWaiver.text}</p>}
                <p className="text-sm font-semibold">{registration.computedTotal.eventWaiver.accepted ? "Accepted" : "Not accepted"}{registration.computedTotal.eventWaiver.acceptedAt ? ` · ${formatDate(registration.computedTotal.eventWaiver.acceptedAt)}` : ""}</p>
              </div>
            </section>
          )}

          {/* ── Add-ons ───────────────────────────────────────── */}
          {addonEntries.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Add-ons selected</p>
              <div className="space-y-1 rounded-lg border bg-muted/20 p-3">
                {addonEntries.map(([k, v]) => (
                  <p key={k} className="text-sm">
                    <span className="font-medium">{addonDefs[k] ?? k.replaceAll("_", " ")}:</span>{" "}
                    {v.selected ?? (v.qty !== undefined ? `×${v.qty}` : "—")}
                  </p>
                ))}
                {registration.computedTotal.addonTotalPaise !== undefined && registration.computedTotal.addonTotalPaise > 0 && (
                  <p className="mt-1 text-xs font-semibold text-muted-foreground border-t pt-1">Add-on total: {formatINR(registration.computedTotal.addonTotalPaise)}</p>
                )}
              </div>
            </section>
          )}

          {/* ── Form responses ────────────────────────────────── */}
          {responseEntries.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Form responses</p>
              <div className="space-y-1 rounded-lg border bg-muted/20 p-3">
                {responseEntries.map(([k, v]) => (
                  <p key={k} className="text-sm">
                    <span className="font-medium">{k.replaceAll("_", " ")}:</span> {String(v)}
                  </p>
                ))}
              </div>
            </section>
          )}

          {/* ── Refund ─────────────────────────────────────────── */}
          {refundData?.refund && (
            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Refund</p>
              <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Status</span>
                  {refundStatusBadge(refundData.refund.status)}
                </div>
                {refundData.refund.approvedRefundAmount !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Refund amount</span>
                    <span className="font-semibold text-primary">{formatINR(refundData.refund.approvedRefundAmount ?? refundData.refund.requestedRefundAmount)}</span>
                  </div>
                )}
                {refundData.refund.requestedRefundAmount !== refundData.refund.approvedRefundAmount && (
                  <p className="text-xs text-muted-foreground">Requested: {formatINR(refundData.refund.requestedRefundAmount)}</p>
                )}
                {refundData.refund.refundUtr && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">UTR / Reference</span>
                    <span className="font-mono text-xs">{refundData.refund.refundUtr}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── Email ─────────────────────────────────────────── */}
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Confirmation email</p>
            <div className="rounded-lg border bg-muted/20 p-3 flex items-center justify-between gap-3">
              <div>
                {emailBadge(registration.emailStatus)}
                {registration.participant.email
                  ? <p className="mt-1 text-xs text-muted-foreground">{registration.participant.email}</p>
                  : <p className="mt-1 text-xs text-muted-foreground">No email address on record</p>}
              </div>
              {registration.participant.email && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 shrink-0"
                  disabled={resendingId === registration.id}
                  onClick={() => void onResendEmail(registration)}
                >
                  <Mail className="h-3.5 w-3.5" />
                  {resendingId === registration.id ? "Sending…" : registration.emailStatus === "SENT" ? "Resend email" : "Send email"}
                </Button>
              )}
            </div>
          </section>

          {/* ── Transfer history ──────────────────────────────── */}
          {transferNotes.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Transfer history</p>
              <div className="space-y-2">
                {transferNotes.map((note, i) => (
                  <p key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{note}</p>
                ))}
              </div>
            </section>
          )}

          {/* ── Transfer category ─────────────────────────────── */}
          {!showTransfer ? (
            <button
              type="button"
              onClick={() => setShowTransfer(true)}
              disabled={transferableTickets.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/40 py-3 text-sm font-semibold text-primary transition-colors hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowRightLeft className="h-4 w-4" />
              Transfer to different category
            </button>
          ) : (
            <section className="rounded-xl border bg-muted/20 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold">Transfer category</p>
                <button type="button" onClick={() => setShowTransfer(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Target category / ticket</label>
                <select
                  value={targetTicketId}
                  onChange={(e) => setTargetTicketId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  aria-label="Select target category"
                >
                  <option value="">Select a category…</option>
                  {transferableTickets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.categoryName} — {t.name}{t.pricePaise !== undefined ? ` (${formatINR(t.pricePaise)})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* price diff preview */}
              {diffPaise !== null && (
                <div className={`rounded-lg border p-3 text-sm ${diffPaise > 0 ? "border-amber-200 bg-amber-50 text-amber-900" : diffPaise < 0 ? "border-blue-200 bg-blue-50 text-blue-900" : "border-muted bg-muted/30 text-muted-foreground"}`}>
                  {diffPaise > 0 && <p><span className="font-bold">₹{(diffPaise / 100).toFixed(2)} additional amount owed</span> — collect from participant directly via UPI.</p>}
                  {diffPaise < 0 && <p><span className="font-bold">₹{(Math.abs(diffPaise) / 100).toFixed(2)} refund applicable</span> — issue to participant directly.</p>}
                  {diffPaise === 0 && <p>No price difference — same amount as current category.</p>}
                  <p className="mt-1 text-xs opacity-75">Platform fee will be recalculated on the new amount.</p>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Reason (optional)</label>
                <Textarea
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="e.g. participant requested category change"
                  maxLength={500}
                  className="min-h-[70px] text-sm"
                />
              </div>

              <Button onClick={() => void doTransfer()} disabled={!targetTicketId || transferring} className="w-full gap-2">
                <ArrowRightLeft className="h-4 w-4" />
                {transferring ? "Transferring…" : "Confirm transfer"}
              </Button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

const OrganizerRegistrations = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const eventIdFromUrl = searchParams.get("event_id") ?? "";
  const eventScoped = Boolean(eventIdFromUrl);
  const [events, setEvents] = useState<OrganizerEventOption[]>([]);
  const [filters, setFilters] = useState<RegistrationFilters>(() => ({
    ...EMPTY_FILTERS,
    eventId: eventIdFromUrl,
    categoryId: searchParams.get("category_id") ?? "",
    ticketId: searchParams.get("ticket_id") ?? "",
    status: searchParams.get("status") ?? EMPTY_FILTERS.status,
    paymentStatus: searchParams.get("payment_status") ?? EMPTY_FILTERS.paymentStatus,
    checkInStatus: searchParams.get("check_in_status") ?? EMPTY_FILTERS.checkInStatus,
    search: searchParams.get("q") ?? "",
    participant: searchParams.get("participant") ?? "",
    email: searchParams.get("email") ?? "",
    phone: searchParams.get("phone") ?? "",
    registrationReference: searchParams.get("registration_reference") ?? "",
  }));
  const [registrations, setRegistrations] = useState<OrganizerRegistration[]>([]);
  const [visibility, setVisibility] = useState<OrganizerVisibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [decisionTarget, setDecisionTarget] = useState<{ id: string; decision: Decision } | null>(null);
  const [reason, setReason] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);
  const [resendId, setResendId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [detailRegistration, setDetailRegistration] = useState<OrganizerRegistration | null>(null);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(() => ["category_id", "ticket_id", "payment_status", "check_in_status", "participant", "email", "phone", "registration_reference"].some((key) => searchParams.has(key)));
  // Pickup points are an event-level config not carried by /organizer/events
  // options, so fetch the selected event's config (which now exposes pickupPoints)
  // to resolve id -> name and drive the client-side column/filter/summary.
  const [pickupConfig, setPickupConfig] = useState<EventPickupConfig | null>(null);
  const [pickupSummaryData, setPickupSummaryData] = useState<PickupSummaryResponse | null>(null);
  const [pickupFilter, setPickupFilter] = useState("all");

  useEffect(() => {
    const controller = new AbortController();
    setEventsLoading(true);
    void apiRequest<OrganizerEventOption[]>("/organizer/events", { signal: controller.signal })
      .then(setEvents)
      .catch((loadError) => {
        if (!controller.signal.aborted) setEventsError(loadError instanceof Error ? loadError.message : "Could not load events");
      })
      .finally(() => {
        if (!controller.signal.aborted) setEventsLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page_size: "50", status: filters.status });
    if (cursor) params.set("cursor", cursor);
    if (filters.eventId) params.set("event_id", filters.eventId);
    if (filters.categoryId) params.set("category_id", filters.categoryId);
    if (filters.ticketId) params.set("ticket_id", filters.ticketId);
    if (filters.paymentStatus !== "all") params.set("payment_status", filters.paymentStatus);
    if (filters.checkInStatus !== "all") params.set("check_in_status", filters.checkInStatus);
    if (pickupFilter !== "all") params.set("pickup_point_id", pickupFilter);
    if (filters.search.trim()) params.set("q", filters.search.trim());
    if (filters.participant.trim()) params.set("participant", filters.participant.trim());
    if (filters.email.trim()) params.set("email", filters.email.trim());
    if (filters.phone.trim()) params.set("phone", filters.phone.trim());
    if (filters.registrationReference.trim()) params.set("registration_reference", filters.registrationReference.trim());

    setLoading(true);
    setError(null);
    void apiRequest<RegistrationPage>(`/organizer/registrations?${params.toString()}`, { signal: controller.signal })
      .then((page) => {
        setRegistrations(page.items);
        setVisibility(page.visibility);
        setNextCursor(page.nextCursor);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Could not load registrations");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cursor, filters, pickupFilter, refreshNonce]);

  // Load the selected event's pickup-points config (id -> name) for the
  // client-side pickup column/filter/summary. Cleared when no single event is scoped.
  useEffect(() => {
    if (!filters.eventId) {
      setPickupConfig(null);
      setPickupFilter("all");
      return;
    }
    const controller = new AbortController();
    void apiRequest<OrganizerEventDetail>(`/organizer/events/${filters.eventId}`, { signal: controller.signal })
      .then((event) => setPickupConfig(event.pickupPoints ?? null))
      .catch(() => {
        if (!controller.signal.aborted) setPickupConfig(null);
      });
    // Authoritative, participant-correct counts across ALL registrations (the
    // table itself is cursor-paginated, so counts must not be derived from it).
    const summaryParams = new URLSearchParams({ status: filters.status, check_in_status: filters.checkInStatus });
    if (filters.paymentStatus !== "all") summaryParams.set("payment_status", filters.paymentStatus);
    void apiRequest<PickupSummaryResponse>(`/organizer/events/${filters.eventId}/pickup-summary?${summaryParams}`, { signal: controller.signal })
      .then((summary) => setPickupSummaryData(summary))
      .catch(() => {
        if (!controller.signal.aborted) setPickupSummaryData(null);
      });
    return () => controller.abort();
  }, [filters.eventId, filters.status, filters.paymentStatus, filters.checkInStatus, refreshNonce]);

  const selectedEvent = events.find((event) => event.id === filters.eventId);
  const categories = useMemo(() => selectedEvent?.categories ?? [], [selectedEvent]);
  const tickets = useMemo(
    () => categories.flatMap((category) => category.tickets.map((ticket) => ({ ...ticket, categoryId: category.id, categoryName: category.name }))),
    [categories],
  );
  const visibleTickets = useMemo(
    () => (filters.categoryId ? tickets.filter((ticket) => ticket.categoryId === filters.categoryId) : tickets),
    [filters.categoryId, tickets],
  );
  const selectedCategory = categories.find((category) => category.id === filters.categoryId);
  const selectedTicket = tickets.find((ticket) => ticket.id === filters.ticketId);
  // Flat ticket list for the transfer dialog — price unknown from event-options, backend recomputes anyway
  const eventTicketsForTransfer = useMemo(
    () => categories.flatMap((cat) =>
      cat.tickets.map((t) => ({ id: t.id, name: t.name, categoryId: cat.id, categoryName: cat.name }))
    ),
    [categories],
  );
  // --- Pickup points (client-side column/filter/summary) --------------------
  const pickupEnabled = Boolean(pickupConfig?.enabled) && Boolean(filters.eventId);
  const pickupPoints = useMemo(() => pickupConfig?.points ?? [], [pickupConfig]);
  const pickupNameById = useMemo(
    () => new Map(pickupPoints.map((point) => [point.id, point.name] as const)),
    [pickupPoints],
  );
  const pickupIdFor = (responses?: Record<string, unknown>): string | null => {
    const value = responses?.[PICKUP_POINT_FIELD_ID];
    return value === undefined || value === null || String(value).trim() === "" ? null : String(value);
  };
  // The pickup ids chosen across every participant of a registration.
  const pickupIdsForRegistration = (registration: OrganizerRegistration): string[] => {
    const members = registration.participants && registration.participants.length > 0
      ? registration.participants.map((member) => member.responses)
      : [registration.responses];
    return members.map((responses) => pickupIdFor(responses)).filter((id): id is string => id !== null);
  };
  // Column shows the primary participant's pickup (fallback: first membership).
  const primaryPickupName = (registration: OrganizerRegistration): string | null => {
    const primaryResponses = registration.participants && registration.participants.length > 0
      ? (registration.participants.find((member) => member.index === 0)?.responses ?? registration.participants[0].responses)
      : registration.responses;
    const id = pickupIdFor(primaryResponses);
    return id === null ? null : (pickupNameById.get(id) ?? id);
  };
  const displayedRegistrations = registrations;
  // Per-participant counts (not per registration) for each configured point.
  // Sourced from the authoritative /pickup-summary endpoint which aggregates
  // across ALL of the event's registrations, not just the loaded table page.
  const pickupSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const point of pickupPoints) counts.set(point.id, 0);
    for (const entry of pickupSummaryData?.points ?? []) counts.set(entry.id, entry.count);
    return counts;
  }, [pickupSummaryData, pickupPoints]);

  const activeFilterCount = [
    filters.categoryId,
    filters.ticketId,
    filters.status !== "all" ? filters.status : "",
    filters.paymentStatus !== "all" ? filters.paymentStatus : "",
    filters.checkInStatus !== "all" ? filters.checkInStatus : "",
    filters.search.trim(),
    filters.participant.trim(),
    filters.email.trim(),
    filters.phone.trim(),
    filters.registrationReference.trim(),
    pickupFilter !== "all" ? pickupFilter : "",
  ].filter(Boolean).length;
  const detailedFilterCount = [
    filters.categoryId,
    filters.ticketId,
    filters.paymentStatus !== "all" ? filters.paymentStatus : "",
    filters.checkInStatus !== "all" ? filters.checkInStatus : "",
    filters.participant.trim(),
    filters.email.trim(),
    filters.phone.trim(),
    filters.registrationReference.trim(),
  ].filter(Boolean).length;
  const exportIsFiltered = activeFilterCount > 0;

  const syncFiltersToUrl = (nextFilters: RegistrationFilters) => {
    const nextParams = new URLSearchParams();
    if (nextFilters.eventId) nextParams.set("event_id", nextFilters.eventId);
    if (nextFilters.categoryId) nextParams.set("category_id", nextFilters.categoryId);
    if (nextFilters.ticketId) nextParams.set("ticket_id", nextFilters.ticketId);
    if (nextFilters.status !== EMPTY_FILTERS.status) nextParams.set("status", nextFilters.status);
    if (nextFilters.paymentStatus !== EMPTY_FILTERS.paymentStatus) nextParams.set("payment_status", nextFilters.paymentStatus);
    if (nextFilters.checkInStatus !== EMPTY_FILTERS.checkInStatus) nextParams.set("check_in_status", nextFilters.checkInStatus);
    if (nextFilters.search.trim()) nextParams.set("q", nextFilters.search.trim());
    if (nextFilters.participant.trim()) nextParams.set("participant", nextFilters.participant.trim());
    if (nextFilters.email.trim()) nextParams.set("email", nextFilters.email.trim());
    if (nextFilters.phone.trim()) nextParams.set("phone", nextFilters.phone.trim());
    if (nextFilters.registrationReference.trim()) nextParams.set("registration_reference", nextFilters.registrationReference.trim());
    setSearchParams(nextParams, { replace: true });
  };

  const applyFilters = (nextFilters: RegistrationFilters) => {
    setFilters(nextFilters);
    syncFiltersToUrl(nextFilters);
    setCursor(null);
    setCursorHistory([]);
  };

  const updateFilter = <K extends FilterKey>(key: K, value: RegistrationFilters[K]) => {
    applyFilters({ ...filters, [key]: value } as RegistrationFilters);
  };

  const handleCategoryChange = (categoryId: string) => {
    const nextTicketId = categoryId && filters.ticketId && !tickets.some((ticket) => ticket.id === filters.ticketId && ticket.categoryId === categoryId)
      ? ""
      : filters.ticketId;
    applyFilters({ ...filters, categoryId, ticketId: nextTicketId });
  };

  const handleEventChange = (eventId: string) => {
    if (eventScoped && eventId === "all") return;
    const nextEventId = eventId === "all" ? "" : eventId;
    applyFilters({ ...filters, eventId: nextEventId, categoryId: "", ticketId: "" });
  };

  const clearAllFilters = () => {
    applyFilters({ ...EMPTY_FILTERS, eventId: eventScoped ? filters.eventId : "", status: "all" });
  };

  const goNext = () => {
    if (!nextCursor) return;
    setCursorHistory((history) => [...history, cursor ?? ""]);
    setCursor(nextCursor);
    scrollToTop();
  };

  const goPrevious = () => {
    const previous = cursorHistory[cursorHistory.length - 1];
    if (previous === undefined) return;
    setCursorHistory((history) => history.slice(0, -1));
    setCursor(previous || null);
    scrollToTop();
  };

  const exportCsv = async () => {
    if (!filters.eventId) {
      toast.error("Choose an event before exporting registrations.");
      return;
    }
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (filters.categoryId) params.set("category_id", filters.categoryId);
      if (filters.ticketId) params.set("ticket_id", filters.ticketId);
      if (filters.status !== "all") params.set("status", filters.status);
      if (filters.paymentStatus !== "all") params.set("payment_status", filters.paymentStatus);
      if (filters.checkInStatus !== "all") params.set("check_in_status", filters.checkInStatus);
      if (pickupFilter !== "all") params.set("pickup_point_id", pickupFilter);
      if (filters.search.trim()) params.set("q", filters.search.trim());
      if (filters.participant.trim()) params.set("participant", filters.participant.trim());
      if (filters.email.trim()) params.set("email", filters.email.trim());
      if (filters.phone.trim()) params.set("phone", filters.phone.trim());
      if (filters.registrationReference.trim()) params.set("registration_reference", filters.registrationReference.trim());
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const content = await apiRequest<string>(`/organizer/events/${filters.eventId}/registrations.csv${suffix}`);
      const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `registrations-${filters.eventId}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Registration CSV downloaded.");
    } catch (exportError) {
      toast.error(exportError instanceof Error ? exportError.message : "Could not export registrations");
    } finally {
      setExporting(false);
    }
  };

  const decide = async (registration: OrganizerRegistration, decision: Decision) => {
    if (decision === "reject" && !reason.trim()) {
      toast.error("Add a reason before rejecting a payment.");
      return;
    }
    setActionId(registration.id);
    try {
      const updated = await apiRequest<OrganizerRegistration>(`/organizer/events/${registration.event.id}/registrations/${registration.id}/${decision}`, {
        method: "POST",
        body: JSON.stringify(decision === "reject" ? { reason: reason.trim() } : {}),
        timeoutMs: decision === "approve" ? 60_000 : undefined,
      });
      if (decision === "approve" && updated.status === "AWAITING_SPORTPASS_CREDITS") {
        toast.warning("Registration is awaiting SportPass Credits", {
          description: "Payment was not approved. Top up Credits, then retry. No ticket or confirmation was issued.",
          action: { label: "Top up Credits", onClick: () => navigate("/organizer/credits") },
        });
      } else if (decision === "approve" && updated.status === "confirmed" && updated.paymentStatus === "approved") {
        toast.success("Payment approved and registration confirmed.");
      } else if (decision === "reject" && updated.status === "rejected") {
        toast.success("Payment rejected.");
      } else {
        toast.warning("Payment decision did not complete. Reload the registration before retrying.");
      }
      setDecisionTarget(null);
      setReason("");
      setRefreshNonce((value) => value + 1);
    } catch (decisionError) {
      toast.error(decisionError instanceof Error ? decisionError.message : "Payment decision failed");
    } finally {
      setActionId(null);
    }
  };

  const resendEmail = async (registration: OrganizerRegistration) => {
    setResendId(registration.id);
    try {
      const result = await apiRequest<{ result: string; message: string }>(
        `/organizer/events/${registration.event.id}/registrations/${registration.id}/resend-email`,
        { method: "POST" },
      );
      if (result.result === "sent") toast.success("Confirmation email sent.");
      else if (result.result === "delayed") toast.info("Email queued — will send when capacity is available.");
      else if (result.result === "disabled") toast.error("Email is disabled in Communication settings.");
      else toast.error(result.message || "Could not send email.");
      setRefreshNonce((value) => value + 1);
    } catch (resendError) {
      toast.error(resendError instanceof Error ? resendError.message : "Could not send email");
    } finally {
      setResendId(null);
    }
  };

  const handleTransferDone = (updated: OrganizerRegistration) => {
    setRegistrations((prev) => prev.map((r) => r.id === updated.id ? updated : r));
    setDetailRegistration(updated);
  };

  return (
    <OrganizerDashboardLayout eventId={filters.eventId || undefined}>
      <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <Button variant="ghost" size="icon" className="mt-0.5 shrink-0" onClick={() => navigate(eventScoped ? `/organizer/events/${filters.eventId}` : "/organizer")} aria-label={eventScoped ? "Back to event dashboard" : "Back to organizer dashboard"}><ArrowLeft className="h-4 w-4" /></Button>
              <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Registration workspace</p><h1 className="mt-1 truncate text-2xl font-black tracking-tight sm:text-3xl">{eventScoped ? selectedEvent?.name ?? "Event registrations" : "All registrations"}</h1><p className="mt-1 text-sm text-muted-foreground">Review payments, confirm participants, and keep each registration’s audit details in one place.</p></div>
            </div>
            <div className="flex flex-wrap gap-2 pl-12 lg:pl-0">
              {eventScoped && <Button variant="outline" onClick={() => navigate(`/organizer/events/${filters.eventId}/check-in`)} className="gap-2"><ScanLine className="h-4 w-4" /> Check-in matrix</Button>}
              {eventScoped && <Button onClick={() => navigate(`/organizer/events/${filters.eventId}/participants/new`)} className="gap-2"><UserPlus className="h-4 w-4" /> Add participant</Button>}
            </div>
          </div>
        </section>

        {eventsError && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{eventsError}</div>}
        <div className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-xl"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Search participant, email, phone, or registration number" className="h-11 pl-9" /></div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant={moreFiltersOpen ? "secondary" : "outline"} className="gap-2" onClick={() => setMoreFiltersOpen((open) => !open)}><SlidersHorizontal className="h-4 w-4" /> More filters{detailedFilterCount > 0 ? ` (${detailedFilterCount})` : ""}</Button>
              <Button type="button" variant="outline" size="icon" onClick={() => setRefreshNonce((value) => value + 1)} disabled={loading} aria-label="Refresh registrations" title="Refresh registrations"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
              {activeFilterCount > 0 && <Button variant="ghost" onClick={clearAllFilters}>Clear filters</Button>}
            </div>
          </div>

          {!eventScoped && <div className="max-w-md space-y-1"><label className="text-xs font-medium text-muted-foreground">Event</label><Select value={filters.eventId || "all"} onValueChange={handleEventChange} disabled={eventsLoading}><SelectTrigger><SelectValue placeholder="All events" /></SelectTrigger><SelectContent><SelectItem value="all">All events</SelectItem>{events.map((event) => <SelectItem key={event.id} value={event.id}>{event.name}</SelectItem>)}</SelectContent></Select></div>}

          <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1" role="tablist" aria-label="Registration status">
            {[
              { value: "pending", label: "Needs review" },
              { value: "all", label: "All" },
              { value: "awaiting_payment", label: "Awaiting payment" },
              { value: "pending_verification", label: "UTR submitted" },
              { value: "confirmed", label: "Confirmed" },
              { value: "checked_in", label: "Checked in" },
            ].map((status) => <button key={status.value} type="button" role="tab" aria-selected={filters.status === status.value} onClick={() => updateFilter("status", status.value)} className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition-colors ${filters.status === status.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{status.label}</button>)}
          </div>

          {moreFiltersOpen && <div className="space-y-4 border-t pt-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Category</label><Select value={filters.categoryId || "all"} onValueChange={(value) => handleCategoryChange(value === "all" ? "" : value)} disabled={!selectedEvent}><SelectTrigger><SelectValue placeholder="All categories" /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Tier</label><Select value={filters.ticketId || "all"} onValueChange={(value) => updateFilter("ticketId", value === "all" ? "" : value)} disabled={!selectedEvent || visibleTickets.length === 0}><SelectTrigger><SelectValue placeholder="All tiers" /></SelectTrigger><SelectContent><SelectItem value="all">All tiers</SelectItem>{filters.categoryId ? visibleTickets.map((ticket) => <SelectItem key={ticket.id} value={ticket.id}>{ticket.name}</SelectItem>) : categories.map((category) => { const categoryTickets = visibleTickets.filter((ticket) => ticket.categoryId === category.id); if (categoryTickets.length === 0) return null; return <SelectGroup key={category.id}><SelectLabel>{category.name}</SelectLabel>{categoryTickets.map((ticket) => <SelectItem key={ticket.id} value={ticket.id}>{ticket.name}</SelectItem>)}</SelectGroup>; })}</SelectContent></Select></div>
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Registration status</label><Select value={filters.status} onValueChange={(value) => updateFilter("status", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Needs review</SelectItem><SelectItem value="all">All registrations</SelectItem><SelectItem value="awaiting_payment">Awaiting payment</SelectItem><SelectItem value="pending_verification">UTR submitted</SelectItem><SelectItem value="AWAITING_SPORTPASS_CREDITS">Awaiting Credits</SelectItem><SelectItem value="confirmed">Confirmed</SelectItem><SelectItem value="checked_in">Checked in</SelectItem><SelectItem value="rejected">Rejected</SelectItem><SelectItem value="expired">Expired</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Payment</label><Select value={filters.paymentStatus} onValueChange={(value) => updateFilter("paymentStatus", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All payment states</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="reference_submitted">Reference submitted</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="rejected">Rejected</SelectItem><SelectItem value="expired">Expired</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Check-in</label><Select value={filters.checkInStatus} onValueChange={(value) => updateFilter("checkInStatus", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All check-in states</SelectItem><SelectItem value="not_checked_in">Not checked in</SelectItem><SelectItem value="checked_in">Checked in</SelectItem></SelectContent></Select></div>
              {pickupEnabled && pickupPoints.length > 0 && <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Pickup point</label><Select value={pickupFilter} onValueChange={(value) => { setPickupFilter(value); setCursor(null); setCursorHistory([]); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All pickup points</SelectItem>{pickupPoints.map((point) => <SelectItem key={point.id} value={point.id}>{point.name}</SelectItem>)}</SelectContent></Select></div>}
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Input value={filters.participant} onChange={(event) => updateFilter("participant", event.target.value)} placeholder="Participant name" /><Input value={filters.email} onChange={(event) => updateFilter("email", event.target.value)} placeholder="Email address" type="email" /><Input value={filters.phone} onChange={(event) => updateFilter("phone", event.target.value)} placeholder="Phone number" /><Input value={filters.registrationReference} onChange={(event) => updateFilter("registrationReference", event.target.value)} placeholder="Registration number" /></div>
          </div>}

          {activeFilterCount > 0 && <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
            <span className="text-muted-foreground">Active filters:</span>
            {filters.categoryId && <Badge variant="secondary" className="gap-1">Category: {selectedCategory?.name ?? "Selected"}<button type="button" onClick={() => handleCategoryChange("")} aria-label="Remove category filter"><X className="h-3 w-3" /></button></Badge>}
            {filters.ticketId && <Badge variant="secondary" className="gap-1">Tier: {selectedTicket?.categoryName ? `${selectedTicket.categoryName} · ` : ""}{selectedTicket?.name ?? "Selected"}<button type="button" onClick={() => updateFilter("ticketId", "")} aria-label="Remove tier filter"><X className="h-3 w-3" /></button></Badge>}
            {filters.status !== "all" && <Badge variant="secondary" className="gap-1">Status: {filters.status.replaceAll("_", " ")}<button type="button" onClick={() => updateFilter("status", "all")} aria-label="Remove status filter"><X className="h-3 w-3" /></button></Badge>}
            {filters.paymentStatus !== "all" && <Badge variant="secondary" className="gap-1">Payment: {filters.paymentStatus.replaceAll("_", " ")}<button type="button" onClick={() => updateFilter("paymentStatus", "all")} aria-label="Remove payment filter"><X className="h-3 w-3" /></button></Badge>}
            {filters.checkInStatus !== "all" && <Badge variant="secondary" className="gap-1">Check-in: {filters.checkInStatus.replaceAll("_", " ")}<button type="button" onClick={() => updateFilter("checkInStatus", "all")} aria-label="Remove check-in filter"><X className="h-3 w-3" /></button></Badge>}
            <span className="text-xs text-muted-foreground">Search and CSV export use these filters.</span>
          </div>}
        </div>

        {decisionTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
            <div className="w-full max-w-md overflow-hidden rounded-2xl border bg-card shadow-2xl animate-in fade-in zoom-in duration-200">
              <div className="p-6">
                <h3 className="text-lg font-bold">
                  {decisionTarget.decision === "reject" 
                    ? "Reject this payment" 
                    : "Approve this payment"}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {decisionTarget.decision === "reject" 
                    ? "Let the participant know what to fix or contact you about. This message will be visible to them." 
                    : "This verifies the submitted payment and continues the registration confirmation flow."}
                </p>
                {decisionTarget.decision === "reject" && <div className="mt-4">
                  <Textarea 
                    value={reason} 
                    onChange={(event) => setReason(event.target.value)} 
                    maxLength={1000} 
                    placeholder="Explain what the participant should correct or contact you about…"
                    className="min-h-[120px]"
                  />
                  <div className="mt-2 flex justify-end">
                    <span className="text-xs text-muted-foreground">
                      {reason.length}/1000 characters
                    </span>
                  </div>
                </div>}
                <div className="mt-6 flex items-center justify-end gap-2">
                  <Button 
                    variant="outline" 
                    onClick={() => { setDecisionTarget(null); setReason(""); }}
                    disabled={actionId === decisionTarget.id}
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={() => { 
                      const registration = registrations.find((item) => item.id === decisionTarget.id); 
                      if (registration) void decide(registration, decisionTarget.decision); 
                    }} 
                    disabled={actionId === decisionTarget.id}
                    autoFocus
                  >
                    {actionId === decisionTarget.id 
                      ? "Processing…" 
                      : decisionTarget.decision === "reject" 
                        ? "Reject payment" 
                        : "Approve payment"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {pickupEnabled && pickupPoints.length > 0 && (
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <h2 className="font-bold">Pickup points</h2>
              <Badge variant="secondary">per participant</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">How many participants chose each pickup point across the current status filter.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {pickupPoints.map((point) => (
                <div key={point.id} className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{point.name}</p>
                    <Badge variant="secondary">{pickupSummary.get(point.id) ?? 0}</Badge>
                  </div>
                  {point.address && <p className="mt-1 text-xs text-muted-foreground">{point.address}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div><div className="flex items-center gap-2"><h2 className="font-bold">Registrations</h2>{!loading && <Badge variant="secondary">{displayedRegistrations.length} shown</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">Click a registration to view contact information, form answers, email status, refund details, and transfer history.</p></div>
            <Button variant="outline" onClick={() => void exportCsv()} disabled={!filters.eventId || exporting} className="w-fit gap-2"><Download className="h-4 w-4" />{exporting ? "Exporting…" : exportIsFiltered ? "Export filtered CSV" : "Export event CSV"}</Button>
          </div>
          {loading ? <div className="p-12 text-center text-sm text-muted-foreground"><RefreshCw className="mx-auto mb-3 h-5 w-5 animate-spin" />Loading registrations…</div> : error ? <div className="p-12 text-center"><p className="text-sm text-destructive">{error}</p><Button variant="outline" className="mt-4" onClick={() => setRefreshNonce((value) => value + 1)}>Try again</Button></div> : registrations.length === 0 ? <div className="p-12 text-center"><Search className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-4 font-semibold">No registrations found</p><p className="mt-1 text-sm text-muted-foreground">No records match the current search and filters.</p>{activeFilterCount > 0 && <Button variant="ghost" className="mt-3" onClick={clearAllFilters}>Clear filters</Button>}</div> : <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead className="min-w-60">Participant</TableHead>{!eventScoped && <TableHead>Event</TableHead>}<TableHead>Category / tier</TableHead>{pickupEnabled && <TableHead>Pickup point</TableHead>}<TableHead>Amount</TableHead><TableHead>Payment</TableHead><TableHead>Registration</TableHead><TableHead>UTR/reference</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>{displayedRegistrations.map((registration) => {
              const isReviewable = registration.status === "awaiting_payment" || registration.status === "pending_verification" || registration.status === "AWAITING_SPORTPASS_CREDITS";
              return <TableRow
                key={registration.id}
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={(e) => {
                  // don't open drawer when clicking approve/reject buttons
                  if ((e.target as HTMLElement).closest("button")) return;
                  setDetailRegistration(registration);
                }}
              >
                <TableCell><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-primary underline-offset-2 hover:underline">{registration.participant.name}</p>{registration.isManualEntry && <Badge variant="outline">Manual</Badge>}</div>{registration.participants && registration.participants.length > 1 && <p className="mt-0.5 text-xs text-muted-foreground">{registration.participants.length} participants</p>}<p className="mt-1 text-xs text-muted-foreground">{registration.participant.email ?? registration.participant.phone ?? "No contact details"}</p><p className="mt-1 font-mono text-xs font-medium text-foreground/70">{registration.registrationReference}</p></TableCell>
                {!eventScoped && <TableCell><p className="max-w-44 truncate">{registration.event.name}</p></TableCell>}
                <TableCell><p className="font-medium">{registration.ticket.category ?? "Uncategorised"}</p><p className="text-xs text-muted-foreground">{registration.ticket.name}</p></TableCell>
                {pickupEnabled && <TableCell>{primaryPickupName(registration) ? <span className="text-sm">{primaryPickupName(registration)}</span> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>}
                <TableCell className="font-semibold"><p>{formatINR(registration.amountPaise)}</p>{registration.receivedAmountPaise !== null && <p className="text-xs font-normal text-accent">Received {formatINR(registration.receivedAmountPaise)}</p>}</TableCell>
                <TableCell>{paymentBadge(registration.paymentStatus)}</TableCell>
                <TableCell><div className="space-y-1">{registrationBadge(registration.status)}<p className="text-xs text-muted-foreground">{formatDate(registration.createdAt)}</p></div></TableCell>
                <TableCell>{registration.utrReference ? <span className="font-mono text-sm font-medium">{registration.utrReference}</span> : <span className="text-xs text-muted-foreground">{registration.paymentStatus === "not_required" ? "Not required" : "Not submitted"}</span>}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">{isReviewable ? <><Button variant="outline" size="sm" className="gap-1 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800" onClick={() => { setDecisionTarget({ id: registration.id, decision: "approve" }); setReason(""); }} disabled={actionId !== null}><Check className="h-3.5 w-3.5" /> Approve</Button><Button variant="ghost" size="sm" className="gap-1 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => { setDecisionTarget({ id: registration.id, decision: "reject" }); setReason(""); }} disabled={actionId !== null}><X className="h-3.5 w-3.5" /> Reject</Button></> : <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3 w-3" />No action</span>}</div>
                </TableCell>
              </TableRow>;
            })}</TableBody>
          </Table></div>}
          <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground">Up to 50 registrations per page. CSV exports use the active filters and support up to 5,000 rows.</p><div className="flex gap-2"><Button variant="outline" size="sm" onClick={goPrevious} disabled={cursorHistory.length === 0 || loading}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" onClick={goNext} disabled={!nextCursor || loading}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>
        </section>
      </div>

      <RegistrationDetailDrawer
        registration={detailRegistration}
        eventTickets={eventTicketsForTransfer}
        pickupNameById={pickupNameById}
        addonDefs={Object.fromEntries(
          (selectedEvent?.addonConfig?.addons ?? []).map((a) => [a.id, a.name])
        )}
        onClose={() => setDetailRegistration(null)}
        onTransferDone={handleTransferDone}
        onResendEmail={resendEmail}
        resendingId={resendId}
      />

    </OrganizerDashboardLayout>
  );
};

export default OrganizerRegistrations;
