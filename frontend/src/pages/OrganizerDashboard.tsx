import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { OrganizerWorkspaceTabs } from "@/components/OrganizerWorkspaceTabs";
import { StatCard } from "@/components/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, DollarSign, LayoutDashboard, Users, TrendingUp, Plus, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useOrganizerEvents } from "@/hooks/useEvents";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/api";

type OrganizerOrganization = {
  id: string;
  onboardingStatus: "pending" | "completed";
};

const OrganizerDashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: events = [], isLoading, isError } = useOrganizerEvents();
  const queryClient = useQueryClient();
  const [updatingEventId, setUpdatingEventId] = useState<string | null>(null);
  const activeEvents = events.filter((event) => !event.isArchived);
  const updateArchiveState = async (event: (typeof events)[number]) => {
    const message = `Delete ${event.name}? It will be removed from your organizer workspace, hidden from participants, and new registrations will stop. Existing registrations, payments, tickets, audit records, and media will be preserved.`;
    if (!window.confirm(message)) return;
    setUpdatingEventId(event.id);
    try {
      await apiRequest(`/organizer/events/${event.id}/archive`, { method: "POST", body: "{}" });
      await queryClient.invalidateQueries({ queryKey: ["organizer-events"] });
      await queryClient.invalidateQueries({ queryKey: ["organizer-event-dashboard", event.id] });
      toast.success("Event deleted successfully.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete event.");
    } finally {
      setUpdatingEventId(null);
    }
  };
  const { data: organizations = [], isLoading: organizationsLoading, isError: organizationsError } = useQuery({
    queryKey: ["organizer-organizations"],
    queryFn: () => apiRequest<OrganizerOrganization[]>("/organizer/organizations"),
    enabled: user?.role === "organizer",
  });
  const onboardingPending = user?.role === "organizer" && !organizationsLoading && !organizationsError && organizations.length > 0 && organizations[0].onboardingStatus !== "completed";
  const totalRevenuePaise = activeEvents.reduce((sum, event) => sum + event.categories.flatMap((category) => category.tickets).reduce((ticketSum, ticket) => ticketSum + ticket.quantitySold * ticket.pricePaise, 0), 0);
  const totalParticipants = activeEvents.reduce((sum, event) => sum + event.participants, 0);
  const totalInventory = activeEvents.reduce((sum, event) => sum + event.categories.flatMap((category) => category.tickets).reduce((ticketSum, ticket) => ticketSum + ticket.quantityTotal, 0), 0);
  const totalSold = activeEvents.reduce((sum, event) => sum + event.categories.flatMap((category) => category.tickets).reduce((ticketSum, ticket) => ticketSum + ticket.quantitySold, 0), 0);
  const averageFillRate = totalInventory > 0 ? Math.round((totalSold / totalInventory) * 100) : 0;
  const lockedEvents = activeEvents.filter((event) => event.visibility?.isLocked);
  const lockedParticipants = lockedEvents.reduce((sum, event) => sum + (event.lockedParticipants ?? 0), 0);

  return (
    <OrganizerDashboardLayout showNavigation={false}>
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <OrganizerWorkspaceTabs />
        {onboardingPending && (
          <section className="flex flex-col gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
            <div>
              <p className="font-semibold">Organizer onboarding is pending</p>
              <p className="mt-1 text-sm text-amber-900/75 dark:text-amber-100/75">Add your organization type, primary city, and state before creating your first event.</p>
            </div>
            <Button variant="outline" className="w-fit shrink-0 border-amber-300 bg-white text-amber-950 hover:bg-amber-100 dark:border-amber-800 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-950/40" onClick={() => navigate("/organizer/setup")}>Complete onboarding</Button>
          </section>
        )}
        {lockedEvents.length > 0 && (
          <section className="flex flex-col gap-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
            <div><p className="font-semibold">{lockedParticipants.toLocaleString()} registrations are waiting for your upgrade</p><p className="mt-1 text-sm text-amber-900/75 dark:text-amber-100/75">Registrations keep flowing and participants may have paid you directly. Upgrade to view their details, confirm payments, and manage them for race day.</p></div>
            <Button className="w-fit shrink-0" onClick={() => navigate("/organizer/pricing")}>Review pricing</Button>
          </section>
        )}
        <section className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Welcome to your workspace</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Choose an event to manage</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">Select a race to open its event console. Registrations, check-in, ticket inventory, and future event operations will stay scoped to the event you choose.</p>
            </div>
            <Button className="w-fit gap-2" onClick={() => navigate("/organizer/events/new")}><Plus className="h-4 w-4" /> Create new event</Button>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Calendar} label="Active events" value={String(activeEvents.length)} change="Your organizer workspace" />
          <StatCard icon={Users} label="Participants" value={totalParticipants.toLocaleString()} change="Across all events" />
          <StatCard icon={DollarSign} label="Sold ticket value" value={`₹${(totalRevenuePaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} change="Based on ticket tiers" />
          <StatCard icon={TrendingUp} label="Ticket fill rate" value={`${averageFillRate}%`} change={`${totalSold.toLocaleString()} sold of ${totalInventory.toLocaleString()}`} />
        </div>

        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-col gap-2 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="font-bold">Your events</h2><p className="mt-1 text-sm text-muted-foreground">Active events are shown with their live metrics.</p></div>
            <p className="text-xs text-muted-foreground">{activeEvents.length} event{activeEvents.length === 1 ? "" : "s"}</p>
          </div>
          <div className="divide-y">
            {isLoading ? (
              <div className="p-8 text-sm text-muted-foreground">Loading events…</div>
            ) : isError ? (
              <div className="p-8 text-sm text-muted-foreground">Failed to load events.</div>
            ) : activeEvents.length === 0 ? (
              <div className="p-10 text-center"><p className="font-semibold">No events yet</p><p className="mt-1 text-sm text-muted-foreground">Create your first event to start building its organizer console.</p><Button className="mt-4 gap-2" onClick={() => navigate("/organizer/events/new")}><Plus className="h-4 w-4" /> Create event</Button></div>
            ) : (
              activeEvents.map((event) => {
                const fill = event.maxParticipants > 0 ? Math.round((event.participants / event.maxParticipants) * 100) : 0;
                const location = event.location.name ?? ([event.location.city, event.location.state].filter(Boolean).join(", ") || "Location pending");
                return (
                  <div key={event.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                    <img
                      src={event.bannerUrl ?? "/placeholder.svg"}
                      alt={event.name}
                      className="h-20 w-full rounded-lg bg-muted object-cover sm:w-28"
                      onError={(image) => {
                        image.currentTarget.onerror = null;
                        image.currentTarget.src = "/placeholder.svg";
                      }}
                    />
                    <div className="min-w-0 flex-1"><p className="truncate font-semibold">{event.name}</p><p className="mt-1 text-sm text-muted-foreground">{new Date(event.eventDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {location}</p></div>
                    <div className="flex items-center gap-5 text-sm"><div className="text-center"><p className="font-semibold">{event.participants.toLocaleString()}</p><p className="text-xs text-muted-foreground">Visible</p>{event.lockedParticipants > 0 && <p className="text-xs font-medium text-amber-700">+{event.lockedParticipants} locked</p>}</div><div className="text-center"><p className="font-semibold">{fill}%</p><p className="text-xs text-muted-foreground">Fill rate</p></div><Badge variant={event.status === "published" ? "default" : "secondary"}>{event.status === "published" ? "Published" : "Draft"}</Badge><Badge variant={event.registrationStatus === "open" ? "outline" : "secondary"}>{event.registrationStatus === "open" ? "Registration open" : "Registration closed"}</Badge></div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" className="gap-2" onClick={() => navigate(`/organizer/events/${event.id}`)}><LayoutDashboard className="h-4 w-4" /> Open console</Button>
                      <Button size="sm" variant="outline" className="gap-2 text-destructive hover:text-destructive" onClick={() => void updateArchiveState(event)} disabled={updatingEventId === event.id}><Trash2 className="h-4 w-4" /> Delete event</Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerDashboard;
