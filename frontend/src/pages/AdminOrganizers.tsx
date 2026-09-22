import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Building2, CircleDollarSign, Clock, RefreshCw, Search, ShieldCheck, Users, XCircle, Banknote } from "lucide-react";
import { toast } from "sonner";

import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/api";

type VerificationStatus = "NOT_SUBMITTED" | "UNDER_REVIEW" | "VERIFIED" | "REJECTED";

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
  billingDuePaise: number;
  billingCollectedPaise: number;
  overdueBillingCount: number;
  allowDirectUpi: boolean;
}

interface VerificationDetail {
  organizationId: string;
  organizationName: string;
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

const VERIF_META: Record<VerificationStatus, { label: string; className: string }> = {
  NOT_SUBMITTED: { label: "Not submitted", className: "border-muted-foreground/30 text-muted-foreground" },
  UNDER_REVIEW: { label: "Under review", className: "border-amber-300 text-amber-700" },
  VERIFIED: { label: "Verified", className: "border-emerald-300 text-emerald-700" },
  REJECTED: { label: "Rejected", className: "border-destructive/40 text-destructive" },
};

const VERIF_FILTERS: Array<{ value: "all" | VerificationStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "VERIFIED", label: "Verified" },
  { value: "REJECTED", label: "Rejected" },
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

