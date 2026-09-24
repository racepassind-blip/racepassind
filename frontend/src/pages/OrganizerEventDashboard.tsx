import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ArrowLeft, BarChart3, CalendarDays, CheckCircle2, ClipboardList, Copy, Download, Edit3, ExternalLink, Hash, MapPin, Package, Power, RefreshCw, ScanLine, Ticket, Timer, Trash2, TrendingUp, UserPlus, Users } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router-dom";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
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
    const message = `Delete ${event.name}? It will be removed from your organizer workspace, hidden from participants, and new registrations will stop. Existing registrations, payments, tickets, audit records, and media will be preserved.`;
    if (!window.confirm(message)) return;
    try {
      await apiRequest(`/organizer/events/${event.id}/archive`, { method: "POST", body: "{}" });
      await queryClient.invalidateQueries({ queryKey: ["organizer-events"] });
      await queryClient.invalidateQueries({ queryKey: ["organizer-event-dashboard", event.id] });
      toast.success("Event deleted successfully.");
      navigate("/organizer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete event.");
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
  const eventDate = formatDate(event.eventDate);
  const eventOptions = organizerEvents.filter((option) => !option.isArchived);
  const checkInRecordsRate = registrations.confirmed > 0 ? Math.round((registrations.checkedIn / registrations.confirmed) * 100) : 0;
  const salesPercent = inventory.total > 0 ? Math.round((inventory.sold / inventory.total) * 100) : 0;

  return (
    <OrganizerDashboardLayout eventId={event.id}>
      <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6 lg:p-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <Button variant="ghost" className="mb-3 -ml-3 gap-2 px-3 text-muted-foreground" onClick={() => navigate("/organizer")}><ArrowLeft className="h-4 w-4" /> Back to events</Button>
              <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-primary">Event overview</span><Badge variant={event.status === "published" ? "default" : "secondary"}>{event.status}</Badge><Badge variant={event.registrationStatus === "open" ? "outline" : "secondary"}>{event.registrationStatus === "open" ? "Registration open" : "Registration closed"}</Badge>{event.eventDate === new Date().toISOString().slice(0, 10) && <Badge variant="outline">Today</Badge>}</div>
              <h1 className="mt-3 break-words text-3xl font-black tracking-tight sm:text-4xl">{event.name}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{event.description || "Track registrations, ticket inventory, and race-day readiness for this event."}</p>
            </div>
            <div className="flex w-full flex-wrap items-end gap-2 xl:w-auto xl:max-w-[680px] xl:justify-end">
              <div className="min-w-[220px] flex-1 sm:flex-none">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Switch event</p>
                <Select value={event.id} onValueChange={(value) => navigate(`/organizer/events/${value}`)}>
                  <SelectTrigger className="w-full bg-background sm:w-[260px]" aria-label="Switch event"><SelectValue placeholder="Select event" /></SelectTrigger>
                  <SelectContent>{eventOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh</Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => void updateRegistrationStatus()}><Power className="h-4 w-4" />{event.registrationStatus === "open" ? "Close registration" : "Open registration"}</Button>
              {supportsTournament && <><Button asChild variant="outline" size="sm" className="gap-2"><a href={resultsUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Public results</a></Button><Button variant="outline" size="sm" className="gap-2" onClick={() => void copyResultsLink()}><Copy className="h-4 w-4" />{resultsCopied ? "Copied" : "Copy results link"}</Button></>}
              <Button variant="outline" size="sm" className="gap-2 text-destructive hover:text-destructive" onClick={() => void updateArchiveState()}><Trash2 className="h-4 w-4" /> Delete event</Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate(`/organizer/events/${event.id}/check-in`)}><ScanLine className="h-4 w-4" /> Check-in matrix</Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate(`/organizer/events/${event.id}/checkpoints`)}><ClipboardList className="h-4 w-4" /> Checkpoints</Button>
              {!event.isArchived && <Button size="sm" className="gap-2" onClick={() => navigate(`/organizer/events/${event.id}/edit`)}><Edit3 className="h-4 w-4" /> Edit event</Button>}
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-t pt-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" />{eventDate}</span>
            <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" />{location}</span>
            <span className="inline-flex items-center gap-2 capitalize"><Ticket className="h-4 w-4 text-primary" />{event.sport.replaceAll("_", " ")}</span>
            <span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-primary" />{overview.confirmedParticipants.toLocaleString()} visible confirmed participants</span>
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Card><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Total registrations</p><ClipboardList className="h-5 w-5 text-primary" /></div><p className="mt-3 text-3xl font-black">{overview.totalRegistrationRecords.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Registration records for this event</p></CardContent></Card>
          <Card><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Approved value</p><BarChart3 className="h-5 w-5 text-emerald-600" /></div><p className="mt-3 text-3xl font-black">{overview.approvedAmountPaise === 0 ? "₹0" : formatINR(overview.approvedAmountPaise)}</p><p className="mt-1 text-xs text-muted-foreground">Approved paid and free registrations</p></CardContent></Card>
          <Card><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Sign-ups today</p><TrendingUp className="h-5 w-5 text-amber-600" /></div><p className="mt-3 text-3xl font-black">{overview.signupsToday.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Participant quantity created today</p></CardContent></Card>
          <Card><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Payment success</p><CheckCircle2 className="h-5 w-5 text-blue-600" /></div><p className="mt-3 text-3xl font-black">{overview.paymentSuccessRate}%</p><p className="mt-1 text-xs text-muted-foreground">Approved or free of completed outcomes</p></CardContent></Card>
          <Card><CardContent className="p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-muted-foreground">Check-in rate</p><ScanLine className="h-5 w-5 text-violet-600" /></div><p className="mt-3 text-3xl font-black">{overview.checkInRate}%</p><p className="mt-1 text-xs text-muted-foreground">{inventory.sold.toLocaleString()} tickets sold · {registrations.checkedIn.toLocaleString()} records scanned</p></CardContent></Card>
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

          <Card><CardHeader><CardTitle>Quick actions</CardTitle><CardDescription>Every action below stays tied to this event.</CardDescription></CardHeader><CardContent className="grid gap-3"><Button className="justify-start gap-2" onClick={() => navigate(`/organizer/events/${event.id}/participants/new`)}><UserPlus className="h-4 w-4" /> Add offline participant</Button><Button variant="outline" className="justify-start gap-2" onClick={() => navigate(`/organizer/events/${event.id}/allocations`)}><Hash className="h-4 w-4" /> Bib Management</Button>{supportsRaceResults && <Button variant="outline" className="justify-start gap-2" onClick={() => navigate(`/organizer/events/${event.id}/race-results`)}><Timer className="h-4 w-4" /> Race Results</Button>}<Button variant="outline" className="justify-start gap-2" onClick={() => navigate(`/organizer/registrations?event_id=${event.id}&status=all`)}><ClipboardList className="h-4 w-4" /> View registrations</Button><Button variant="outline" className="justify-start gap-2" onClick={() => navigate(`/organizer/registrations?event_id=${event.id}&status=all`)}><Download className="h-4 w-4" /> View registrations & export</Button><Button variant="outline" className="justify-start gap-2" onClick={() => navigate(`/organizer/check-in?event_id=${encodeURIComponent(event.id)}`)}><ScanLine className="h-4 w-4" /> Open check-in</Button>{!event.isArchived && <Button variant="outline" className="justify-start gap-2" onClick={() => navigate(`/organizer/events/${event.id}/edit`)}><Edit3 className="h-4 w-4" /> Edit event details</Button>}<div className="mt-2 rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground"><p className="font-semibold text-foreground">Race-day readiness</p><p className="mt-1">{overview.confirmedParticipants.toLocaleString()} confirmed participants, {overview.checkInRate}% checked in by participant quantity.</p></div></CardContent></Card>
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
