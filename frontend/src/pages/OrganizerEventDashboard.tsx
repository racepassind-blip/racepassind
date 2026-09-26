import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { AlertCircle, ArrowLeft, BarChart3, CalendarDays, ClipboardList, Copy, Edit3, ExternalLink, Hash, MapPin, MoreHorizontal, Package, Power, RefreshCw, ScanLine, Ticket, Timer, Trash2, UserPlus, Users } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router-dom";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrganizerEventDashboard, useOrganizerEventOptions } from "@/hooks/useEvents";
import { apiRequest } from "@/lib/api";
import { eventSupportsTournament, getSportConfig } from "@/data/sportConfig";
import { buildResultsUrl } from "@/lib/eventCommunication";

function formatINR(amountPaise: number) {
  return `₹${(amountPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatTrendDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function registrationBadge(status: string) {
  const variant = status === "confirmed" || status === "checked_in" ? "default" : status === "rejected" || status === "expired" ? "destructive" : "secondary";
  return <Badge variant={variant}>{status.replaceAll("_", " ")}</Badge>;
}

const chartConfig = {
  quantity: { label: "Participants", color: "hsl(var(--primary))" },
} satisfies ChartConfig;

const OrganizerEventDashboard = () => {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { data, isLoading, isError, refetch, isFetching } = useOrganizerEventDashboard(eventId);
  const { data: organizerEvents = [] } = useOrganizerEventOptions();
  const queryClient = useQueryClient();
  const [resultsCopied, setResultsCopied] = useState(false);

  useEffect(() => {
    if (data?.event.isArchived) navigate("/organizer", { replace: true });
  }, [data?.event.isArchived, navigate]);

  if (isLoading) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="px-4 py-20 text-center text-sm text-muted-foreground sm:px-6">Loading event dashboard…</div></OrganizerDashboardLayout>;
  }

  if (isError || !data) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6"><p className="text-sm text-muted-foreground">Could not load this event dashboard.</p><Button className="mt-4" variant="outline" onClick={() => navigate("/organizer")}>Back to Events</Button></div></OrganizerDashboardLayout>;
  }

  if (!data.overview || !data.overview.visibility || !Array.isArray(data.byCategory) || !Array.isArray(data.signupTrend)) {
    return <OrganizerDashboardLayout eventId={eventId}><div className="mx-auto max-w-2xl px-4 py-20 sm:px-6"><Card><CardHeader><CardTitle>Dashboard update required</CardTitle><CardDescription>The running backend is serving an older dashboard response.</CardDescription></CardHeader><CardContent className="space-y-4"><p className="text-sm leading-6 text-muted-foreground">Restart the backend on port 8010 so this event console can load its real overview, category, and signup-trend data. No placeholder metrics are shown.</p><Button variant="outline" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Retry dashboard</Button></CardContent></Card></div></OrganizerDashboardLayout>;
  }

  const { event, inventory, registrations, overview, byCategory, signupTrend, recentRegistrations, byAddon } = data;
  const supportsTournament = eventSupportsTournament(event.sport, event.categories);
  const supportsRaceResults = getSportConfig(event.sport).result_type === "race_time";
  const resultsUrl = buildResultsUrl(event.id);
  const copyResultsLink = async () => {
    try {
      await navigator.clipboard.writeText(resultsUrl);
      setResultsCopied(true);
      toast.success("Public results link copied.");
      window.setTimeout(() => setResultsCopied(false), 1800);
    } catch {
      toast.error("Could not copy automatically. Select the public results URL from the Tournament page and copy it manually.");
    }
  };
  const updateArchiveState = async () => {
    const message = `Archive ${event.name}? It will be hidden from participants and new registrations will stop. Existing registrations, payments, tickets, audit records, and media will be preserved.`;
    if (!window.confirm(message)) return;
    try {
      await apiRequest(`/organizer/events/${event.id}/archive`, { method: "POST", body: "{}" });
      await queryClient.invalidateQueries({ queryKey: ["organizer-events"] });
      await queryClient.invalidateQueries({ queryKey: ["organizer-event-dashboard", event.id] });
      toast.success("Event archived successfully.");
      navigate("/organizer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not archive event.");
    }
  };
  const updateRegistrationStatus = async () => {
    const opening = event.registrationStatus !== "open";
    const message = opening
      ? `Open registration for ${event.name}? Participants will be able to submit new responses.`
      : `Close registration for ${event.name}? New participant responses will be stopped, but existing registrations and payments will remain unchanged.`;
    if (!window.confirm(message)) return;
    try {
      await apiRequest(`/organizer/events/${event.id}/registration-status`, {
        method: "POST",
        body: JSON.stringify({ status: opening ? "open" : "closed" }),
      });
      await queryClient.invalidateQueries({ queryKey: ["organizer-events"] });
      await queryClient.invalidateQueries({ queryKey: ["organizer-event-dashboard", event.id] });
      await refetch();
      toast.success(opening ? "Registration is now open." : "Registration is now closed. Existing records were preserved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update registration status.");
    }
  };
  const location = event.location.name ?? ([event.location.city, event.location.state].filter(Boolean).join(", ") || "Location pending");
  const eventDate = event.eventEndDate && event.eventEndDate !== event.eventDate
    ? `${formatDate(event.eventDate)} – ${formatDate(event.eventEndDate)}`
    : formatDate(event.eventDate);
  const eventOptions = organizerEvents.filter((option) => !option.isArchived);
  const checkInRecordsRate = registrations.confirmed > 0 ? Math.round((registrations.checkedIn / registrations.confirmed) * 100) : 0;
  const salesPercent = inventory.total > 0 ? Math.round((inventory.sold / inventory.total) * 100) : 0;
  const pendingReviewCount = registrations.pendingVerification;
  const isPastEvent = new Date(`${event.eventEndDate || event.eventDate}T23:59:59`).getTime() < Date.now();

  return (
    <OrganizerDashboardLayout eventId={event.id}>
      <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" className="w-fit gap-2 px-2 text-muted-foreground" onClick={() => navigate("/organizer")}><ArrowLeft className="h-4 w-4" /> All events</Button>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Select value={event.id} onValueChange={(value) => navigate(`/organizer/events/${value}`)}>
              <SelectTrigger className="min-w-0 flex-1 bg-background sm:w-[280px]" aria-label="Switch event"><SelectValue placeholder="Switch event" /></SelectTrigger>
              <SelectContent>{eventOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => void refetch()} disabled={isFetching} aria-label="Refresh dashboard" title="Refresh dashboard"><RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /></Button>
          </div>
        </div>

        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="p-5 sm:p-7 lg:p-8">
              <div className="flex flex-wrap items-center gap-2"><Badge variant={event.status === "published" ? "default" : "secondary"} className="capitalize">{event.status}</Badge><Badge variant={event.registrationStatus === "open" ? "outline" : "secondary"}>{event.registrationStatus === "open" ? "Registration open" : "Registration closed"}</Badge><Badge variant="outline">{isPastEvent ? "Completed" : "Upcoming"}</Badge>{event.eventDate === new Date().toISOString().slice(0, 10) && <Badge variant="outline">Today</Badge>}</div>
              <h1 className="mt-4 break-words text-3xl font-black tracking-tight sm:text-4xl">{event.name}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{event.description || "Track registrations, ticket inventory, and event-day readiness for this event."}</p>
              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" />{eventDate}</span>
                <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" />{location}</span>
                <span className="inline-flex items-center gap-2 capitalize"><Ticket className="h-4 w-4 text-primary" />{event.sport.replaceAll("_", " ")}</span>
              </div>
              <div className="mt-7 flex flex-wrap gap-2">
                <Button className="gap-2" onClick={() => navigate(`/organizer/registrations?event_id=${event.id}&status=all`)}><ClipboardList className="h-4 w-4" /> Manage registrations</Button>
                {!event.isArchived && <Button variant="outline" className="gap-2" onClick={() => navigate(`/organizer/events/${event.id}/edit`)}><Edit3 className="h-4 w-4" /> Edit event</Button>}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="outline" className="gap-2"><MoreHorizontal className="h-4 w-4" /> More</Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-60">
                    <DropdownMenuItem onClick={() => void updateRegistrationStatus()}><Power className="mr-2 h-4 w-4" />{event.registrationStatus === "open" ? "Close registration" : "Open registration"}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate(`/organizer/events/${event.id}/check-in`)}><ScanLine className="mr-2 h-4 w-4" />Check-in matrix</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate(`/organizer/events/${event.id}/checkpoints`)}><ClipboardList className="mr-2 h-4 w-4" />Manage checkpoints</DropdownMenuItem>
                    {supportsTournament && <><DropdownMenuSeparator /><DropdownMenuItem asChild><a href={resultsUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Open public results</a></DropdownMenuItem><DropdownMenuItem onClick={() => void copyResultsLink()}><Copy className="mr-2 h-4 w-4" />{resultsCopied ? "Results link copied" : "Copy results link"}</DropdownMenuItem></>}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => void updateArchiveState()}><Trash2 className="mr-2 h-4 w-4" />Archive event</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="relative min-h-52 overflow-hidden border-t bg-muted lg:min-h-full lg:border-l lg:border-t-0">
              <img src={event.bannerUrl ?? "/placeholder.svg"} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(image) => { image.currentTarget.onerror = null; image.currentTarget.src = "/placeholder.svg"; }} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-transparent" />
              <div className="absolute inset-x-5 bottom-5 flex items-end justify-between gap-4 text-white"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">Confirmed participants</p><p className="mt-1 text-3xl font-black">{overview.confirmedParticipants.toLocaleString()}</p></div><Badge className="border-white/20 bg-black/45 text-white hover:bg-black/45">{salesPercent}% filled</Badge></div>
            </div>
          </div>
        </section>

        {pendingReviewCount > 0 && (
          <section className="flex flex-col gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
            <div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">{pendingReviewCount} payment {pendingReviewCount === 1 ? "reference needs" : "references need"} review</p><p className="mt-1 text-sm text-amber-900/75 dark:text-amber-100/75">Review submitted UTR details before confirming these registrations.</p></div></div>
            <Button variant="outline" className="w-fit shrink-0 border-amber-300 bg-white text-amber-950 hover:bg-amber-100 dark:border-amber-800 dark:bg-transparent dark:text-amber-100" onClick={() => navigate(`/organizer/registrations?event_id=${event.id}&status=pending_verification`)}>Review payments</Button>
          </section>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Registrations</p><ClipboardList className="h-5 w-5 text-primary" /></div><p className="mt-3 text-3xl font-black">{overview.totalRegistrationRecords.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">{overview.signupsToday.toLocaleString()} participant{overview.signupsToday === 1 ? "" : "s"} added today</p></CardContent></Card>
          <Card><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Confirmed participants</p><Users className="h-5 w-5 text-blue-600" /></div><p className="mt-3 text-3xl font-black">{overview.confirmedParticipants.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Across {registrations.confirmed.toLocaleString()} confirmed registration records</p></CardContent></Card>
          <Card><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Approved payments</p><BarChart3 className="h-5 w-5 text-emerald-600" /></div><p className="mt-3 text-3xl font-black">{overview.approvedAmountPaise === 0 ? "₹0" : formatINR(overview.approvedAmountPaise)}</p><p className="mt-1 text-xs text-muted-foreground">{overview.paymentSuccessRate}% payment success rate</p></CardContent></Card>
          <Card><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Check-in progress</p><ScanLine className="h-5 w-5 text-violet-600" /></div><p className="mt-3 text-3xl font-black">{overview.checkInRate}%</p><p className="mt-1 text-xs text-muted-foreground">{registrations.checkedIn.toLocaleString()} of {registrations.confirmed.toLocaleString()} confirmed records scanned</p></CardContent></Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0"><div><CardTitle>Registrations by category</CardTitle><CardDescription>Confirmed participant quantity against each category capacity.</CardDescription></div><Users className="h-5 w-5 text-muted-foreground" /></CardHeader>
            <CardContent className="space-y-5">
              {byCategory.map((category) => {
                const progress = category.capacity > 0 ? Math.min(100, Math.round((category.confirmedQuantity / category.capacity) * 100)) : 0;
                return <div key={category.categoryId}><div className="mb-2 flex items-start justify-between gap-4"><div><p className="font-semibold">{category.categoryName}</p><p className="text-xs text-muted-foreground">{category.distance || "Distance not specified"}{category.pendingQuantity > 0 ? ` · ${category.pendingQuantity} pending` : ""}</p></div><p className="text-sm font-semibold">{category.confirmedQuantity.toLocaleString()} <span className="font-normal text-muted-foreground">/ {category.capacity > 0 ? category.capacity.toLocaleString() : "No capacity"}</span></p></div><Progress value={progress} /><p className="mt-1 text-right text-xs text-muted-foreground">{category.capacity > 0 ? `${progress}% filled` : "Capacity not configured"}</p></div>;
              })}
              {byCategory.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No categories configured for this event.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Inventory snapshot</CardTitle><CardDescription>Ticket quantities currently recorded by the event.</CardDescription></CardHeader>
            <CardContent className="space-y-5"><div><div className="mb-2 flex justify-between text-sm"><span>Tickets sold</span><span className="font-semibold">{inventory.sold.toLocaleString()} / {inventory.total.toLocaleString()}</span></div><Progress value={salesPercent} /></div><div className="grid grid-cols-3 gap-3"><div className="rounded-lg bg-muted/50 p-3"><p className="text-2xl font-black">{inventory.sold.toLocaleString()}</p><p className="text-xs text-muted-foreground">Sold</p></div><div className="rounded-lg bg-muted/50 p-3"><p className="text-2xl font-black">{inventory.reserved.toLocaleString()}</p><p className="text-xs text-muted-foreground">Reserved</p></div><div className="rounded-lg bg-muted/50 p-3"><p className="text-2xl font-black">{inventory.available.toLocaleString()}</p><p className="text-xs text-muted-foreground">Available</p></div></div><div className="rounded-lg border p-3 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Confirmed records</span><span className="font-semibold">{registrations.confirmed.toLocaleString()}</span></div><div className="mt-2 flex justify-between"><span className="text-muted-foreground">Pending review</span><span className="font-semibold">{registrations.awaitingPayment + registrations.pendingVerification}</span></div><div className="mt-2 flex justify-between"><span className="text-muted-foreground">Checked in</span><span className="font-semibold">{registrations.checkedIn.toLocaleString()} ({checkInRecordsRate}%)</span></div></div></CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0"><div><CardTitle>Sign-up trend</CardTitle><CardDescription>Participant quantity created over the last 30 days. Inactive days remain visible.</CardDescription></div><Badge variant="outline">30 days</Badge></CardHeader>
          <CardContent><ChartContainer config={chartConfig} className="h-[280px] w-full"><AreaChart data={signupTrend} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}><defs><linearGradient id="signup-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-quantity)" stopOpacity={0.28} /><stop offset="95%" stopColor="var(--color-quantity)" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={formatTrendDate} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} /><ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(value) => formatTrendDate(String(value))} />} /><Area type="monotone" dataKey="quantity" stroke="var(--color-quantity)" strokeWidth={2} fill="url(#signup-fill)" activeDot={{ r: 5 }} /></AreaChart></ChartContainer></CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <Card><CardHeader className="flex-row items-center justify-between space-y-0"><div><CardTitle>Recent registrations</CardTitle><CardDescription>Latest participant activity for this event.</CardDescription></div><Button variant="outline" size="sm" onClick={() => navigate(`/organizer/registrations?event_id=${event.id}&status=all`)}>View all</Button></CardHeader><CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Participant</TableHead><TableHead>Category</TableHead><TableHead>Registered</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{recentRegistrations.map((registration) => <TableRow key={registration.id}><TableCell><p className="font-semibold">{registration.participant.name}</p><p className="text-xs text-muted-foreground">{registration.registrationReference}</p></TableCell><TableCell>{registration.ticket.category || registration.ticket.name}</TableCell><TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatDateTime(registration.createdAt)}</TableCell><TableCell>{registration.amountPaise === 0 ? "Free" : formatINR(registration.amountPaise)}</TableCell><TableCell>{registrationBadge(registration.status)}</TableCell></TableRow>)}{recentRegistrations.length === 0 && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No registrations yet.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>

          <Card>
            <CardHeader><CardTitle>Event tools</CardTitle><CardDescription>Shortcuts for setup and event-day operations.</CardDescription></CardHeader>
            <CardContent className="grid gap-3">
              <Button className="justify-start gap-2" onClick={() => navigate(`/organizer/events/${event.id}/participants/new`)}><UserPlus className="h-4 w-4" /> Add offline participant</Button>
              <Button variant="outline" className="justify-start gap-2" onClick={() => navigate(`/organizer/check-in?event_id=${encodeURIComponent(event.id)}`)}><ScanLine className="h-4 w-4" /> Open check-in scanner</Button>
              <Button variant="outline" className="justify-start gap-2" onClick={() => navigate(`/organizer/events/${event.id}/check-in`)}><ClipboardList className="h-4 w-4" /> View check-in matrix</Button>
              <Button variant="outline" className="justify-start gap-2" onClick={() => navigate(`/organizer/events/${event.id}/checkpoints`)}><ClipboardList className="h-4 w-4" /> Manage checkpoints</Button>
              <Button variant="outline" className="justify-start gap-2" onClick={() => navigate(`/organizer/events/${event.id}/allocations`)}><Hash className="h-4 w-4" /> Bib management</Button>
              {supportsRaceResults && <Button variant="outline" className="justify-start gap-2" onClick={() => navigate(`/organizer/events/${event.id}/race-results`)}><Timer className="h-4 w-4" /> Race results</Button>}
              <div className="mt-2 rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground"><p className="font-semibold text-foreground">Event-day readiness</p><p className="mt-1">{overview.confirmedParticipants.toLocaleString()} confirmed participants, {overview.checkInRate}% checked in by participant quantity.</p></div>
            </CardContent>
          </Card>
        </div>

        {byAddon && byAddon.length > 0 && (
          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Add-on summary</CardTitle>
                <CardDescription>Selections from confirmed registrations.</CardDescription>
              </div>
              <Package className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="space-y-5">
                {byAddon.map((addon) => (
                  <div key={addon.addonId} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{addon.addonName}</p>
                        <p className="text-xs text-muted-foreground">
                          {addon.type === "single_select" ? "Single select" : "Quantity"} ·{" "}
                          {addon.pricePaise === 0 ? "Free" : formatINR(addon.pricePaise)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-black">{addon.totalQuantity.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">
                          {addon.type === "single_select" ? "opted in" : "total qty"}
                          {addon.totalRevenuePaise > 0 && ` · ${formatINR(addon.totalRevenuePaise)}`}
                        </p>
                      </div>
                    </div>
                    {addon.type === "single_select" && addon.byOption.length > 0 && (
                      <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 sm:grid-cols-3 md:grid-cols-4">
                        {addon.byOption.map(({ option, count }) => (
                          <div key={option} className="rounded-md bg-muted/50 px-3 py-2 text-center">
                            <p className="text-lg font-bold">{count}</p>
                            <p className="text-xs text-muted-foreground">{option}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {addon.type === "single_select" && addon.totalQuantity === 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">No selections yet.</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerEventDashboard;
