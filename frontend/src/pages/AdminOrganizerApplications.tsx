import { useEffect, useState } from "react";
import { Check, RefreshCw, ShieldCheck, X } from "lucide-react";
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
  status: "pending" | "approved" | "rejected";
  rejectionReason: string | null;
  createdAt: string | null;
}

const AdminOrganizerApplications = () => {
  const [applications, setApplications] = useState<OrganizerApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadApplications = async () => {
    setLoading(true);
    setError(null);
    try {
      setApplications(await apiRequest<OrganizerApplication[]>("/admin/organizer-applications?status=pending"));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load organizer applications.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadApplications();
  }, []);

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
    const reason = window.prompt("Optional reason for rejecting this application:", "");
    if (reason === null) return;
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

        {loading ? <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading applications…</CardContent></Card> : error ? (
          <Card><CardContent className="space-y-4 p-6"><p role="alert" className="text-sm text-destructive">{error}</p><Button onClick={() => void loadApplications()}>Try again</Button></CardContent></Card>
        ) : applications.length === 0 ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">No pending organizer applications.</CardContent></Card>
        ) : (
          <div className="space-y-4">
            {applications.map((application) => (
              <Card key={application.id}>
                <CardHeader className="pb-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div><CardTitle>{application.organizationName}</CardTitle><CardDescription className="mt-1">{application.applicantName} · {application.email}{application.phone ? ` · ${application.phone}` : ""}</CardDescription></div>
                    <Badge variant="secondary">Pending review</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  {application.message && <p className="rounded-lg bg-secondary/60 p-4 text-sm text-muted-foreground">{application.message}</p>}
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => void reject(application)} disabled={reviewingId === application.id} className="gap-2 text-destructive"><X className="h-4 w-4" /> Reject</Button><Button onClick={() => void approve(application)} disabled={reviewingId === application.id} className="gap-2"><Check className="h-4 w-4" /> {reviewingId === application.id ? "Reviewing…" : "Approve organizer"}</Button></div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AdminDashboardLayout>
  );
};

export default AdminOrganizerApplications;
