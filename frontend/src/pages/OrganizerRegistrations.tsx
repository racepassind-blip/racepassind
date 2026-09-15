import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Clock3, Download, ScanLine, Search, UserPlus, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/api";
import type { OrganizerVisibility } from "@/hooks/useEvents";

interface OrganizerEventOption {
  id: string;
  name: string;
  categories: Array<{
    id: string;
    name: string;
    tickets: Array<{ id: string; name: string }>;
  }>;
}

type RegistrationStatus = "awaiting_payment" | "pending_verification" | "confirmed" | "rejected" | "expired" | "checked_in";
type Decision = "approve" | "reject";
type FilterKey = "eventId" | "categoryId" | "ticketId" | "status" | "paymentStatus" | "checkInStatus" | "search" | "participant" | "email" | "phone" | "registrationReference";

interface RegistrationFilters {
  eventId: string;
  categoryId: string;
  ticketId: string;
  status: string;
  paymentStatus: string;
  checkInStatus: string;
  search: string;
  participant: string;
  email: string;
  phone: string;
  registrationReference: string;
}

interface OrganizerRegistration {
  id: string;
  registrationReference: string;
  event: { id: string; name: string };
  participant: { name: string; email: string | null; phone: string | null };
  participants?: Array<{ index: number; participant: { name: string; email: string | null; phone: string | null } }>;
  participantCount?: number;
  ticket: { id: string; name: string; category: string | null };
  amountPaise: number;
  receivedAmountPaise: number | null;
  source: "online" | "manual";
  isManualEntry: boolean;
  status: RegistrationStatus;
  paymentStatus: string;
  checkInStatus: "checked_in" | "not_checked_in";
  checkedInAt: string | null;
  utrReference: string | null;
  createdAt: string;
  submittedAt: string | null;
  decisionReason: string | null;
  reviewedAt: string | null;
  responses: Record<string, unknown>;
  selections: Record<string, { selected?: string; qty?: number }>;
  computedTotal: { addonTotalPaise?: number; totalPaise?: number };
}

interface RegistrationPage {
  items: OrganizerRegistration[];
  nextCursor: string | null;
  hasMore: boolean;
  visibility: OrganizerVisibility;
}

const EMPTY_FILTERS: RegistrationFilters = {
  eventId: "",
  categoryId: "",
  ticketId: "",
  status: "pending",
  paymentStatus: "all",
  checkInStatus: "all",
  search: "",
  participant: "",
  email: "",
  phone: "",
  registrationReference: "",
};

function paymentBadge(status: string) {
  if (status === "approved") return <Badge variant="default">Approved</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  if (status === "not_required") return <Badge variant="default">Free</Badge>;
  if (status === "expired") return <Badge variant="outline">Expired</Badge>;
  return <Badge variant="secondary">{status === "reference_submitted" ? "Reference submitted" : "Pending"}</Badge>;
}

function registrationBadge(status: RegistrationStatus) {
  const variant = status === "confirmed" || status === "checked_in" ? "default" : status === "rejected" || status === "expired" ? "destructive" : "secondary";
  return <Badge variant={variant}>{status.replaceAll("_", " ")}</Badge>;
}

