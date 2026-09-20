import { useEffect, useState } from "react";
import { CalendarDays, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { AdminDashboardLayout } from "@/components/AdminDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
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
  featuresUnlocked: boolean;
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

const AdminEventFeatures = () => {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setEvents(await apiRequest<AdminEvent[]>("/admin/events?archived=false"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load events.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const toggleOverride = async (event: AdminEvent, next: boolean) => {
    setPendingId(event.id);
    // Optimistic update
    setEvents((current) => current.map((item) => (item.id === event.id ? { ...item, featuresUnlocked: next } : item)));
    try {
      await apiRequest(`/admin/events/${event.id}/feature-override`, {
        method: "POST",
        body: JSON.stringify({ features_unlocked: next }),
      });
      toast.success(next ? `All features unlocked for ${event.name}.` : `Feature override removed for ${event.name}.`);
    } catch (error) {
      // Revert on failure
      setEvents((current) => current.map((item) => (item.id === event.id ? { ...item, featuresUnlocked: !next } : item)));
      toast.error(error instanceof Error ? error.message : "Could not update feature access.");
    } finally {
      setPendingId(null);
    }
  };

  const unlockedCount = events.filter((event) => event.featuresUnlocked).length;

  return (
    <AdminDashboardLayout>
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck className="h-4 w-4" /> Admin-only override</div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Event feature access</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Free events normally only get registrations and the basic dashboard. Turn on the override to unlock all paid features (communications, check-in, bib management, tournament tools) for a specific event — useful for custom-pricing arrangements.
            </p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading} className="gap-2"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardContent className="flex items-center gap-3 p-5"><CalendarDays className="h-5 w-5 text-primary" /><div><p className="text-2xl font-black">{events.length}</p><p className="text-sm text-muted-foreground">Active events</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-5"><Sparkles className="h-5 w-5 text-amber-600" /><div><p className="text-2xl font-black">{unlockedCount}</p><p className="text-sm text-muted-foreground">Feature overrides active</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-5"><ShieldCheck className="h-5 w-5 text-emerald-700" /><div><p className="text-2xl font-black">{new Set(events.map((event) => event.organization.id)).size}</p><p className="text-sm text-muted-foreground">Organizations</p></div></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Events</CardTitle><CardDescription>Toggle the override to unlock all features for an event regardless of its free/paid status.</CardDescription></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-y bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Event</th><th className="px-5 py-3">Organization</th><th className="px-5 py-3">Event date</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Participants</th><th className="px-5 py-3">Unlock all features</th></tr></thead>
                <tbody className="divide-y">
                  {loading ? (
                    <tr><td colSpan={6} className="px-5 py-12 text-center text-muted-foreground">Loading events…</td></tr>
                  ) : events.length === 0 ? (
                    <tr><td colSpan={6} className="px-5 py-12 text-center text-muted-foreground">No active events found.</td></tr>
                  ) : (
                    events.map((event) => (
                      <tr key={event.id} className="align-top">
                        <td className="px-5 py-4"><p className="font-semibold">{event.name}</p><p className="font-mono text-xs text-muted-foreground">{event.id}</p></td>
                        <td className="px-5 py-4 text-muted-foreground">{event.organization.name}</td>
                        <td className="px-5 py-4 whitespace-nowrap text-muted-foreground">{formatDate(event.eventDate)}</td>
                        <td className="px-5 py-4"><div className="flex flex-wrap gap-2"><Badge variant={event.status === "published" ? "default" : "secondary"}>{eventStatusLabel(event.status)}</Badge><Badge variant="outline">Registration {event.registrationStatus}</Badge></div></td>
                        <td className="px-5 py-4 font-semibold">{event.participantCount.toLocaleString("en-IN")}</td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={event.featuresUnlocked}
                              onCheckedChange={(checked) => void toggleOverride(event, checked)}
                              disabled={pendingId === event.id}
                              aria-label={`Unlock all features for ${event.name}`}
                            />
                            {event.featuresUnlocked && <Badge className="bg-amber-500 text-white">Unlocked</Badge>}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminDashboardLayout>
  );
};

export default AdminEventFeatures;
