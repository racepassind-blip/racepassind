import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Building2, ChevronLeft, ChevronRight, CircleDollarSign, Clock, RefreshCw, Search, ShieldCheck, Users, XCircle, Banknote } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/api";

type VerificationStatus = "NOT_SUBMITTED" | "UNDER_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED";

interface OrganizerOverview {
  organizationId: string;
  organizationName: string;
  responsiblePerson: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  status: string;
  createdAt: string | null;
  eventsTotal: number;
  eventsPublished: number;
  totalParticipants: number;
  approvedRevenuePaise: number;
  paidVerificationStatus: VerificationStatus;
  allowDirectUpi: boolean;
}

interface VerificationDetail {
  organizationId: string;
  organizationName: string;
  organizationType: string | null;
  city: string | null;
  state: string | null;
  paidVerificationStatus: VerificationStatus;
  panNumber: string | null;
  nameAsPerPan: string | null;
  gstRegistered: boolean;
  gstNumber: string | null;
  billingName: string | null;
  billingAddress: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingPincode: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

interface DirectUpiAuditEntry {
  id: string;
  allowDirectUpi: boolean;
  previousValue: boolean;
  adminName: string | null;
  changedAt: string;
}

interface PaymentDestination {
  id: string;
  upiId: string;
  payeeName: string;
  status: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "LEGACY_APPROVED";
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

interface VerificationDocument { id: string; documentType: string; filename: string; readUrl: string; }

const VERIF_META: Record<VerificationStatus, { label: string; className: string }> = {
  NOT_SUBMITTED: { label: "Not submitted", className: "border-muted-foreground/30 text-muted-foreground" },
  UNDER_REVIEW: { label: "Under review", className: "border-amber-300 text-amber-700" },
  VERIFIED: { label: "Verified", className: "border-emerald-300 text-emerald-700" },
  REJECTED: { label: "Rejected", className: "border-destructive/40 text-destructive" },
  SUSPENDED: { label: "Suspended", className: "border-destructive/40 text-destructive" },
};

const VERIF_FILTERS: Array<{ value: "all" | VerificationStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "VERIFIED", label: "Verified" },
  { value: "REJECTED", label: "Rejected" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "NOT_SUBMITTED", label: "Not submitted" },
];

function formatINR(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}
function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const AdminOrganizers = () => {
  const [rows, setRows] = useState<OrganizerOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [verifFilter, setVerifFilter] = useState<"all" | VerificationStatus>("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState({ organizers: 0, participants: 0, revenue: 0, pendingVerification: 0 });
  const pageSize = 24;

  // Verification review dialog
  const [reviewOrg, setReviewOrg] = useState<OrganizerOverview | null>(null);
  const [detail, setDetail] = useState<VerificationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [verificationDocuments, setVerificationDocuments] = useState<VerificationDocument[]>([]);

  // Direct UPI manage dialog
  const [manageOrg, setManageOrg] = useState<OrganizerOverview | null>(null);
  const [upiAudit, setUpiAudit] = useState<DirectUpiAuditEntry[]>([]);
  const [upiAuditLoading, setUpiAuditLoading] = useState(false);
  const [upiToggleBusy, setUpiToggleBusy] = useState(false);
  const [upiWarningEvents, setUpiWarningEvents] = useState<Array<{ id: string; name: string }>>([]);
  const [destinations, setDestinations] = useState<PaymentDestination[]>([]);
  const [destinationReason, setDestinationReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (search.trim()) params.set("q", search.trim());
      if (verifFilter !== "all") params.set("verification_status", verifFilter);
      const response = await apiRequest<{ items: OrganizerOverview[]; total: number; summary: { organizers: number; pendingVerification: number; participants: number; approvedRevenuePaise: number } }>(`/admin/organizers/overview?${params}`);
      setRows(response.items);
      setTotal(response.total);
      setTotals({ organizers: response.summary.organizers, participants: response.summary.participants, revenue: response.summary.approvedRevenuePaise, pendingVerification: response.summary.pendingVerification });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load organizers.");
    } finally {
      setLoading(false);
    }
  }, [page, search, verifFilter]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);

