import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowUpRight, Calendar, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, CreditCard, DollarSign, LayoutDashboard, MapPin, Plus, Search, Shield, TrendingUp, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import OrganizerSetup from "@/pages/OrganizerSetup";
import { OrganizerWorkspaceTabs } from "@/components/OrganizerWorkspaceTabs";
import { StatCard } from "@/components/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/api";
import { useOrganizerEvents } from "@/hooks/useEvents";

type OrganizerOrganization = {
  id: string;
  onboardingStatus: "pending" | "completed";
};

type EventFilter = "all" | "upcoming" | "past" | "published" | "draft";

const eventFilters: Array<{ value: EventFilter; label: string }> = [
  { value: "all", label: "All events" },
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "published", label: "Published" },
  { value: "draft", label: "Drafts" },
];

function formatEventDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatEventDateRange(start: string, end?: string | null) {
  return end && end !== start ? `${formatEventDate(start)} – ${formatEventDate(end)}` : formatEventDate(start);
}

const OrganizerDashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: events = [], isLoading, isError, refetch } = useOrganizerEvents();
  const queryClient = useQueryClient();
  const [updatingEventId, setUpdatingEventId] = useState<string | null>(null);
  const [eventSearch, setEventSearch] = useState("");
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [eventPage, setEventPage] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  const [organizationTabOpen, setOrganizationTabOpen] = useState(searchParams.get("tab") === "organization");
  const activeEvents = events.filter((event) => !event.isArchived);

  useEffect(() => {
    if (searchParams.get("tab") === "organization") {
      setOrganizationTabOpen(true);
      // Clear the param so refreshes don't re-trigger, then scroll to the verification card.
      const next = new URLSearchParams(searchParams);
      next.delete("tab");
      setSearchParams(next, { replace: true });
      if (window.location.hash === "#paid-verification") {
        window.setTimeout(() => document.getElementById("paid-verification")?.scrollIntoView({ behavior: "smooth" }), 200);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateArchiveState = async (event: (typeof events)[number]) => {
    const message = `Archive ${event.name}? It will be hidden from participants and new registrations will stop. Existing registrations, payments, tickets, audit records, and media will be preserved.`;
    if (!window.confirm(message)) return;
    setUpdatingEventId(event.id);
    try {
      await apiRequest(`/organizer/events/${event.id}/archive`, { method: "POST", body: "{}" });
      await queryClient.invalidateQueries({ queryKey: ["organizer-events"] });
      await queryClient.invalidateQueries({ queryKey: ["organizer-event-dashboard", event.id] });
      toast.success("Event archived successfully.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not archive event.");
    } finally {
      setUpdatingEventId(null);
    }
  };

  const { data: organizations = [], isLoading: organizationsLoading, isError: organizationsError } = useQuery({
    queryKey: ["organizer-organizations"],
    queryFn: () => apiRequest<OrganizerOrganization[]>("/organizer/organizations"),
    enabled: user?.role === "organizer",
  });
  const { data: creditAccounts = [] } = useQuery({
    queryKey: ["organizer-credit-accounts"],
    queryFn: async () => (await apiRequest<{ accounts: Array<{ organizationId: string; balancePaise: number }> }>("/organizer/credits")).accounts,
    enabled: user?.role === "organizer" || user?.role === "admin",
    staleTime: 30_000,
  });
  const onboardingPending = user?.role === "organizer" && !organizationsLoading && !organizationsError && organizations.length > 0 && organizations[0].onboardingStatus !== "completed";
  const availableCredits = creditAccounts.reduce((sum, account) => sum + account.balancePaise, 0) / 100;
  const totalRevenuePaise = activeEvents.reduce((sum, event) => sum + event.categories.flatMap((category) => category.tickets).reduce((ticketSum, ticket) => ticketSum + ticket.quantitySold * ticket.pricePaise, 0), 0);
  const totalParticipants = activeEvents.reduce((sum, event) => sum + event.participants, 0);
  const totalInventory = activeEvents.reduce((sum, event) => sum + event.categories.flatMap((category) => category.tickets).reduce((ticketSum, ticket) => ticketSum + ticket.quantityTotal, 0), 0);
  const totalSold = activeEvents.reduce((sum, event) => sum + event.categories.flatMap((category) => category.tickets).reduce((ticketSum, ticket) => ticketSum + ticket.quantitySold, 0), 0);
  const averageFillRate = totalInventory > 0 ? Math.round((totalSold / totalInventory) * 100) : 0;
  const normalizedSearch = eventSearch.trim().toLowerCase();
  const now = Date.now();
  const filteredEvents = activeEvents.filter((event) => {
    const matchesSearch = !normalizedSearch || [event.name, event.sport, event.location.name, event.location.city, event.location.state].filter(Boolean).some((value) => value!.toLowerCase().includes(normalizedSearch));
    const eventTime = new Date(`${event.eventEndDate || event.eventDate}T23:59:59`).getTime();
    const matchesFilter = eventFilter === "all"
      || (eventFilter === "upcoming" && eventTime >= now)
      || (eventFilter === "past" && eventTime < now)
      || (eventFilter === "published" && event.status === "published")
      || (eventFilter === "draft" && event.status !== "published");
    return matchesSearch && matchesFilter;
  }).sort((left, right) => {
    const leftTime = new Date(left.eventDate).getTime();
    const rightTime = new Date(right.eventDate).getTime();
    if (!Number.isFinite(leftTime)) return 1;
    if (!Number.isFinite(rightTime)) return -1;
    if (eventFilter === "past") return rightTime - leftTime;
    return leftTime - rightTime;
  });
  const eventPageSize = 12;
  const eventPageCount = Math.max(1, Math.ceil(filteredEvents.length / eventPageSize));
  const visibleEvents = filteredEvents.slice((eventPage - 1) * eventPageSize, eventPage * eventPageSize);
  const publishedCount = activeEvents.filter((event) => event.status === "published").length;
  const draftCount = activeEvents.filter((event) => event.status !== "published").length;
  const upcomingCount = activeEvents.filter((event) => new Date(`${event.eventEndDate || event.eventDate}T23:59:59`).getTime() >= now).length;
  const pastCount = activeEvents.filter((event) => new Date(`${event.eventEndDate || event.eventDate}T23:59:59`).getTime() < now).length;
  const firstName = user?.name?.trim().split(/\s+/)[0];

  return (
    <OrganizerDashboardLayout showNavigation={false}>
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <OrganizerWorkspaceTabs organizationEmbedded={organizationTabOpen} onOrganizationSelect={() => setOrganizationTabOpen(true)} onEventsSelect={() => setOrganizationTabOpen(false)} />
        {organizationTabOpen ? <OrganizerSetup embedded /> : <>
        {onboardingPending && (
          <section className="flex flex-col gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
            <div><p className="font-semibold">Organizer onboarding is pending</p><p className="mt-1 text-sm text-amber-900/75 dark:text-amber-100/75">Add your organization type, primary city, and state before creating your first event.</p></div>
            <Button variant="outline" className="w-fit shrink-0 border-amber-300 bg-white text-amber-950 hover:bg-amber-100 dark:border-amber-800 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-950/40" onClick={() => navigate("/organizer/setup")}>Complete onboarding</Button>
          </section>
        )}
        {user?.role === "admin" && (
          <section className="flex flex-col gap-4 rounded-xl border border-blue-300 bg-blue-50 p-4 text-blue-950 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-100">
            <div><p className="font-semibold">Admin console access</p><p className="mt-1 text-sm text-blue-900/75 dark:text-blue-100/75">Switch to the admin workspace to manage organizers, Credits, and platform operations.</p></div>
            <Button className="w-fit shrink-0 gap-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500" onClick={() => navigate("/admin")}>
              <Shield className="h-4 w-4" /> Admin Console
            </Button>
          </section>
        )}
        <section className="grid overflow-hidden rounded-2xl border bg-card shadow-sm lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="p-6 sm:p-8">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Organizer workspace</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Welcome back{firstName ? `, ${firstName}` : ""}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">See what needs attention, open registrations, and move into event operations without searching through menus.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button className="gap-2" onClick={() => navigate("/organizer/events/new")}><Plus className="h-4 w-4" /> Create event</Button>
              <Button variant="outline" className="gap-2" onClick={() => navigate("/organizer/registrations?status=all")}><ClipboardList className="h-4 w-4" /> View registrations</Button>
            </div>
          </div>
          <div className="flex flex-col justify-between border-t bg-slate-950 p-6 text-white lg:border-l lg:border-t-0 sm:p-8">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-300"><CreditCard className="h-4 w-4 text-primary" /> Available SportPass Credits</div>
              <p className="mt-3 text-3xl font-black tracking-tight">{availableCredits.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p>
              <p className="mt-1 text-xs text-slate-400">Used when eligible registrations are confirmed.</p>
            </div>
            <Button variant="secondary" className="mt-6 w-fit gap-2" onClick={() => navigate("/organizer/credits")}>Manage Credits <ArrowUpRight className="h-4 w-4" /></Button>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Calendar} label="Active events" value={String(activeEvents.length)} change="Your organizer workspace" />
          <StatCard icon={Users} label="Participants" value={totalParticipants.toLocaleString()} change="Across all events" />
          <StatCard icon={DollarSign} label="Sold ticket value" value={`₹${(totalRevenuePaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} change="Based on ticket tiers" />
          <StatCard icon={TrendingUp} label="Ticket fill rate" value={`${averageFillRate}%`} change={`${totalSold.toLocaleString()} sold of ${totalInventory.toLocaleString()}`} />
        </div>

        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b p-5 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div><div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" /><h2 className="text-xl font-black tracking-tight">Your events</h2><Badge variant="secondary">{filteredEvents.length}</Badge></div><p className="mt-1 text-sm text-muted-foreground">Upcoming events appear first. Use the filters to find older events or drafts.</p></div>
              <p className="text-sm font-medium text-muted-foreground">{upcomingCount} upcoming · {pastCount} past</p>
            </div>
            <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input aria-label="Search events" value={eventSearch} onChange={(event) => { setEventSearch(event.target.value); setEventPage(1); }} placeholder="Search events, sports, or locations" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" /></div>
              <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1" role="tablist" aria-label="Filter events">
                {eventFilters.map((filter) => { const count = filter.value === "all" ? activeEvents.length : filter.value === "upcoming" ? upcomingCount : filter.value === "past" ? pastCount : filter.value === "published" ? publishedCount : draftCount; return <button key={filter.value} type="button" role="tab" aria-selected={eventFilter === filter.value} onClick={() => { setEventFilter(filter.value); setEventPage(1); }} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${eventFilter === filter.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{filter.label}<span className="ml-1.5 text-xs text-muted-foreground">{count}</span></button>; })}
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-2">{[0, 1].map((item) => <div key={item} className="animate-pulse rounded-xl border p-4"><div className="h-36 rounded-lg bg-muted" /><div className="mt-4 h-5 w-2/3 rounded bg-muted" /><div className="mt-2 h-4 w-1/2 rounded bg-muted" /><div className="mt-6 h-2 rounded bg-muted" /></div>)}</div>
          ) : isError ? (
            <div className="p-12 text-center"><p className="font-semibold">Could not load your events</p><p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p><Button variant="outline" className="mt-4" onClick={() => void refetch()}>Try again</Button></div>
          ) : activeEvents.length === 0 ? (
            <div className="p-12 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><CalendarDays className="h-6 w-6" /></div><p className="mt-4 font-semibold">No events yet</p><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Create your first event to start building its organizer console.</p><Button className="mt-5 gap-2" onClick={() => navigate("/organizer/events/new")}><Plus className="h-4 w-4" /> Create event</Button></div>
          ) : filteredEvents.length === 0 ? (
            <div className="p-12 text-center"><Search className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-4 font-semibold">No matching events</p><p className="mt-1 text-sm text-muted-foreground">Try a different search or filter.</p><Button variant="ghost" className="mt-3" onClick={() => { setEventSearch(""); setEventFilter("all"); }}>Clear filters</Button></div>
          ) : (
            <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-2">
              {visibleEvents.map((event) => {
                const fill = event.maxParticipants > 0 ? Math.min(100, Math.round((event.participants / event.maxParticipants) * 100)) : 0;
                const location = event.location.name ?? "Location pending";
                const cityState = [event.location.city, event.location.state].filter(Boolean).join(", ");
                const isPast = new Date(event.eventDate).getTime() < now;
                return <article key={event.id} className="group overflow-hidden rounded-xl border bg-background transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                  <div className="relative h-36 overflow-hidden bg-muted sm:h-40"><img src={event.bannerUrl ?? "/placeholder.svg"} alt={event.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" onError={(image) => { image.currentTarget.onerror = null; image.currentTarget.src = "/placeholder.svg"; }} /><div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" /><div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2"><Badge className="capitalize border-white/20 bg-black/55 text-white backdrop-blur-sm hover:bg-black/55">{event.sport.replaceAll("_", " ")}</Badge><Badge variant={event.status === "published" ? "default" : "secondary"}>{event.status === "published" ? "Published" : "Draft"}</Badge></div></div>
                  <div className="p-4 sm:p-5">
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-3"><h3 className="truncate text-lg font-black tracking-tight">{event.name}</h3><span className={`shrink-0 text-xs font-semibold ${isPast ? "text-muted-foreground" : "text-emerald-700 dark:text-emerald-400"}`}>{isPast ? "Completed" : "Upcoming"}</span></div>
                      <div className="mt-2 space-y-1 text-sm text-muted-foreground"><p className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5 shrink-0 text-primary" />{formatEventDateRange(event.eventDate, event.eventEndDate)}</p><p className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 shrink-0 text-primary" /><span className="font-medium">{location}</span></p>{cityState && <p className="flex items-center gap-2 pl-6 text-xs text-muted-foreground"><span className="h-1 w-1 rounded-full bg-muted-foreground" />{cityState}</p>}</div>
                    </div>
                    <div className="mt-5 grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3"><div><p className="text-lg font-black">{event.participants.toLocaleString()}</p><p className="text-xs text-muted-foreground">Participants</p></div><div><p className="text-lg font-black">{fill}%</p><p className="text-xs text-muted-foreground">Capacity filled</p><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${fill}%` }} /></div></div></div>
                    <div className="mt-4 flex flex-wrap items-center gap-2"><Badge variant={event.registrationStatus === "open" ? "outline" : "secondary"}>{event.registrationStatus === "open" ? "Registration open" : "Registration closed"}</Badge></div>
                    <div className="mt-5 flex flex-wrap gap-2"><Button variant="outline" className="min-w-0 flex-1 gap-2" onClick={() => navigate(`/organizer/registrations?event_id=${event.id}&status=all`)}><ClipboardList className="h-4 w-4" /> Registrations</Button><Button className="min-w-0 flex-1 gap-2" onClick={() => navigate(`/organizer/events/${event.id}`)}><LayoutDashboard className="h-4 w-4" /> Manage <ArrowUpRight className="ml-auto h-4 w-4" /></Button><Button size="icon" variant="outline" className="shrink-0 text-destructive hover:text-destructive" onClick={() => void updateArchiveState(event)} disabled={updatingEventId === event.id} aria-label={`Archive ${event.name}`} title="Archive event"><Archive className="h-4 w-4" /></Button></div>
                  </div>
                </article>;
              })}
            </div>
          )}
          {filteredEvents.length > eventPageSize && <div className="flex items-center justify-between gap-3 border-t px-4 py-4 sm:px-5"><p className="text-sm text-muted-foreground">Page {eventPage} of {eventPageCount} · {filteredEvents.length} events</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={eventPage <= 1} onClick={() => setEventPage((current) => Math.max(1, current - 1))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" disabled={eventPage >= eventPageCount} onClick={() => setEventPage((current) => Math.min(eventPageCount, current + 1))}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>}
        </section>
        </>}
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerDashboard;