function formatINR(amountPaise: number) {
  return `₹${(amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function dynamicRegistrationSummary(registration: OrganizerRegistration) {
  const responseEntries = Object.entries(registration.responses ?? {}).filter(([key]) => !["full_name", "email", "phone"].includes(key));
  const addonEntries = Object.entries(registration.selections ?? {});
  if (responseEntries.length === 0 && addonEntries.length === 0) return null;
  return <details className="mt-2 text-xs"><summary className="cursor-pointer text-primary">Participant details</summary><div className="mt-2 space-y-1 rounded-md bg-muted/40 p-2">{responseEntries.map(([key, value]) => <p key={key}><span className="font-medium">{key.replaceAll("_", " ")}:</span> {String(value)}</p>)}{addonEntries.map(([key, value]) => <p key={key}><span className="font-medium">{key.replaceAll("_", " ")}:</span> {value.selected ?? value.qty ?? "—"}</p>)}{registration.computedTotal.addonTotalPaise !== undefined && <p className="font-medium">Add-ons: {formatINR(registration.computedTotal.addonTotalPaise)}</p>}</div></details>;
}

const OrganizerRegistrations = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const eventIdFromUrl = searchParams.get("event_id") ?? "";
  const eventScoped = Boolean(eventIdFromUrl);
  const [events, setEvents] = useState<OrganizerEventOption[]>([]);
  const [filters, setFilters] = useState<RegistrationFilters>(() => ({
    ...EMPTY_FILTERS,
    eventId: eventIdFromUrl,
    categoryId: searchParams.get("category_id") ?? "",
    ticketId: searchParams.get("ticket_id") ?? "",
    status: searchParams.get("status") ?? EMPTY_FILTERS.status,
    paymentStatus: searchParams.get("payment_status") ?? EMPTY_FILTERS.paymentStatus,
    checkInStatus: searchParams.get("check_in_status") ?? EMPTY_FILTERS.checkInStatus,
    search: searchParams.get("q") ?? "",
    participant: searchParams.get("participant") ?? "",
    email: searchParams.get("email") ?? "",
    phone: searchParams.get("phone") ?? "",
    registrationReference: searchParams.get("registration_reference") ?? "",
  }));
  const [registrations, setRegistrations] = useState<OrganizerRegistration[]>([]);
  const [visibility, setVisibility] = useState<OrganizerVisibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [decisionTarget, setDecisionTarget] = useState<{ id: string; decision: Decision } | null>(null);
  const [reason, setReason] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setEventsLoading(true);
    void apiRequest<OrganizerEventOption[]>("/organizer/events", { signal: controller.signal })
      .then(setEvents)
      .catch((loadError) => {
        if (!controller.signal.aborted) setEventsError(loadError instanceof Error ? loadError.message : "Could not load events");
      })
      .finally(() => {
        if (!controller.signal.aborted) setEventsLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page_size: "50", status: filters.status });
    if (cursor) params.set("cursor", cursor);
    if (filters.eventId) params.set("event_id", filters.eventId);
    if (filters.categoryId) params.set("category_id", filters.categoryId);
    if (filters.ticketId) params.set("ticket_id", filters.ticketId);
    if (filters.paymentStatus !== "all") params.set("payment_status", filters.paymentStatus);
    if (filters.checkInStatus !== "all") params.set("check_in_status", filters.checkInStatus);
    if (filters.search.trim()) params.set("q", filters.search.trim());
    if (filters.participant.trim()) params.set("participant", filters.participant.trim());
    if (filters.email.trim()) params.set("email", filters.email.trim());
    if (filters.phone.trim()) params.set("phone", filters.phone.trim());
    if (filters.registrationReference.trim()) params.set("registration_reference", filters.registrationReference.trim());

    setLoading(true);
    setError(null);
    void apiRequest<RegistrationPage>(`/organizer/registrations?${params.toString()}`, { signal: controller.signal })
      .then((page) => {
        setRegistrations(page.items);
        setVisibility(page.visibility);
        setNextCursor(page.nextCursor);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Could not load registrations");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cursor, filters, refreshNonce]);

  const selectedEvent = events.find((event) => event.id === filters.eventId);
  const categories = useMemo(() => selectedEvent?.categories ?? [], [selectedEvent]);
  const tickets = useMemo(
    () => categories.flatMap((category) => category.tickets.map((ticket) => ({ ...ticket, categoryId: category.id, categoryName: category.name }))),
    [categories],
  );
  const visibleTickets = useMemo(
    () => (filters.categoryId ? tickets.filter((ticket) => ticket.categoryId === filters.categoryId) : tickets),
    [filters.categoryId, tickets],
  );
  const selectedCategory = categories.find((category) => category.id === filters.categoryId);
  const selectedTicket = tickets.find((ticket) => ticket.id === filters.ticketId);
  const activeFilterCount = [
    filters.categoryId,
    filters.ticketId,
    filters.status !== "all" ? filters.status : "",
    filters.paymentStatus !== "all" ? filters.paymentStatus : "",
    filters.checkInStatus !== "all" ? filters.checkInStatus : "",
    filters.search.trim(),
    filters.participant.trim(),
    filters.email.trim(),
    filters.phone.trim(),
    filters.registrationReference.trim(),
  ].filter(Boolean).length;
  const exportIsFiltered = activeFilterCount > 0;

  const syncFiltersToUrl = (nextFilters: RegistrationFilters) => {
    const nextParams = new URLSearchParams();
    if (nextFilters.eventId) nextParams.set("event_id", nextFilters.eventId);
    if (nextFilters.categoryId) nextParams.set("category_id", nextFilters.categoryId);
    if (nextFilters.ticketId) nextParams.set("ticket_id", nextFilters.ticketId);
    if (nextFilters.status !== EMPTY_FILTERS.status) nextParams.set("status", nextFilters.status);
    if (nextFilters.paymentStatus !== EMPTY_FILTERS.paymentStatus) nextParams.set("payment_status", nextFilters.paymentStatus);
    if (nextFilters.checkInStatus !== EMPTY_FILTERS.checkInStatus) nextParams.set("check_in_status", nextFilters.checkInStatus);
    if (nextFilters.search.trim()) nextParams.set("q", nextFilters.search.trim());
    if (nextFilters.participant.trim()) nextParams.set("participant", nextFilters.participant.trim());
    if (nextFilters.email.trim()) nextParams.set("email", nextFilters.email.trim());
    if (nextFilters.phone.trim()) nextParams.set("phone", nextFilters.phone.trim());
    if (nextFilters.registrationReference.trim()) nextParams.set("registration_reference", nextFilters.registrationReference.trim());
    setSearchParams(nextParams, { replace: true });
  };

  const applyFilters = (nextFilters: RegistrationFilters) => {
    setFilters(nextFilters);
    syncFiltersToUrl(nextFilters);
    setCursor(null);
    setCursorHistory([]);
  };

  const updateFilter = <K extends FilterKey>(key: K, value: RegistrationFilters[K]) => {
    applyFilters({ ...filters, [key]: value } as RegistrationFilters);
  };

  const handleCategoryChange = (categoryId: string) => {
    const nextTicketId = categoryId && filters.ticketId && !tickets.some((ticket) => ticket.id === filters.ticketId && ticket.categoryId === categoryId)
      ? ""
      : filters.ticketId;
    applyFilters({ ...filters, categoryId, ticketId: nextTicketId });
  };

  const handleEventChange = (eventId: string) => {
    if (eventScoped && eventId === "all") return;
    const nextEventId = eventId === "all" ? "" : eventId;
    applyFilters({ ...filters, eventId: nextEventId, categoryId: "", ticketId: "" });
  };

  const clearAllFilters = () => {
    applyFilters({ ...EMPTY_FILTERS, eventId: eventScoped ? filters.eventId : "" });
  };

  const goNext = () => {
    if (!nextCursor) return;
    setCursorHistory((history) => [...history, cursor ?? ""]);
    setCursor(nextCursor);
  };

  const goPrevious = () => {
    const previous = cursorHistory[cursorHistory.length - 1];
    if (previous === undefined) return;
    setCursorHistory((history) => history.slice(0, -1));
    setCursor(previous || null);
  };

  const exportCsv = async () => {
    if (!filters.eventId) {
      toast.error("Choose an event before exporting registrations.");
      return;
    }
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (filters.categoryId) params.set("category_id", filters.categoryId);
      if (filters.ticketId) params.set("ticket_id", filters.ticketId);
      if (filters.status !== "all") params.set("status", filters.status);
      if (filters.paymentStatus !== "all") params.set("payment_status", filters.paymentStatus);
      if (filters.checkInStatus !== "all") params.set("check_in_status", filters.checkInStatus);
      if (filters.search.trim()) params.set("q", filters.search.trim());
      if (filters.participant.trim()) params.set("participant", filters.participant.trim());
      if (filters.email.trim()) params.set("email", filters.email.trim());
      if (filters.phone.trim()) params.set("phone", filters.phone.trim());
      if (filters.registrationReference.trim()) params.set("registration_reference", filters.registrationReference.trim());
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const content = await apiRequest<string>(`/organizer/events/${filters.eventId}/registrations.csv${suffix}`);
      const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `registrations-${filters.eventId}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Registration CSV downloaded.");
    } catch (exportError) {
      toast.error(exportError instanceof Error ? exportError.message : "Could not export registrations");
    } finally {
      setExporting(false);
    }
  };

  const decide = async (registration: OrganizerRegistration, decision: Decision) => {
    if (decision === "reject" && !reason.trim()) {
      toast.error("Add a reason before rejecting a payment.");
      return;
    }
    setActionId(registration.id);
    try {
      await apiRequest(`/organizer/events/${registration.event.id}/registrations/${registration.id}/${decision}`, {
        method: "POST",
        body: JSON.stringify(decision === "reject" ? { reason: reason.trim() } : {}),
      });
      toast.success(decision === "approve" ? "Payment approved." : "Payment rejected.");
      setDecisionTarget(null);
      setReason("");
      setRefreshNonce((value) => value + 1);
    } catch (decisionError) {
      toast.error(decisionError instanceof Error ? decisionError.message : "Payment decision failed");
    } finally {
      setActionId(null);
    }
  };

  return (
    <OrganizerDashboardLayout eventId={filters.eventId || undefined}>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(eventScoped ? `/organizer/events/${filters.eventId}` : "/organizer")} aria-label={eventScoped ? "Back to event dashboard" : "Back to organizer dashboard"}><ArrowLeft className="h-4 w-4" /></Button>
            <div><h1 className="text-2xl font-extrabold tracking-tight">{eventScoped ? "Event registrations" : "Organizer registrations"}</h1><p className="text-sm text-muted-foreground">{eventScoped ? "Registrations for this event." : "All event registrations. Select an event to focus the workspace."}</p></div>
          </div>
          <div className="flex items-center gap-2">
            {!eventScoped && <Button variant="outline" onClick={() => navigate(`/organizer/check-in?event_id=${encodeURIComponent(filters.eventId)}`)}>Race check-in</Button>}
            {eventScoped && <Button variant="outline" onClick={() => navigate(`/organizer/events/${filters.eventId}/check-in`)} className="gap-2"><ScanLine className="h-4 w-4" /> Check-in matrix</Button>}
            {eventScoped && <Button onClick={() => navigate(`/organizer/events/${filters.eventId}/participants/new`)} className="gap-2"><UserPlus className="h-4 w-4" /> Add manual participant</Button>}
            <Button onClick={() => void exportCsv()} disabled={!filters.eventId || exporting} className="gap-2"><Download className="h-4 w-4" />{exporting ? "Exporting…" : exportIsFiltered ? "Export filtered CSV" : "Export event CSV"}</Button>
          </div>
        </div>

        {eventsError && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{eventsError}</div>}
        {visibility?.graceActive && <section className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">Your 48-hour upgrade grace window is active</p><p className="mt-1 text-sm text-muted-foreground">Registrations remain visible for now. Upgrade before the grace window ends to keep full visibility and payment-reconciliation access.</p></div><Button variant="outline" onClick={() => navigate("/organizer/pricing")}>Review upgrade</Button></section>}
        {visibility?.isLocked && visibility.lockedSummary && <section className="flex flex-col gap-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100"><div><p className="font-semibold">{visibility.lockedSummary.message}</p><p className="mt-1 text-sm text-amber-900/75 dark:text-amber-100/75">Pending payment-review entries remain available so you can reconcile direct UPI payments. Confirmed registrations above your limit stay locked until you upgrade.</p></div><Button className="w-fit shrink-0" onClick={() => navigate("/organizer/pricing")}>Upgrade to {visibility.upgradePlan?.name ?? "the next plan"}</Button></section>}
        <div className="space-y-4 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="font-semibold">Find registrations</p><p className="text-xs text-muted-foreground">Choose a category first to narrow the available tiers.</p></div>
            {activeFilterCount > 0 && <Button variant="ghost" size="sm" onClick={clearAllFilters}>Clear all filters</Button>}
          </div>
          <div className={eventScoped ? "grid gap-3 md:grid-cols-3 lg:grid-cols-5" : "grid gap-3 md:grid-cols-3 lg:grid-cols-6"}>
            {!eventScoped && <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Event</label><Select value={filters.eventId || "all"} onValueChange={handleEventChange} disabled={eventsLoading}>
              <SelectTrigger><SelectValue placeholder="All events" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All events</SelectItem>{events.map((event) => <SelectItem key={event.id} value={event.id}>{event.name}</SelectItem>)}</SelectContent>
            </Select></div>}
            <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Category</label><Select value={filters.categoryId || "all"} onValueChange={(value) => handleCategoryChange(value === "all" ? "" : value)} disabled={!selectedEvent}>
              <SelectTrigger><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent>
            </Select></div>
            <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Tier</label><Select value={filters.ticketId || "all"} onValueChange={(value) => updateFilter("ticketId", value === "all" ? "" : value)} disabled={!selectedEvent || visibleTickets.length === 0}>
              <SelectTrigger><SelectValue placeholder="All tiers" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tiers</SelectItem>
                {filters.categoryId ? visibleTickets.map((ticket) => <SelectItem key={ticket.id} value={ticket.id}>{ticket.name}</SelectItem>) : categories.map((category) => {
                  const categoryTickets = visibleTickets.filter((ticket) => ticket.categoryId === category.id);
                  if (categoryTickets.length === 0) return null;
                  return <SelectGroup key={category.id}><SelectLabel>{category.name}</SelectLabel>{categoryTickets.map((ticket) => <SelectItem key={ticket.id} value={ticket.id}>{ticket.name}</SelectItem>)}</SelectGroup>;
                })}
              </SelectContent>
            </Select><p className="text-[11px] text-muted-foreground">{filters.categoryId ? `${visibleTickets.length} tier${visibleTickets.length === 1 ? "" : "s"} in ${selectedCategory?.name ?? "this category"}` : "Grouped by category"}</p></div>
            <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Registration</label><Select value={filters.status} onValueChange={(value) => updateFilter("status", value)}>
              <SelectTrigger><SelectValue placeholder="Registration status" /></SelectTrigger>
              <SelectContent><SelectItem value="pending">Pending review</SelectItem><SelectItem value="all">All registrations</SelectItem><SelectItem value="awaiting_payment">Awaiting payment</SelectItem><SelectItem value="pending_verification">Pending verification</SelectItem><SelectItem value="confirmed">Confirmed</SelectItem><SelectItem value="checked_in">Checked in</SelectItem><SelectItem value="rejected">Rejected</SelectItem><SelectItem value="expired">Expired</SelectItem></SelectContent>
            </Select></div>
            <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Payment</label><Select value={filters.paymentStatus} onValueChange={(value) => updateFilter("paymentStatus", value)}>
              <SelectTrigger><SelectValue placeholder="Payment status" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All payment states</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="reference_submitted">Reference submitted</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="rejected">Rejected</SelectItem><SelectItem value="expired">Expired</SelectItem></SelectContent>
            </Select></div>
            <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">Check-in</label><Select value={filters.checkInStatus} onValueChange={(value) => updateFilter("checkInStatus", value)}>
              <SelectTrigger><SelectValue placeholder="Check-in status" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All check-in states</SelectItem><SelectItem value="not_checked_in">Not checked in</SelectItem><SelectItem value="checked_in">Checked in</SelectItem></SelectContent>
            </Select></div>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm"><span className="font-medium">Category + tier:</span><span>{selectedCategory?.name ?? "All categories"} · {selectedTicket?.name ?? "All tiers"}</span><span className="text-xs text-muted-foreground">Both selections are applied together.</span></div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <div className="relative lg:col-span-2"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Search name, email, phone, or reference…" className="pl-9" /></div>
            <Input value={filters.participant} onChange={(event) => updateFilter("participant", event.target.value)} placeholder="Participant name" />
            <Input value={filters.email} onChange={(event) => updateFilter("email", event.target.value)} placeholder="Email" type="email" />
            <Input value={filters.phone} onChange={(event) => updateFilter("phone", event.target.value)} placeholder="Phone" />
            <Input value={filters.registrationReference} onChange={(event) => updateFilter("registrationReference", event.target.value)} placeholder="Registration reference" />
          </div>
          {activeFilterCount > 0 && <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
            <span className="text-muted-foreground">Active filters:</span>
            {filters.categoryId && <Badge variant="secondary" className="gap-1">Category: {selectedCategory?.name ?? "Selected"}<button type="button" onClick={() => handleCategoryChange("")} aria-label="Remove category filter"><X className="h-3 w-3" /></button></Badge>}
            {filters.ticketId && <Badge variant="secondary" className="gap-1">Tier: {selectedTicket?.categoryName ? `${selectedTicket.categoryName} · ` : ""}{selectedTicket?.name ?? "Selected"}<button type="button" onClick={() => updateFilter("ticketId", "")} aria-label="Remove tier filter"><X className="h-3 w-3" /></button></Badge>}
            {filters.status !== "all" && <Badge variant="secondary" className="gap-1">Status: {filters.status.replaceAll("_", " ")}<button type="button" onClick={() => updateFilter("status", "all")} aria-label="Remove status filter"><X className="h-3 w-3" /></button></Badge>}
            {filters.paymentStatus !== "all" && <Badge variant="secondary" className="gap-1">Payment: {filters.paymentStatus.replaceAll("_", " ")}<button type="button" onClick={() => updateFilter("paymentStatus", "all")} aria-label="Remove payment filter"><X className="h-3 w-3" /></button></Badge>}
            {filters.checkInStatus !== "all" && <Badge variant="secondary" className="gap-1">Check-in: {filters.checkInStatus.replaceAll("_", " ")}<button type="button" onClick={() => updateFilter("checkInStatus", "all")} aria-label="Remove check-in filter"><X className="h-3 w-3" /></button></Badge>}
            <span className="text-xs text-muted-foreground">CSV export will use these filters.</span>
          </div>}
        </div>

        {decisionTarget && <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="mb-2 font-semibold">{decisionTarget.decision === "reject" ? "Why are you rejecting this payment?" : "Optional approval note"}</p>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} placeholder={decisionTarget.decision === "reject" ? "Explain what the runner should correct or contact you about…" : "Optional note for the payment record"} />
          <div className="mt-3 flex gap-2"><Button onClick={() => { const registration = registrations.find((item) => item.id === decisionTarget.id); if (registration) void decide(registration, decisionTarget.decision); }} disabled={actionId === decisionTarget.id}>{actionId === decisionTarget.id ? "Saving…" : decisionTarget.decision === "reject" ? "Reject payment" : "Approve payment"}</Button><Button variant="outline" onClick={() => { setDecisionTarget(null); setReason(""); }}>Cancel</Button></div>
        </div>}

        <div className="overflow-hidden rounded-xl border bg-card">
          {loading ? <div className="p-10 text-center text-muted-foreground">Loading registrations…</div> : error ? <div className="p-10 text-center text-destructive">{error}</div> : registrations.length === 0 ? <div className="p-10 text-center text-muted-foreground">No registrations match these filters.</div> : <Table>
            <TableHeader><TableRow><TableHead>Participant</TableHead>{!eventScoped && <TableHead>Event</TableHead>}<TableHead>Tier</TableHead><TableHead>Amount</TableHead><TableHead>Payment</TableHead><TableHead>Registration</TableHead><TableHead>Check-in</TableHead><TableHead>UTR/reference</TableHead><TableHead className="text-right">Decision</TableHead></TableRow></TableHeader>
            <TableBody>{registrations.map((registration) => {
              const isReviewable = registration.status === "awaiting_payment" || registration.status === "pending_verification";
              return <TableRow key={registration.id}>
                <TableCell><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{registration.participant.name}</p>{registration.isManualEntry && <Badge variant="outline">Manual entry</Badge>}</div>{registration.participants && registration.participants.length > 1 && <p className="text-xs text-muted-foreground">Members: {registration.participants.map((member) => member.participant.name).join(" · ")}</p>}<p className="text-xs text-muted-foreground">{registration.participant.email ?? registration.participant.phone ?? "No contact"}</p><p className="font-mono text-xs text-muted-foreground">{registration.registrationReference}</p>{dynamicRegistrationSummary(registration)}</TableCell>
                {!eventScoped && <TableCell><p className="max-w-44 truncate">{registration.event.name}</p></TableCell>}
                <TableCell><p>{registration.ticket.name}</p><p className="text-xs text-muted-foreground">{registration.ticket.category ?? "—"}</p></TableCell>
                <TableCell className="font-semibold"><p>{formatINR(registration.amountPaise)}</p>{registration.receivedAmountPaise !== null && <p className="text-xs font-normal text-accent">Received {formatINR(registration.receivedAmountPaise)}</p>}</TableCell>
                <TableCell><div className="space-y-1">{paymentBadge(registration.paymentStatus)}<p className="text-xs text-muted-foreground">{registration.paymentStatus.replaceAll("_", " ")}</p></div></TableCell>
                <TableCell><div className="space-y-1">{registrationBadge(registration.status)}<p className="text-xs text-muted-foreground">{formatDate(registration.createdAt)}</p></div></TableCell>
                <TableCell>{registration.checkInStatus === "checked_in" ? <span className="text-xs font-medium text-accent">Checked in</span> : <span className="text-xs text-muted-foreground">Not checked in</span>}</TableCell>
                <TableCell>{registration.utrReference ? <span className="font-mono text-sm">{registration.utrReference}</span> : <span className="text-xs text-muted-foreground">Not provided</span>}</TableCell>
                <TableCell className="text-right">{isReviewable ? <div className="flex justify-end gap-1"><Button variant="ghost" size="sm" className="gap-1 text-accent" onClick={() => { setDecisionTarget({ id: registration.id, decision: "approve" }); setReason(""); }} disabled={actionId !== null}><Check className="h-3 w-3" />Approve</Button><Button variant="ghost" size="sm" className="gap-1 text-destructive" onClick={() => { setDecisionTarget({ id: registration.id, decision: "reject" }); setReason(""); }} disabled={actionId !== null}><X className="h-3 w-3" />Reject</Button></div> : <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3 w-3" />No action</span>}</TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Showing up to 50 registrations per page. Exports use the active filters and are limited to 5,000 rows.</p>
          <div className="flex gap-2"><Button variant="outline" size="sm" onClick={goPrevious} disabled={cursorHistory.length === 0 || loading}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" onClick={goNext} disabled={!nextCursor || loading}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div>
        </div>
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerRegistrations;
