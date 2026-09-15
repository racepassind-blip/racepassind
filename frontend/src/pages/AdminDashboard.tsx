import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Building2, CalendarDays, CheckCircle2, CircleDollarSign, Clock3, RefreshCw, Ticket, UserPlus, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";

import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/api";

interface PendingApplication {
  id: string;
  organizationName: string;
  applicantName: string;
  email: string;
  phone: string | null;
  message: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string | null;
}

interface IncompleteOrganization { id: string; name: string; city: string | null; state: string | null; createdAt: string | null; }
interface DashboardMetrics {
  pendingOrganizerApplications: number;
  incompleteOnboardingOrganizations: number;
  activeRaces: number;
  racesPublishedThisMonth: number;
  registrationsThisMonth: number;
  participantSalesThisMonthPaise: number;
  organizerBillingDuePaise: number;
  organizerBillingCollectedThisMonthPaise: number;
}
interface MonthlyTrend { month: string; label: string; registrations: number; participantSalesPaise: number; racesPublished: number; }
interface AdminDashboardResponse {
  generatedAt: string;
  period: { label: string; start: string; end: string };
  metrics: DashboardMetrics;
  pendingApplications: PendingApplication[];
  incompleteOrganizations: IncompleteOrganization[];
  monthlyTrend: MonthlyTrend[];
}

function formatINR(paise: number) { return `₹${(paise / 100).toLocaleString("en-IN")}`; }
function formatDate(value: string | null) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "numeric", month: "short" }); }

function MetricCard({ title, value, description, icon: Icon, tone = "primary", href }: { title: string; value: string; description: string; icon: typeof Ticket; tone?: "primary" | "orange" | "green" | "blue"; href?: string }) {
  const content = <Card className="h-full transition-shadow hover:shadow-md"><CardContent className="flex items-start justify-between gap-4 p-5"><div><p className="text-sm font-medium text-muted-foreground">{title}</p><p className="mt-3 text-3xl font-black tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></div><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone === "orange" ? "bg-orange-100 text-orange-700" : tone === "green" ? "bg-emerald-100 text-emerald-700" : tone === "blue" ? "bg-blue-100 text-blue-700" : "bg-primary/10 text-primary"}`}><Icon className="h-5 w-5" /></span></CardContent></Card>;
  return href ? <Link to={href} className="block h-full">{content}</Link> : content;
}