  // Verification review dialog
  const [reviewOrg, setReviewOrg] = useState<OrganizerOverview | null>(null);
  const [detail, setDetail] = useState<VerificationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  // Direct UPI manage dialog
  const [manageOrg, setManageOrg] = useState<OrganizerOverview | null>(null);
  const [upiAudit, setUpiAudit] = useState<DirectUpiAuditEntry[]>([]);
  const [upiAuditLoading, setUpiAuditLoading] = useState(false);
  const [upiToggleBusy, setUpiToggleBusy] = useState(false);
  const [upiWarningEvents, setUpiWarningEvents] = useState<Array<{ id: string; name: string }>>([]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await apiRequest<OrganizerOverview[]>("/admin/organizers/overview"));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load organizers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.organizers += 1;
        acc.participants += row.totalParticipants;
        acc.revenue += row.approvedRevenuePaise;
        acc.due += row.billingDuePaise;
        if (row.paidVerificationStatus === "UNDER_REVIEW") acc.pendingVerification += 1;
        return acc;
      },
      { organizers: 0, participants: 0, revenue: 0, due: 0, pendingVerification: 0 },
    );
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesVerif = verifFilter === "all" || row.paidVerificationStatus === verifFilter;
      const matchesSearch = !q || [row.organizationName, row.responsiblePerson, row.email, row.city, row.state].filter(Boolean).some((v) => v!.toLowerCase().includes(q));
      return matchesVerif && matchesSearch;
    });
  }, [rows, search, verifFilter]);

  // ── Verification review ──────────────────────────────────────────────────
  const openReview = async (org: OrganizerOverview) => {
    setReviewOrg(org);
    setDetail(null);
    setRejectReason("");
    setDetailLoading(true);
    try {
      setDetail(await apiRequest<VerificationDetail>(`/organizer/organizations/${org.organizationId}/paid-verification`));
    } catch (detailError) {
      toast.error(detailError instanceof Error ? detailError.message : "Could not load verification details.");
    } finally {
      setDetailLoading(false);
    }
  };

  const closeReview = () => { setReviewOrg(null); setDetail(null); setRejectReason(""); };

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

  // ── Direct UPI manage dialog ─────────────────────────────────────────────
  const openManage = async (org: OrganizerOverview) => {
    setManageOrg(org);
    setUpiAudit([]);
    setUpiWarningEvents([]);
    setUpiAuditLoading(true);
    try {
      setUpiAudit(await apiRequest<DirectUpiAuditEntry[]>(`/admin/organizations/${org.organizationId}/direct-upi/audit`));
    } catch {
      // Non-blocking; audit history is informational only
    } finally {
      setUpiAuditLoading(false);
    }
  };

  const closeManage = () => { setManageOrg(null); setUpiAudit([]); setUpiWarningEvents([]); };

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
            <p className="mt-2 max-w-2xl text-muted-foreground">Every organizer with their events, participants, verification status, and billing at a glance.</p>
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
              <StatCard icon={CircleDollarSign} tone="orange" label="Billing due" value={formatINR(totals.due)} sub="Outstanding platform fees" />
            </section>

            <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="flex flex-col gap-3 border-b p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative w-full lg:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input aria-label="Search organizers" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, person, email, or location" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
                </div>
                <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1" role="tablist" aria-label="Filter by verification">
                  {VERIF_FILTERS.map((filter) => (
                    <button key={filter.value} type="button" role="tab" aria-selected={verifFilter === filter.value} onClick={() => setVerifFilter(filter.value)} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${verifFilter === filter.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{filter.label}</button>
                  ))}
                </div>
              </div>

              {loading && rows.length === 0 ? (
                <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div>
              ) : filtered.length === 0 ? (
                <div className="p-12 text-center"><Building2 className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-4 font-semibold">No organizers found</p><p className="mt-1 text-sm text-muted-foreground">Try a different search or filter.</p></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1200px] text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-semibold">Organizer</th>
                        <th className="px-4 py-3 font-semibold">Events</th>
                        <th className="px-4 py-3 font-semibold">Participants</th>
                        <th className="px-4 py-3 font-semibold">Approved sales</th>
                        <th className="px-4 py-3 font-semibold">Verification</th>
                        <th className="px-4 py-3 font-semibold">Payment access</th>
                        <th className="px-4 py-3 font-semibold">Billing due</th>
                        <th className="px-4 py-3 font-semibold">Collected</th>
                        <th className="px-4 py-3 font-semibold text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row) => {
                        const meta = VERIF_META[row.paidVerificationStatus];
                        return (
                          <tr key={row.organizationId} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="px-4 py-3">
                              <div className="font-semibold">{row.organizationName}</div>
                              <div className="text-xs text-muted-foreground">{row.responsiblePerson ?? "—"}{row.email ? ` · ${row.email}` : ""}</div>
                              <div className="text-xs text-muted-foreground">{[row.city, row.state].filter(Boolean).join(", ") || "Location not set"}</div>
                            </td>
                            <td className="px-4 py-3"><span className="font-semibold">{row.eventsPublished}</span> <span className="text-muted-foreground">/ {row.eventsTotal}</span><div className="text-xs text-muted-foreground">published / total</div></td>
                            <td className="px-4 py-3 font-semibold">{row.totalParticipants.toLocaleString("en-IN")}</td>
                            <td className="px-4 py-3 font-semibold">{formatINR(row.approvedRevenuePaise)}</td>
                            <td className="px-4 py-3"><Badge variant="outline" className={`gap-1 ${meta.className}`}>{row.paidVerificationStatus === "VERIFIED" ? <BadgeCheck className="h-3.5 w-3.5" /> : row.paidVerificationStatus === "UNDER_REVIEW" ? <Clock className="h-3.5 w-3.5" /> : row.paidVerificationStatus === "REJECTED" ? <XCircle className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}{meta.label}</Badge></td>
                            <td className="px-4 py-3">
                              <Badge variant="outline" className={`gap-1 text-xs ${row.allowDirectUpi ? "border-emerald-300 text-emerald-700" : "border-muted-foreground/30 text-muted-foreground"}`}>
                                <Banknote className="h-3 w-3" />
                                {row.allowDirectUpi ? "Direct UPI: Allowed" : "Direct UPI: Restricted"}
                              </Badge>
                            </td>
                            <td className="px-4 py-3"><span className={row.billingDuePaise > 0 ? "font-semibold text-amber-700" : "text-muted-foreground"}>{formatINR(row.billingDuePaise)}</span>{row.overdueBillingCount > 0 && <div className="text-xs font-semibold text-destructive">{row.overdueBillingCount} overdue</div>}</td>
                            <td className="px-4 py-3 text-muted-foreground">{formatINR(row.billingCollectedPaise)}</td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button size="sm" variant="outline" onClick={() => void openManage(row)}>Manage</Button>
                                {row.paidVerificationStatus !== "NOT_SUBMITTED" && (
                                  <Button size="sm" variant={row.paidVerificationStatus === "UNDER_REVIEW" ? "default" : "outline"} onClick={() => void openReview(row)}>
                                    {row.paidVerificationStatus === "UNDER_REVIEW" ? "Review" : "Verify"}
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
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

              {detail.paidVerificationStatus === "REJECTED" && detail.rejectionReason && (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Previous rejection: {detail.rejectionReason}</p>
              )}

              {detail.paidVerificationStatus === "UNDER_REVIEW" && (
                <div className="space-y-2">
                  <Label htmlFor="reject-reason">Rejection reason <span className="font-normal text-muted-foreground">(required to reject)</span></Label>
                  <Textarea id="reject-reason" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} rows={3} maxLength={2000} placeholder="Explain what needs to be corrected" />
                </div>
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
            ) : (
              <Button variant="outline" onClick={closeReview}>Close</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Direct UPI manage dialog ─────────────────────────────────────── */}
      <Dialog open={manageOrg !== null} onOpenChange={(open) => { if (!open) closeManage(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage — {manageOrg?.organizationName}</DialogTitle>
            <DialogDescription>Control payment access permissions for this organizer.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
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
