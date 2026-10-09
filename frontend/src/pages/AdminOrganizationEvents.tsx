import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ClipboardList, Eye, RefreshCw, ShieldCheck } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/api";

interface AdminEvent { id: string; name: string; eventDate: string; status: string; registrationStatus: "open" | "closed"; isArchived: boolean; participantCount: number; }
interface OrganizationEventsResponse { organization: { name: string; status: string }; items: AdminEvent[]; total: number; summary: { events: number; participants: number; openEvents: number; archivedEvents: number }; }

function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }

export default function AdminOrganizationEvents() {
  const { organizationId = "" } = useParams();
  const [data, setData] = useState<OrganizationEventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); setError(null); try { setData(await apiRequest<OrganizationEventsResponse>(`/admin/organizations/${organizationId}/events`)); } catch (err) { setError(err instanceof Error ? err.message : "Could not load organization events."); } finally { setLoading(false); } }, [organizationId]);
  useEffect(() => { void load(); }, [load]);

  return <AdminDashboardLayout><div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><Button asChild variant="ghost" className="mb-3 -ml-3 gap-2"><Link to="/admin/organizers"><ArrowLeft className="h-4 w-4" />All organizers</Link></Button><div className="flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck className="h-4 w-4" />Admin organization control</div><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{data?.organization.name ?? "Organization events"}</h1><p className="mt-2 max-w-2xl text-muted-foreground">Review the complete event history and open registrations, refunds, settlements, or event controls.</p></div><Button variant="outline" onClick={() => void load()} disabled={loading} className="gap-2"><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />Refresh</Button></div>
    {error && <Card><CardContent className="p-6 text-sm text-destructive">{error}</CardContent></Card>}
    {data && <><div className="grid gap-4 sm:grid-cols-4">{[["Total events", data.summary.events], ["Participants", data.summary.participants.toLocaleString("en-IN")], ["Open registration", data.summary.openEvents], ["Archived", data.summary.archivedEvents]].map(([label, value]) => <Card key={String(label)}><CardContent className="p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></CardContent></Card>)}</div>
      <Card><CardHeader><CardTitle>All events and controls</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-left text-sm"><thead className="border-y bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Event</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Participants</th><th className="px-5 py-3">Controls</th></tr></thead><tbody className="divide-y">{loading ? <tr><td colSpan={5} className="px-5 py-12 text-center text-muted-foreground">Loading events…</td></tr> : data.items.length === 0 ? <tr><td colSpan={5} className="px-5 py-12 text-center text-muted-foreground">No events found.</td></tr> : data.items.map((event) => <tr key={event.id} className="align-top"><td className="px-5 py-4"><p className="font-semibold">{event.name}</p><p className="font-mono text-xs text-muted-foreground">{event.id}</p></td><td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{formatDate(event.eventDate)}</td><td className="px-5 py-4"><div className="flex flex-wrap gap-2"><Badge variant={event.status === "published" ? "default" : "secondary"}>{event.status === "published" ? "Published" : "Draft"}</Badge><Badge variant={event.isArchived ? "destructive" : "outline"}>{event.isArchived ? "Archived" : `Registration ${event.registrationStatus}`}</Badge></div></td><td className="px-5 py-4 font-semibold">{event.participantCount.toLocaleString("en-IN")}</td><td className="px-5 py-4"><div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link to={`/organizer/registrations?event_id=${event.id}&status=all`}><ClipboardList className="mr-1.5 h-4 w-4" />Registrations</Link></Button><Button asChild size="sm" variant="outline"><Link to={`/organizer/events/${event.id}/refunds`}>Refunds</Link></Button><Button asChild size="sm" variant="outline"><Link to={`/admin/settlements?event=${event.id}`}>Settlements</Link></Button><Button asChild size="sm"><Link to={`/organizer/events/${event.id}`}><Eye className="mr-1.5 h-4 w-4" />Open event</Link></Button></div></td></tr>)}</tbody></table></div><div className="border-t px-5 py-4 text-sm text-muted-foreground">Showing {data.items.length} of {data.total} events. Archived events remain available for audit.</div></CardContent></Card>
    </>}
  </div></AdminDashboardLayout>;
}
