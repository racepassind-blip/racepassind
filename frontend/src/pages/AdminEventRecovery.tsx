import { useCallback, useEffect, useState } from "react";
import { ArchiveRestore, CalendarDays, ChevronLeft, ChevronRight, RefreshCw, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/api";

interface AdminEvent {
  id: string;
  name: string;
  organization: { id: string; name: string };
  eventDate: string;
  status: string;
  registrationStatus: "open" | "closed";
  archivedAt: string | null;
  isArchived: boolean;
  participantCount: number;
}

interface AdminEventPage {
  items: AdminEvent[];
  total: number;
  summary: { participants: number; organizations: number; featuresUnlocked: number };
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function eventStatusLabel(status: string) {
  return status === "published" ? "Published" : "Draft";
}

const AdminEventRecovery = () => {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [eventToRestore, setEventToRestore] = useState<AdminEvent | null>(null);
  const [eventToDelete, setEventToDelete] = useState<AdminEvent | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ participants: 0, organizations: 0 });
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest<AdminEventPage>(`/admin/events?archived=true&page=${page}&page_size=${pageSize}`);
      setEvents(response.items);
      setTotal(response.total);
      setSummary(response.summary);
      if (response.items.length === 0 && page > 1) setPage((current) => current - 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load archived events.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { void load(); }, [load]);

  const restoreEvent = async () => {
    if (!eventToRestore) return;
    const event = eventToRestore;
    setActionId(event.id);
    try {
      await apiRequest(`/admin/events/${event.id}/restore`, { method: "POST", body: "{}" });
      setEventToRestore(null);
      await load();
      toast.success(`${event.name} was restored and is visible according to its publication status.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not restore the event.");
    } finally {
      setActionId(null);
    }
  };

  const deleteEvent = async () => {
    if (!eventToDelete) return;
    const event = eventToDelete;
    setActionId(event.id);
    try {
      await apiRequest(`/admin/events/${event.id}`, { method: "DELETE" });
      setEventToDelete(null);
      await load();
      toast.success(`${event.name} was permanently deleted. All registrations, payments, and related data were removed.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the event.");
    } finally {
      setActionId(null);
    }
  };

  return (
    <AdminDashboardLayout>
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck className="h-4 w-4" /> Admin-only recovery</div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Event recovery</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">Review events archived by organizers and restore an event after accidental archival. Restoring never deletes registrations, payments, tickets, or audit history. Use the recovery page to permanently delete archived events and reclaim storage space.</p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading} className="gap-2"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardContent className="flex items-center gap-3 p-5"><ArchiveRestore className="h-5 w-5 text-amber-700" /><div><p className="text-2xl font-black">{total}</p><p className="text-sm text-muted-foreground">Archived events</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-5"><UsersRound className="h-5 w-5 text-primary" /><div><p className="text-2xl font-black">{summary.participants.toLocaleString("en-IN")}</p><p className="text-sm text-muted-foreground">Preserved participants</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-5"><CalendarDays className="h-5 w-5 text-emerald-700" /><div><p className="text-2xl font-black">{summary.organizations}</p><p className="text-sm text-muted-foreground">Organizations represented</p></div></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Archived events</CardTitle><CardDescription>Published events become publicly visible again after restoration. Draft events remain drafts until an organizer publishes them.</CardDescription></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-y bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Event</th><th className="px-5 py-3">Organization</th><th className="px-5 py-3">Race date</th><th className="px-5 py-3">Archived</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Participants</th><th className="px-5 py-3">Action</th></tr></thead>
                <tbody className="divide-y">
                  {loading ? <tr><td colSpan={7} className="px-5 py-12 text-center text-muted-foreground">Loading archived events…</td></tr> : events.length === 0 ? <tr><td colSpan={7} className="px-5 py-12 text-center text-muted-foreground">No archived events need recovery.</td></tr> : events.map((event) => <tr key={event.id} className="align-top"><td className="px-5 py-4"><p className="font-semibold">{event.name}</p><p className="font-mono text-xs text-muted-foreground">{event.id}</p></td><td className="px-5 py-4 text-muted-foreground">{event.organization.name}</td><td className="px-5 py-4 whitespace-nowrap text-muted-foreground">{formatDate(event.eventDate)}</td><td className="px-5 py-4 whitespace-nowrap text-muted-foreground">{formatDate(event.archivedAt)}</td><td className="px-5 py-4"><div className="flex flex-wrap gap-2"><Badge variant={event.status === "published" ? "default" : "secondary"}>{eventStatusLabel(event.status)}</Badge><Badge variant="outline">Registration {event.registrationStatus}</Badge></div></td><td className="px-5 py-4 font-semibold">{event.participantCount.toLocaleString("en-IN")}</td><td className="px-5 py-4"><div className="flex gap-2"><Button size="sm" variant="outline" className="gap-2" onClick={() => setEventToRestore(event)} disabled={actionId !== null}><ArchiveRestore className="h-4 w-4" /> Restore</Button><Button size="sm" variant="destructive" className="gap-2" onClick={() => setEventToDelete(event)} disabled={actionId !== null}><Trash2 className="h-4 w-4" /> Delete</Button></div></td></tr>)}
                </tbody>
              </table>
            </div>
            {total > pageSize && <div className="flex items-center justify-between gap-3 border-t px-5 py-4"><p className="text-sm text-muted-foreground">Page {page} of {Math.ceil(total / pageSize)} · {total} archived events</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage((current) => current + 1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={Boolean(eventToRestore)} onOpenChange={(open) => { if (!open && actionId === null) setEventToRestore(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Restore this event?</AlertDialogTitle><AlertDialogDescription>{eventToRestore ? `Restore “${eventToRestore.name}” from ${eventToRestore.organization.name}? Existing registrations and historical records will remain intact. If the event was published before archival, it will be visible on the public site again.` : ""}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={actionId !== null}>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void restoreEvent()} disabled={actionId !== null}>{actionId ? "Restoring…" : "Restore event"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(eventToDelete)} onOpenChange={(open) => { if (!open && actionId === null) setEventToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle className="text-destructive">Permanently delete this event?</AlertDialogTitle><AlertDialogDescription>{eventToDelete ? `Delete “${eventToDelete.name}” from ${eventToDelete.organization.name}? This action is irreversible and will permanently remove all registrations, payments, match data, tickets, and related information to free up storage space.` : ""}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={actionId !== null}>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void deleteEvent()} disabled={actionId !== null} className="bg-destructive hover:bg-destructive-hover">{actionId ? "Deleting…" : "Delete event"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminDashboardLayout>
  );
};

export default AdminEventRecovery;