  const filtered = rows;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // ── Verification review ──────────────────────────────────────────────────
  const openReview = async (org: OrganizerOverview) => {
    setReviewOrg(org);
    setDetail(null);
    setRejectReason("");
    setVerificationDocuments([]);
    setDetailLoading(true);
    try {
      const [verification, documents] = await Promise.all([
        apiRequest<VerificationDetail>(`/organizer/organizations/${org.organizationId}/paid-verification`),
        apiRequest<VerificationDocument[]>(`/organizer/organizations/${org.organizationId}/paid-verification/documents`),
      ]);
      setDetail(verification);
      setVerificationDocuments(documents);
    } catch (detailError) {
      toast.error(detailError instanceof Error ? detailError.message : "Could not load verification details.");
    } finally {
      setDetailLoading(false);
    }
  };

  const closeReview = () => { setReviewOrg(null); setDetail(null); setRejectReason(""); setVerificationDocuments([]); };

  const review = async (decision: "VERIFIED" | "REJECTED") => {
    if (!reviewOrg) return;
    if (decision === "REJECTED" && !rejectReason.trim()) { toast.error("Add a reason for rejection."); return; }
    setActionBusy(true);
    try {
      await apiRequest(`/admin/organizations/${reviewOrg.organizationId}/paid-verification/review`, {
        method: "POST",
        body: JSON.stringify({ status: decision, rejection_reason: decision === "REJECTED" ? rejectReason.trim() : null }),
      });
      toast.success(decision === "VERIFIED" ? "Organizer verified." : "Verification rejected.");
      closeReview();
      await load();
    } catch (reviewError) {
      toast.error(reviewError instanceof Error ? reviewError.message : "Could not submit the review.");
    } finally {
      setActionBusy(false);
    }
  };

