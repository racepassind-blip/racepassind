import { useCallback, useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Clock3, FileCheck2, History, MapPin, RefreshCw, Search, ShieldCheck, WalletCards, X } from "lucide-react";
import { toast } from "sonner";

import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/api";

interface OrganizerApplication {
  id: string;
  organizationName: string;
  applicantName: string;
  email: string;
  phone: string | null;
  message: string | null;
  status: "pending" | "changes_requested" | "approved" | "rejected";
  paymentDetails: Record<string, string>;
  hasIdProof: boolean;
  rejectionReason: string | null;
  createdAt: string | null;
  organizationType: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  eventHistory: string | null;
  discoverySource: string | null;
  paymentPreference: string | null;
  idProofType: string | null;
  idProofFilename: string | null;
  idProofUrl: string | null;
  privacyPolicyAccepted: boolean;
}

interface OrganizerApplicationPage {
  items: OrganizerApplication[];
  total: number;
}

const AdminOrganizerApplications = () => {
  const [applications, setApplications] = useState<OrganizerApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [history, setHistory] = useState<Record<string, {id: string; action: string; actor: string; createdAt: string}[]>>({});
  const pageSize = 20;
  const statusOptions = [["pending", "Pending"], ["changes_requested", "Corrections"], ["approved", "Approved"], ["rejected", "Rejected"], ["", "All"]] as const;

  const readiness = (application: OrganizerApplication) => [application.hasIdProof, Boolean(application.address && application.city && application.state && application.pincode), Boolean(application.eventHistory), application.privacyPolicyAccepted, Boolean(application.paymentPreference)].filter(Boolean).length;
  const statusTone = (status: OrganizerApplication["status"]) => status === "pending" ? "border-amber-200 bg-amber-50 text-amber-800" : status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : status === "rejected" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-blue-200 bg-blue-50 text-blue-800";

  const loadApplications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<OrganizerApplicationPage>(`/admin/organizer-applications?${statusFilter ? "status=" + statusFilter + "&" : ""}page=${page}&page_size=${pageSize}`);
      setApplications(response.items);
      setTotal(response.total);
      if (response.items.length === 0 && page > 1) setPage((current) => current - 1);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load organizer applications.");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    void loadApplications();
  }, [loadApplications]);

  const approve = async (application: OrganizerApplication) => {
    if (!window.confirm(`Approve ${application.applicantName} as an organizer for ${application.organizationName}?`)) return;
    setReviewingId(application.id);
    try {
      await apiRequest(`/admin/organizer-applications/${application.id}/approve`, { method: "POST", body: "{}" });
      toast.success("Organizer application approved.");
      await loadApplications();
    } catch (approveError) {
      toast.error(approveError instanceof Error ? approveError.message : "Could not approve application.");
    } finally {
      setReviewingId(null);
    }
  };

  const reject = async (application: OrganizerApplication) => {
    const reason = window.prompt("Explain why this application is being rejected:", "");
    if (reason === null) return;
    if (reason.trim().length < 5) {toast.error("Please provide a clear reason."); return;}
    setReviewingId(application.id);
    try {
      await apiRequest(`/admin/organizer-applications/${application.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      toast.success("Organizer application rejected.");
      await loadApplications();
    } catch (rejectError) {
      toast.error(rejectError instanceof Error ? rejectError.message : "Could not reject application.");
    } finally {
      setReviewingId(null);
    }
  };

  const requestChanges = async (application: OrganizerApplication) => {
    const reason = window.prompt("Which details should the organizer correct?");
    if (!reason) return;
    setReviewingId(application.id);
    try {
      await apiRequest(`/admin/organizer-applications/${application.id}/request-changes`, {method: "POST", body: JSON.stringify({reason})});
      toast.success("Corrections requested.");
      await loadApplications();
    } catch (error) {toast.error(error instanceof Error ? error.message : "Could not request corrections");}
    finally {setReviewingId(null);}
  };
  const showHistory = async (id: string) => {
    try {
      const response = await apiRequest<{items: {id: string; action: string; actor: string; createdAt: string}[]}>(`/admin/organizer-applications/${id}/history`);
      setHistory(current => ({...current, [id]: response.items}));
    } catch (error) {toast.error(error instanceof Error ? error.message : "Could not load history");}
  };
  const openProof = async (id: string) => {
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const result = await apiRequest<{url: string}>(`/admin/organizer-applications/${id}/id-proof`, {method: "POST", body: "{}"});
      if (tab) tab.location.href = result.url;
      else toast.error("Allow pop-ups to open the document.");
    } catch (error) { tab?.close(); toast.error(error instanceof Error ? error.message : "Could not open proof"); }
  };

  return (
    <AdminDashboardLayout>
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4" /> Admin-only review</div>
            <h1 className="text-3xl font-extrabold tracking-tight">Organizer applications</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">Review applications before granting access to participant data, events, and registration management.</p>
          </div>
          <Button variant="outline" onClick={() => void loadApplications()} disabled={loading} className="gap-2"><RefreshCw className="h-4 w-4" /> Refresh</Button>
        </div>

        <div className="mb-7 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Showing</span><Search className="h-4 w-4 text-primary" /></div><p className="mt-2 text-2xl font-black">{total}</p><p className="text-xs text-muted-foreground">{statusFilter ? statusOptions.find(([value]) => value === statusFilter)?.[1] : "All applications"}</p></div><div className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Review focus</span><Clock3 className="h-4 w-4 text-amber-600" /></div><p className="mt-2 text-lg font-bold">Evidence first</p><p className="text-xs text-muted-foreground">Identity, address, event plan</p></div><div className="rounded-2xl border bg-card p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Access rule</span><ShieldCheck className="h-4 w-4 text-emerald-600" /></div><p className="mt-2 text-lg font-bold">Admin controlled</p><p className="text-xs text-muted-foreground">Payment permissions stay separate</p></div></div>
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border bg-card p-2 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap gap-1" aria-label="Application status">{statusOptions.map(([value, label]) => <Button key={value} size="sm" variant={statusFilter === value ? "default" : "ghost"} onClick={() => {setStatusFilter(value); setPage(1);}}>{label}</Button>)}</div><Button variant="ghost" size="sm" onClick={() => void loadApplications()} disabled={loading} className="gap-2"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh queue</Button></div>
        {loading ? <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading applications…</CardContent></Card> : error ? (
          <Card><CardContent className="space-y-4 p-6"><p role="alert" className="text-sm text-destructive">{error}</p><Button onClick={() => void loadApplications()}>Try again</Button></CardContent></Card>
        ) : applications.length === 0 ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">No applications match this status.</CardContent></Card>
        ) : (
          <div className="space-y-4">
            {applications.map((application) => (
              <Card key={application.id} className="overflow-hidden border-border/70 shadow-sm transition-shadow hover:shadow-md">
                <div className="h-1 bg-gradient-to-r from-primary via-orange-400 to-amber-200" />
                <CardHeader className="pb-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" /></div><div><CardTitle className="text-xl">{application.organizationName}</CardTitle><CardDescription className="mt-1">{application.applicantName} · {application.email}{application.phone ? ` · ${application.phone}` : ""}</CardDescription></div></div>
                    <Badge variant="outline" className={`w-fit capitalize ${statusTone(application.status)}`}>{application.status.replaceAll("_", " ")}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-4"><div><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Verification readiness</p><p className="mt-1 text-sm font-semibold">{readiness(application)} of 5 checks complete</p></div><div className="flex gap-1.5" aria-label={`${readiness(application)} of 5 checks complete`}>{[0,1,2,3,4].map(index => <span key={index} className={`h-2 w-10 rounded-full ${index < readiness(application) ? "bg-emerald-500" : "bg-muted-foreground/20"}`} />)}</div></div>
                  {application.message && <p className="rounded-lg bg-secondary/60 p-4 text-sm text-muted-foreground">{application.message}</p>}
                  <div className="grid gap-4 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-2">
                    <div><p className="flex items-center gap-2 font-semibold"><FileCheck2 className="h-4 w-4 text-primary" /> Organization</p><p className="mt-1 capitalize text-muted-foreground">{application.organizationType?.replaceAll("_", " ") || "Not provided"}</p></div>
                    <div><p className="flex items-center gap-2 font-semibold"><WalletCards className="h-4 w-4 text-primary" /> Payment preference</p><p className="mt-1 capitalize text-muted-foreground">{application.paymentPreference?.replaceAll("_", " ") || "Not provided"}</p></div>
                    <div><p className="flex items-center gap-2 font-semibold"><MapPin className="h-4 w-4 text-primary" /> Address</p><p className="mt-1 text-muted-foreground">{[application.address, application.city, application.state, application.pincode].filter(Boolean).join(", ") || "Not provided"}</p></div>
                    <div><p className="font-semibold">Discovery source</p><p className="mt-1 capitalize text-muted-foreground">{application.discoverySource?.replaceAll("_", " ") || "Not provided"}</p></div>
                    <div className="sm:col-span-2"><p className="font-semibold">Event background</p><p className="whitespace-pre-wrap text-muted-foreground">{application.eventHistory || "Not provided"}</p></div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm"><div><p className="font-semibold">Identity document</p><p className="text-muted-foreground">{application.idProofType || "Missing"}{application.idProofFilename ? ` · ${application.idProofFilename}` : ""}</p></div>{application.hasIdProof && <Button variant="outline" onClick={() => void openProof(application.id)}>Open private proof</Button>}</div>
                  <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2"><p>{application.privacyPolicyAccepted ? "✓ Privacy consent recorded" : "✕ Privacy consent missing"}</p><p>{application.hasIdProof ? "✓ ID proof uploaded" : "✕ ID proof missing"}</p><p>{application.address && application.city && application.state && application.pincode ? "✓ Address complete" : "✕ Address incomplete"}</p><p>{application.eventHistory ? "✓ Event background provided" : "✕ Event background missing"}</p></div>
                  <div className="rounded-lg bg-muted/30 p-3 text-sm">{Object.entries(application.paymentDetails).map(([key, value]) => <p key={key}><span className="font-medium">{key.replace(/([A-Z])/g, " $1")}: </span>{value}</p>)}<p className="mt-2 text-muted-foreground">Account approval does not enable payments. Review paid-event verification and payment permissions separately.</p></div>
                  {application.rejectionReason && <p className="whitespace-pre-wrap rounded-lg border p-3 text-sm">Review feedback: {application.rejectionReason}</p>}
                  <Button variant="ghost" onClick={() => void showHistory(application.id)} className="gap-2"><History className="h-4 w-4" /> Review history</Button>
                  {history[application.id] && <ul className="space-y-2 text-sm text-muted-foreground">{history[application.id].map(item => <li key={item.id}>{new Date(item.createdAt).toLocaleString("en-IN")} · {item.action.replaceAll("_", " ")} · {item.actor}</li>)}</ul>}
                  {application.status === "pending" && <div className="flex flex-col gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => void requestChanges(application)} disabled={reviewingId === application.id}>Request corrections</Button><Button variant="outline" onClick={() => void reject(application)} disabled={reviewingId === application.id} className="gap-2 text-destructive"><X className="h-4 w-4" /> Reject</Button><Button onClick={() => void approve(application)} disabled={reviewingId === application.id || !application.hasIdProof || !application.address || !application.eventHistory || !application.privacyPolicyAccepted} className="gap-2"><Check className="h-4 w-4" /> {reviewingId === application.id ? "Reviewing…" : "Approve organizer"}</Button></div>}
                </CardContent>
              </Card>
            ))}
            {total > pageSize && <div className="flex items-center justify-between gap-3 pt-2"><p className="text-sm text-muted-foreground">Page {page} of {Math.ceil(total / pageSize)} · {total} applications</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage((current) => current + 1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>}
          </div>
        )}
      </div>
    </AdminDashboardLayout>
  );
};

export default AdminOrganizerApplications;
