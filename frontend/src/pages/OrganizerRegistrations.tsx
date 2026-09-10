import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Clock3, Download, Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/api";

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
  ticket: { id: string; name: string; category: string | null };
  amountPaise: number;
  status: RegistrationStatus;
  paymentStatus: string;
  checkInStatus: "checked_in" | "not_checked_in";
  checkedInAt: string | null;
  utrReference: string | null;
  createdAt: string;
  submittedAt: string | null;
  decisionReason: string | null;
  reviewedAt: string | null;
}

interface RegistrationPage {
  items: OrganizerRegistration[];
  nextCursor: string | null;
  hasMore: boolean;
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

const OrganizerRegistrations = () => {
  const navigate = useNavigate();
  const [events, setEvents] = useState<OrganizerEventOption[]>([]);
  const [filters, setFilters] = useState<RegistrationFilters>(EMPTY_FILTERS);
  const [registrations, setRegistrations] = useState<OrganizerRegistration[]>([]);
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
    void apiRequest<OrganizerEventOption[]>("/events", { signal: controller.signal })
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
  const tickets = useMemo(() => categories.flatMap((category) => category.tickets.map((ticket) => ({ ...ticket, categoryId: category.id }))), [categories]);

  const updateFilter = <K extends FilterKey>(key: K, value: RegistrationFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setCursor(null);
    setCursorHistory([]);
  };

  const handleEventChange = (eventId: string) => {
    setFilters((current) => ({ ...current, eventId: eventId === "all" ? "" : eventId, categoryId: "", ticketId: "" }));
    setCursor(null);
    setCursorHistory([]);
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
      await apiRequest(`/organizer/registrations/${registration.id}/${decision}`, {
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
    <Layout>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/organizer")} aria-label="Back to organizer dashboard"><ArrowLeft className="h-4 w-4" /></Button>
            <div><h1 className="text-2xl font-extrabold tracking-tight">Organizer registrations</h1><p className="text-sm text-muted-foreground">Manage registrations for your active organizations.</p></div>
          </div>
          <Button variant="outline" onClick={() => navigate("/organizer/check-in")}>Race check-in</Button>
          <Button onClick={() => void exportCsv()} disabled={!filters.eventId || exporting} className="gap-2"><Download className="h-4 w-4" />{exporting ? "Exporting…" : "Export event CSV"}</Button>
        </div>

        {eventsError && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{eventsError}</div>}
        <div className="space-y-4 rounded-xl border bg-card p-4">
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Select value={filters.eventId || "all"} onValueChange={handleEventChange} disabled={eventsLoading}>
              <SelectTrigger><SelectValue placeholder="All events" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All events</SelectItem>{events.map((event) => <SelectItem key={event.id} value={event.id}>{event.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filters.categoryId || "all"} onValueChange={(value) => updateFilter("categoryId", value === "all" ? "" : value)} disabled={!selectedEvent}>
              <SelectTrigger><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filters.ticketId || "all"} onValueChange={(value) => updateFilter("ticketId", value === "all" ? "" : value)} disabled={!selectedEvent}>
              <SelectTrigger><SelectValue placeholder="All tickets" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All tickets</SelectItem>{tickets.map((ticket) => <SelectItem key={ticket.id} value={ticket.id}>{ticket.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(value) => updateFilter("status", value)}>
              <SelectTrigger><SelectValue placeholder="Registration status" /></SelectTrigger>
              <SelectContent><SelectItem value="pending">Pending review</SelectItem><SelectItem value="all">All registrations</SelectItem><SelectItem value="awaiting_payment">Awaiting payment</SelectItem><SelectItem value="pending_verification">Pending verification</SelectItem><SelectItem value="confirmed">Confirmed</SelectItem><SelectItem value="checked_in">Checked in</SelectItem><SelectItem value="rejected">Rejected</SelectItem><SelectItem value="expired">Expired</SelectItem></SelectContent>
            </Select>
            <Select value={filters.paymentStatus} onValueChange={(value) => updateFilter("paymentStatus", value)}>
              <SelectTrigger><SelectValue placeholder="Payment status" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All payment states</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="reference_submitted">Reference submitted</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="rejected">Rejected</SelectItem><SelectItem value="expired">Expired</SelectItem></SelectContent>
            </Select>
            <Select value={filters.checkInStatus} onValueChange={(value) => updateFilter("checkInStatus", value)}>
              <SelectTrigger><SelectValue placeholder="Check-in status" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All check-in states</SelectItem><SelectItem value="not_checked_in">Not checked in</SelectItem><SelectItem value="checked_in">Checked in</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <div className="relative lg:col-span-2"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Search name, email, phone, or reference…" className="pl-9" /></div>
            <Input value={filters.participant} onChange={(event) => updateFilter("participant", event.target.value)} placeholder="Participant name" />
            <Input value={filters.email} onChange={(event) => updateFilter("email", event.target.value)} placeholder="Email" type="email" />
            <Input value={filters.phone} onChange={(event) => updateFilter("phone", event.target.value)} placeholder="Phone" />
            <Input value={filters.registrationReference} onChange={(event) => updateFilter("registrationReference", event.target.value)} placeholder="Registration reference" />
          </div>
        </div>

        {decisionTarget && <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="mb-2 font-semibold">{decisionTarget.decision === "reject" ? "Why are you rejecting this payment?" : "Optional approval note"}</p>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} placeholder={decisionTarget.decision === "reject" ? "Explain what the runner should correct or contact you about…" : "Optional note for the payment record"} />
          <div className="mt-3 flex gap-2"><Button onClick={() => { const registration = registrations.find((item) => item.id === decisionTarget.id); if (registration) void decide(registration, decisionTarget.decision); }} disabled={actionId === decisionTarget.id}>{actionId === decisionTarget.id ? "Saving…" : decisionTarget.decision === "reject" ? "Reject payment" : "Approve payment"}</Button><Button variant="outline" onClick={() => { setDecisionTarget(null); setReason(""); }}>Cancel</Button></div>
        </div>}

        <div className="overflow-hidden rounded-xl border bg-card">
          {loading ? <div className="p-10 text-center text-muted-foreground">Loading registrations…</div> : error ? <div className="p-10 text-center text-destructive">{error}</div> : registrations.length === 0 ? <div className="p-10 text-center text-muted-foreground">No registrations match these filters.</div> : <Table>
            <TableHeader><TableRow><TableHead>Participant</TableHead><TableHead>Event</TableHead><TableHead>Ticket</TableHead><TableHead>Amount</TableHead><TableHead>Payment</TableHead><TableHead>Registration</TableHead><TableHead>Check-in</TableHead><TableHead>UTR/reference</TableHead><TableHead className="text-right">Decision</TableHead></TableRow></TableHeader>
            <TableBody>{registrations.map((registration) => {
              const isReviewable = registration.status === "awaiting_payment" || registration.status === "pending_verification";
              return <TableRow key={registration.id}>
                <TableCell><p className="font-medium">{registration.participant.name}</p><p className="text-xs text-muted-foreground">{registration.participant.email ?? registration.participant.phone ?? "No contact"}</p><p className="font-mono text-xs text-muted-foreground">{registration.registrationReference}</p></TableCell>
                <TableCell><p className="max-w-44 truncate">{registration.event.name}</p></TableCell>
                <TableCell><p>{registration.ticket.name}</p><p className="text-xs text-muted-foreground">{registration.ticket.category ?? "—"}</p></TableCell>
                <TableCell className="font-semibold">{formatINR(registration.amountPaise)}</TableCell>
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
          <p className="text-sm text-muted-foreground">Showing up to 50 registrations per page. Exports are limited to 5,000 rows.</p>
          <div className="flex gap-2"><Button variant="outline" size="sm" onClick={goPrevious} disabled={cursorHistory.length === 0 || loading}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" onClick={goNext} disabled={!nextCursor || loading}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div>
        </div>
      </div>
    </Layout>
  );
};

export default OrganizerRegistrations;