  const suspendVerification = async () => {
    if (!reviewOrg || !rejectReason.trim()) { toast.error("Add a reason before suspending paid access."); return; }
    setActionBusy(true);
    try {
      await apiRequest(`/admin/organizations/${reviewOrg.organizationId}/paid-verification/suspend`, {
        method: "POST", body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      toast.success("Paid verification suspended. New paid transactions are blocked.");
      closeReview();
      await load();
    } catch (suspendError) {
      toast.error(suspendError instanceof Error ? suspendError.message : "Could not suspend paid verification.");
    } finally {
      setActionBusy(false);
    }
  };

  // ── Direct UPI manage dialog ─────────────────────────────────────────────
  const openManage = async (org: OrganizerOverview) => {
    setManageOrg(org);
    setUpiAudit([]);
    setUpiWarningEvents([]);
    setDestinations([]);
    setDestinationReason("");
    setUpiAuditLoading(true);
    try {
      const [audit, paymentDestinations] = await Promise.all([
        apiRequest<DirectUpiAuditEntry[]>(`/admin/organizations/${org.organizationId}/direct-upi/audit`),
        apiRequest<PaymentDestination[]>(`/admin/organizations/${org.organizationId}/payment-destinations`),
      ]);
      setUpiAudit(audit);
      setDestinations(paymentDestinations);
    } catch {
      // Non-blocking; audit history is informational only
    } finally {
      setUpiAuditLoading(false);
    }
  };

  const closeManage = () => { setManageOrg(null); setUpiAudit([]); setUpiWarningEvents([]); setDestinations([]); setDestinationReason(""); };

  const reviewDestination = async (destination: PaymentDestination, decision: "APPROVED" | "REJECTED") => {
    if (!manageOrg) return;
    if (decision === "REJECTED" && !destinationReason.trim()) { toast.error("Add a reason before rejecting the destination."); return; }
    setUpiToggleBusy(true);
    try {
      await apiRequest(`/admin/organizations/${manageOrg.organizationId}/payment-destinations/${destination.id}/review`, {
        method: "POST",
        body: JSON.stringify({ status: decision, rejection_reason: decision === "REJECTED" ? destinationReason.trim() : null }),
      });
      setDestinations(await apiRequest<PaymentDestination[]>(`/admin/organizations/${manageOrg.organizationId}/payment-destinations`));
      setDestinationReason("");
      toast.success(decision === "APPROVED" ? "Payment destination approved." : "Payment destination rejected.");
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : "Could not review the destination.");
    } finally {
      setUpiToggleBusy(false);
    }
  };

  const toggleDirectUpi = async (allow: boolean) => {
    if (!manageOrg) return;
    setUpiToggleBusy(true);
    try {
      const result = await apiRequest<{ allowDirectUpi: boolean; activeDirectUpiEvents: Array<{ id: string; name: string }> }>(
        `/admin/organizations/${manageOrg.organizationId}/direct-upi`,
        { method: "PUT", body: JSON.stringify({ allow }) },
      );
      // Surface warning if disabling with live events
      if (!allow && result.activeDirectUpiEvents.length > 0) {
        setUpiWarningEvents(result.activeDirectUpiEvents);
      }
      toast.success(allow ? "Direct UPI enabled for this organizer." : "Direct UPI access removed.");
      // Update local row without full reload
      setRows((prev) => prev.map((r) => r.organizationId === manageOrg.organizationId ? { ...r, allowDirectUpi: result.allowDirectUpi } : r));
      setManageOrg((prev) => prev ? { ...prev, allowDirectUpi: result.allowDirectUpi } : null);
      // Refresh audit trail
      const freshAudit = await apiRequest<DirectUpiAuditEntry[]>(`/admin/organizations/${manageOrg.organizationId}/direct-upi/audit`);
      setUpiAudit(freshAudit);
    } catch (toggleError) {
      toast.error(toggleError instanceof Error ? toggleError.message : "Could not update Direct UPI access.");
    } finally {
      setUpiToggleBusy(false);
    }
  };

  return (
    <AdminDashboardLayout>
      <div className="mx-auto max-w-[1500px] space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Organizer management</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Organizers</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">Open any organizer to manage events, pricing, Credits, verification, and payment access.</p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading} className="w-fit gap-2"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
        </div>

        {error ? (
          <Card><CardContent className="flex flex-col gap-4 p-6"><p role="alert" className="text-sm text-destructive">{error}</p><Button onClick={() => void load()} className="w-fit">Try again</Button></CardContent></Card>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard icon={Building2} tone="primary" label="Organizers" value={totals.organizers.toLocaleString("en-IN")} sub={`${totals.pendingVerification} awaiting verification`} />
              <StatCard icon={Users} tone="blue" label="Total participants" value={totals.participants.toLocaleString("en-IN")} sub="Confirmed across all events" />
              <StatCard icon={CircleDollarSign} tone="green" label="Approved sales" value={formatINR(totals.revenue)} sub="Participant registration value" />
            </section>

            <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="flex flex-col gap-3 border-b p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative w-full lg:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input aria-label="Search organizers" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search by name, person, email, or location" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
                </div>
                <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1" role="tablist" aria-label="Filter by verification">
                  {VERIF_FILTERS.map((filter) => (
                    <button key={filter.value} type="button" role="tab" aria-selected={verifFilter === filter.value} onClick={() => { setVerifFilter(filter.value); setPage(1); }} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${verifFilter === filter.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{filter.label}</button>
                  ))}
                </div>
              </div>

              {loading && rows.length === 0 ? (
                <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div>
              ) : filtered.length === 0 ? (
                <div className="p-12 text-center"><Building2 className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-4 font-semibold">No organizers found</p><p className="mt-1 text-sm text-muted-foreground">Try a different search or filter.</p></div>
              ) : (
                <div className="grid gap-4 p-5 lg:grid-cols-2">
                  {filtered.map((row) => {
                    const meta = VERIF_META[row.paidVerificationStatus];
                    return <button key={row.organizationId} type="button" onClick={() => void openManage(row)} className="group rounded-2xl border bg-background p-5 text-left transition hover:border-primary/40 hover:shadow-md">
                      <div className="flex items-start justify-between gap-4"><div className="min-w-0"><h3 className="truncate text-lg font-bold">{row.organizationName}</h3><p className="truncate text-sm text-muted-foreground">{row.responsiblePerson ?? "Responsible person not set"}{row.email ? ` · ${row.email}` : ""}</p><p className="text-xs text-muted-foreground">{[row.city, row.state].filter(Boolean).join(", ") || "Location not set"}</p></div><span className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition group-hover:border-primary group-hover:text-primary">Manage</span></div>
                      <div className="mt-5 grid grid-cols-3 gap-2"><div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Events</p><p className="font-bold">{row.eventsPublished} / {row.eventsTotal}</p></div><div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Participants</p><p className="font-bold">{row.totalParticipants.toLocaleString("en-IN")}</p></div><div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Sales</p><p className="font-bold">{formatINR(row.approvedRevenuePaise)}</p></div></div>
                      <div className="mt-4 flex flex-wrap gap-2"><Badge variant="outline" className={`gap-1 ${meta.className}`}>{row.paidVerificationStatus === "VERIFIED" ? <BadgeCheck className="h-3.5 w-3.5" /> : row.paidVerificationStatus === "UNDER_REVIEW" ? <Clock className="h-3.5 w-3.5" /> : row.paidVerificationStatus === "REJECTED" ? <XCircle className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}{meta.label}</Badge><Badge variant="outline" className={row.allowDirectUpi ? "border-emerald-300 text-emerald-700" : "text-muted-foreground"}><Banknote className="mr-1 h-3 w-3" />UPI {row.allowDirectUpi ? "allowed" : "restricted"}</Badge></div>
                    </button>;
                  })}
                </div>
              )}
              {total > pageSize && <div className="flex items-center justify-between gap-3 border-t px-5 py-4"><p className="text-sm text-muted-foreground">Page {page} of {totalPages} · {total.toLocaleString("en-IN")} organizers</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>}
            </section>
          </>
        )}
      </div>

      {/* ── Verification review dialog ───────────────────────────────────── */}
      <Dialog open={reviewOrg !== null} onOpenChange={(open) => { if (!open) closeReview(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Paid verification — {reviewOrg?.organizationName}</DialogTitle>
            <DialogDescription>Review the submitted details and approve or reject.</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <p className="py-6 text-sm text-muted-foreground">Loading details…</p>
          ) : detail ? (
            <div className="space-y-4">
              <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                <Field label="Organization" value={detail.organizationName} />
                <Field label="Organization type" value={detail.organizationType?.replaceAll("_", " ") ?? null} />
                <Field label="City / State" value={[detail.city, detail.state].filter(Boolean).join(", ")} />
                <Field label="PAN" value={detail.panNumber} />
                <Field label="Name as per PAN" value={detail.nameAsPerPan} />
                <Field label="GST registered" value={detail.gstRegistered ? "Yes" : "No"} />
                <Field label="GSTIN" value={detail.gstNumber} />
                <Field label="Billing / legal name" value={detail.billingName} />
                <Field label="PIN code" value={detail.billingPincode} />
                <div className="sm:col-span-2"><Field label="Billing address" value={[detail.billingAddress, detail.billingCity, detail.billingState].filter(Boolean).join(", ")} /></div>
                <Field label="Submitted" value={formatDate(detail.submittedAt)} />
                <Field label="Current status" value={VERIF_META[detail.paidVerificationStatus].label} />
              </dl>

              <div><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Supporting documents</p>{verificationDocuments.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">No documents submitted.</p> : <div className="mt-2 flex flex-wrap gap-2">{verificationDocuments.map((document) => <Button key={document.id} asChild size="sm" variant="outline"><a href={document.readUrl} target="_blank" rel="noreferrer">{document.documentType.replaceAll("_", " ")}: {document.filename}</a></Button>)}</div>}</div>

              {detail.paidVerificationStatus === "REJECTED" && detail.rejectionReason && (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Previous rejection: {detail.rejectionReason}</p>
              )}

              {detail.paidVerificationStatus === "UNDER_REVIEW" && (
                <div className="space-y-2">
                  <Label htmlFor="reject-reason">Rejection reason <span className="font-normal text-muted-foreground">(required to reject)</span></Label>
                  <Textarea id="reject-reason" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} rows={3} maxLength={2000} placeholder="Explain what needs to be corrected" />
                </div>
              )}
              {detail.paidVerificationStatus === "VERIFIED" && (
                <div className="space-y-2"><Label htmlFor="suspend-reason">Suspension reason</Label><Textarea id="suspend-reason" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} rows={3} maxLength={2000} placeholder="Required before suspending paid registrations" /></div>
              )}
            </div>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">No details available.</p>
          )}

          <DialogFooter>
            {detail?.paidVerificationStatus === "UNDER_REVIEW" ? (
              <>
                <Button variant="outline" onClick={() => void review("REJECTED")} disabled={actionBusy} className="text-destructive hover:text-destructive">Reject</Button>
                <Button onClick={() => void review("VERIFIED")} disabled={actionBusy}>{actionBusy ? "Saving…" : "Verify"}</Button>
              </>
            ) : detail?.paidVerificationStatus === "VERIFIED" ? (
              <><Button variant="destructive" onClick={() => void suspendVerification()} disabled={actionBusy}>Suspend paid access</Button><Button variant="outline" onClick={closeReview}>Close</Button></>
            ) : (
              <Button variant="outline" onClick={closeReview}>Close</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Direct UPI manage dialog ─────────────────────────────────────── */}
      <Dialog open={manageOrg !== null} onOpenChange={(open) => { if (!open) closeManage(); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage — {manageOrg?.organizationName}</DialogTitle>
            <DialogDescription>Events, pricing, Credits, verification, and payment controls in one place.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">Events</p><p className="text-xl font-bold">{manageOrg?.eventsTotal ?? 0}</p></div>
              <div className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">Published</p><p className="text-xl font-bold">{manageOrg?.eventsPublished ?? 0}</p></div>
              <div className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">Participants</p><p className="text-xl font-bold">{manageOrg?.totalParticipants ?? 0}</p></div>
              <div className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">UPI status</p><p className="text-sm font-bold">{manageOrg?.allowDirectUpi ? "Allowed" : "Restricted"}</p></div>
            </section>
            <section className="rounded-xl border p-4"><p className="font-semibold">Organizer controls</p><p className="mt-1 text-xs text-muted-foreground">Open the detailed workspace for pricing and Credit history.</p><div className="mt-3 flex flex-wrap gap-2"><Button asChild size="sm"><Link to="/admin/organizer-pricing">Configure pricing</Link></Button><Button asChild size="sm" variant="outline"><Link to="/admin/credits">Open Credits ledger</Link></Button><Button size="sm" variant="outline" onClick={() => void openReview(manageOrg!)}>Verification details</Button></div></section>
            {/* Payment Access section */}
            <section className="rounded-xl border p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-sm">Allow Direct UPI Payments</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Direct UPI sends participant registration payments directly to the organizer.
                    SportPass platform fees are billed separately.
                    Enable this only for approved or trusted organizers.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={manageOrg?.allowDirectUpi ?? false}
                  disabled={upiToggleBusy}
                  onClick={() => void toggleDirectUpi(!(manageOrg?.allowDirectUpi ?? false))}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${(manageOrg?.allowDirectUpi ?? false) ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform ${(manageOrg?.allowDirectUpi ?? false) ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>
              <div className={`rounded-md px-3 py-2 text-xs font-semibold ${(manageOrg?.allowDirectUpi ?? false) ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-muted text-muted-foreground"}`}>
                {(manageOrg?.allowDirectUpi ?? false) ? "Direct UPI: Allowed" : "Direct UPI: Restricted"}
              </div>
            </section>

            <section className="rounded-xl border p-4 space-y-3">
              <div><p className="font-semibold text-sm">Payment destinations</p><p className="mt-1 text-xs text-muted-foreground">Only an approved destination can receive new Direct UPI registrations or merchandise orders.</p></div>
              {destinations.length === 0 ? <p className="text-xs text-muted-foreground">No UPI destination submitted.</p> : destinations.map((destination) => (
                <div key={destination.id} className="rounded-lg border bg-muted/20 p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{destination.upiId}</p><p className="text-xs text-muted-foreground">{destination.payeeName} · submitted {formatDate(destination.submittedAt)}</p></div><Badge variant="outline">{destination.status.replaceAll("_", " ")}</Badge></div>
                  {destination.rejectionReason && <p className="mt-2 text-xs text-destructive">Reason: {destination.rejectionReason}</p>}
                  {(destination.status === "UNDER_REVIEW" || destination.status === "LEGACY_APPROVED") && (
                    <div className="mt-3 space-y-2"><Textarea value={destinationReason} onChange={(event) => setDestinationReason(event.target.value)} rows={2} maxLength={2000} placeholder="Reason required only when rejecting" /><div className="flex gap-2"><Button size="sm" onClick={() => void reviewDestination(destination, "APPROVED")} disabled={upiToggleBusy}>Approve destination</Button><Button size="sm" variant="outline" className="text-destructive" onClick={() => void reviewDestination(destination, "REJECTED")} disabled={upiToggleBusy}>Reject</Button></div></div>
                  )}
                </div>
              ))}
            </section>

            {/* Warning: active Direct UPI events */}
            {upiWarningEvents.length > 0 && (
              <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-2">
                <p className="font-semibold">⚠ This organizer has {upiWarningEvents.length} active event{upiWarningEvents.length > 1 ? "s" : ""} using Direct UPI.</p>
                <p className="text-xs">Access has been removed. New registrations on these events will be blocked at the backend. Existing registrations and historical payments are not affected. Switch the event's payment method before next registration opens.</p>
                <ul className="mt-1 space-y-1 text-xs">
                  {upiWarningEvents.map((ev) => <li key={ev.id} className="font-medium">• {ev.name}</li>)}
                </ul>
              </section>
            )}

            {/* Audit history */}
            <section>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Change history</p>
              {upiAuditLoading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : upiAudit.length === 0 ? (
                <p className="text-xs text-muted-foreground">No changes recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {upiAudit.map((entry) => (
                    <div key={entry.id} className="rounded-lg border bg-muted/20 p-3 text-xs space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`font-semibold ${entry.allowDirectUpi ? "text-emerald-700" : "text-muted-foreground"}`}>
                          {entry.allowDirectUpi ? "Enabled" : "Disabled"}
                        </span>
                        <span className="text-muted-foreground">{formatDateTime(entry.changedAt)}</span>
                      </div>
                      {entry.adminName && <p className="text-muted-foreground">By: {entry.adminName}</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeManage}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminDashboardLayout>
  );
};

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value || "—"}</dd>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, tone }: { icon: typeof Users; label: string; value: string; sub: string; tone: "primary" | "blue" | "green" | "orange" }) {
  const toneClass = tone === "orange" ? "bg-orange-100 text-orange-700" : tone === "green" ? "bg-emerald-100 text-emerald-700" : tone === "blue" ? "bg-blue-100 text-blue-700" : "bg-primary/10 text-primary";
  return (
    <Card className="h-full"><CardContent className="flex items-start justify-between gap-4 p-5">
      <div><p className="text-sm font-medium text-muted-foreground">{label}</p><p className="mt-3 text-3xl font-black tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{sub}</p></div>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneClass}`}><Icon className="h-5 w-5" /></span>
    </CardContent></Card>
  );
}

export default AdminOrganizers;