const AdminDashboard = () => {
  const [data, setData] = useState<AdminDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try { setData(await apiRequest<AdminDashboardResponse>("/admin/dashboard")); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load the admin dashboard."); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  const maxRegistrations = useMemo(() => Math.max(...(data?.monthlyTrend.map((item) => item.registrations) ?? [0]), 1), [data]);

  return (
    <AdminDashboardLayout>
      <div className="mx-auto max-w-[1500px] space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Good morning, admin</p><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Marketplace overview</h1><p className="mt-2 max-w-2xl text-muted-foreground">See what needs attention today and how SportPass is performing this month.</p></div><Button variant="outline" onClick={() => void load()} disabled={loading} className="w-fit gap-2"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button></div>

        {loading && !data ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Card key={index}><CardContent className="h-36 animate-pulse p-5"><div className="h-4 w-32 rounded bg-muted" /><div className="mt-6 h-8 w-20 rounded bg-muted" /><div className="mt-3 h-3 w-40 rounded bg-muted" /></CardContent></Card>)}</div> : error ? <Card><CardContent className="flex flex-col gap-4 p-6"><p role="alert" className="text-sm text-destructive">{error}</p><Button onClick={() => void load()} className="w-fit">Try again</Button></CardContent></Card> : data ? <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Onboarding requests" value={data.metrics.pendingOrganizerApplications.toLocaleString("en-IN")} description="Waiting for your review" icon={UserPlus} tone="orange" href="/admin/organizer-applications" />
            <MetricCard title="Entries sold this month" value={data.metrics.registrationsThisMonth.toLocaleString("en-IN")} description="Confirmed participant entries" icon={Ticket} tone="green" href="/organizer/registrations" />
            <MetricCard title="Races published this month" value={data.metrics.racesPublishedThisMonth.toLocaleString("en-IN")} description={`${data.metrics.activeRaces.toLocaleString("en-IN")} active races overall`} icon={CalendarDays} tone="blue" href="/organizer" />
            <MetricCard title="Participant sales" value={formatINR(data.metrics.participantSalesThisMonthPaise)} description={`${data.period.label} approved registration value`} icon={CircleDollarSign} />
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
            <Card><CardHeader className="flex flex-row items-start justify-between gap-4"><div><CardTitle>Monthly performance</CardTitle><CardDescription>Confirmed participant entries over the last six months.</CardDescription></div><Badge variant="secondary">{data.period.label}</Badge></CardHeader><CardContent><div className="flex h-56 items-end gap-2 border-b border-l px-2 pb-0 pt-5 sm:gap-4">{data.monthlyTrend.map((item) => <div key={item.month} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><div className="group relative flex h-full w-full items-end justify-center"><div className="w-full max-w-12 rounded-t-lg bg-primary/80 transition-colors group-hover:bg-primary" style={{ height: `${Math.max((item.registrations / maxRegistrations) * 100, item.registrations ? 8 : 2)}%` }} title={`${item.registrations.toLocaleString("en-IN")} entries`} /></div><span className="text-[11px] text-muted-foreground">{item.label}</span></div>)}</div><div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" /> Confirmed entries</span><span>{data.metrics.registrationsThisMonth.toLocaleString("en-IN")} this month</span><span>{data.metrics.racesPublishedThisMonth.toLocaleString("en-IN")} races published</span></div></CardContent></Card>
            <Card><CardHeader><CardTitle>Needs attention</CardTitle><CardDescription>Operational items that can block growth.</CardDescription></CardHeader><CardContent className="space-y-3"><Link to="/admin/organizer-applications" className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100 text-orange-700"><Clock3 className="h-4 w-4" /></span><span className="flex-1"><span className="block text-sm font-semibold">Pending organizer requests</span><span className="block text-xs text-muted-foreground">{data.metrics.pendingOrganizerApplications} need review</span></span><ArrowUpRight className="h-4 w-4 text-muted-foreground" /></Link><div className="flex items-center gap-3 rounded-xl border p-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700"><Building2 className="h-4 w-4" /></span><span className="flex-1"><span className="block text-sm font-semibold">Organizations awaiting setup</span><span className="block text-xs text-muted-foreground">{data.metrics.incompleteOnboardingOrganizations} profiles incomplete</span></span></div><Link to="/admin/billing" className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/50"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><CircleDollarSign className="h-4 w-4" /></span><span className="flex-1"><span className="block text-sm font-semibold">Organizer billing due</span><span className="block text-xs text-muted-foreground">{formatINR(data.metrics.organizerBillingDuePaise)} across open invoices</span></span><ArrowUpRight className="h-4 w-4 text-muted-foreground" /></Link></CardContent></Card>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <Card><CardHeader className="flex flex-row items-start justify-between gap-4"><div><CardTitle>New organizer requests</CardTitle><CardDescription>Review applications before giving access to organizer tools.</CardDescription></div><Button asChild variant="outline" size="sm"><Link to="/admin/organizer-applications">View all</Link></Button></CardHeader><CardContent>{data.pendingApplications.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" /><p className="mt-3 font-semibold">No pending requests</p><p className="mt-1 text-sm text-muted-foreground">Your onboarding queue is clear.</p></div> : <div className="divide-y">{data.pendingApplications.map((application) => <div key={application.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"><div className="flex min-w-0 flex-1 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{application.organizationName.slice(0, 1).toUpperCase()}</span><div className="min-w-0"><p className="truncate font-semibold">{application.organizationName}</p><p className="truncate text-sm text-muted-foreground">{application.applicantName} · {application.email}</p></div></div><div className="flex items-center gap-3 sm:justify-end"><span className="text-xs text-muted-foreground">{formatDate(application.createdAt)}</span><Badge variant="secondary">Pending</Badge><Button asChild size="sm"><Link to="/admin/organizer-applications">Review</Link></Button></div></div>)}</div>}</CardContent></Card>
            <Card><CardHeader><CardTitle>Organization setup</CardTitle><CardDescription>Approved organizers who still need to complete their profile.</CardDescription></CardHeader><CardContent>{data.incompleteOrganizations.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-center"><UsersRound className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-3 text-sm font-semibold">All profiles are complete</p></div> : <div className="space-y-3">{data.incompleteOrganizations.map((organization) => <div key={organization.id} className="flex items-center gap-3 rounded-xl border p-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Building2 className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{organization.name}</p><p className="text-xs text-muted-foreground">{[organization.city, organization.state].filter(Boolean).join(", ") || "Location not added"}</p></div><span className="text-xs text-muted-foreground">{formatDate(organization.createdAt)}</span></div>)}</div>}</CardContent></Card>
          </section>
        </> : null}
      </div>
    </AdminDashboardLayout>
  );
};

export default AdminDashboard;
