import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Save } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOrganizerEventDashboard } from "@/hooks/useEvents";
import type { AddonDefinition, ParticipantFieldConfig } from "@/data/mockEvents";
import { apiRequest } from "@/lib/api";

type ResponseValue = string | boolean;
type Selection = { selected?: string; qty?: number };
type MemberDraft = { responses: Record<string, ResponseValue> };

const FALLBACK_FIELDS: ParticipantFieldConfig[] = [
  { id: "full_name", label: "Full name", type: "text", required: true, predefined: true, order: 1 },
  { id: "email", label: "Email", type: "email", required: true, predefined: true, order: 2 },
  { id: "phone", label: "Phone", type: "phone", required: false, predefined: true, order: 3 },
  { id: "date_of_birth", label: "Date of birth", type: "date", required: false, predefined: true, order: 4 },
  { id: "gender", label: "Gender", type: "select", required: false, predefined: true, order: 5, options: ["Male", "Female", "Other", "Prefer not to say"] },
  { id: "jersey_size", label: "Jersey size", type: "select", required: false, predefined: true, order: 6, options: ["XS", "S", "M", "L", "XL", "XXL"] },
  { id: "team_name", label: "Team name", type: "text", required: false, predefined: true, order: 7 },
];

const OrganizerManualParticipant = () => {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useOrganizerEventDashboard(eventId);
  const [ticketId, setTicketId] = useState("");
  const [members, setMembers] = useState<MemberDraft[]>([{ responses: {} }]);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [paymentReceived, setPaymentReceived] = useState(false);
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [receivedAmount, setReceivedAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const event = data?.event;
  const fields = useMemo(() => {
    const configured = event?.fieldConfig?.fields?.length ? [...event.fieldConfig.fields] : FALLBACK_FIELDS;
    const pickup = event?.pickupPoints;
    if (pickup?.enabled && pickup.points?.length) configured.push({
      id: "pickup_point_id", label: "Pickup point", type: "select", required: Boolean(pickup.required),
      predefined: true, order: 10001, options: pickup.points.map((point) => point.id),
    });
    return configured.sort((a, b) => a.order - b.order);
  }, [event]);
  const addons = useMemo<AddonDefinition[]>(() => event?.addonConfig?.addons ?? [], [event]);
  const tickets = useMemo(() => event?.categories.flatMap((category) => category.tickets.map((ticket) => ({
    ...ticket,
    categoryName: category.name,
    entryType: category.entryType,
    participantsPerEntry: category.participantsPerEntry,
  }))) ?? [], [event]);
  const selectedTicket = tickets.find((ticket) => ticket.id === ticketId);
  const selectedTicketId = selectedTicket?.id;
  const waiver = event?.waiver;
  const selectedParticipantsPerEntry = selectedTicket?.participantsPerEntry ?? 1;
  const totalPaise = useMemo(() => {
    if (!selectedTicket) return 0;
    return selectedTicket.pricePaise + addons.reduce((total, addon) => {
      const selection = selections[addon.id];
      if (!selection) return total;
      return total + addon.price_paise * (addon.type === "quantity" ? (selection.qty ?? 0) : selection.selected ? 1 : 0);
    }, 0);
  }, [addons, selections, selectedTicket]);

  useEffect(() => {
    if (!ticketId && tickets[0]) setTicketId(tickets[0].id);
  }, [ticketId, tickets]);

  useEffect(() => {
    if (!selectedTicketId) return;
    setMembers((current) => Array.from({ length: selectedParticipantsPerEntry }, (_, index) => current[index] ?? { responses: {} }));
  }, [selectedTicketId, selectedParticipantsPerEntry]);

  const updateResponse = (memberIndex: number, field: ParticipantFieldConfig, value: ResponseValue) => {
    setMembers((current) => current.map((member, index) => {
      if (index !== memberIndex) return member;
      const responses = { ...member.responses };
      if (value === "") delete responses[field.id];
      else responses[field.id] = value;
      return { ...member, responses };
    }));
  };

  const updateAddon = (addon: AddonDefinition, value: string) => {
    setSelections((current) => {
      const next = { ...current };
      if (addon.type === "quantity") {
        const qty = Math.max(0, Number(value) || 0);
        if (qty === 0) delete next[addon.id];
        else next[addon.id] = { qty };
      } else if (!value) delete next[addon.id];
      else next[addon.id] = { selected: value };
      return next;
    });
  };

  const fieldInput = (memberIndex: number, field: ParticipantFieldConfig) => {
    const value = members[memberIndex]?.responses[field.id];
    if (field.type === "select" || field.type === "dropdown" || field.type === "yes_no") {
      const options = field.type === "yes_no" ? ["Yes", "No"] : field.options ?? [];
      const selectValue = value === undefined ? "" : field.type === "yes_no" ? value === true ? "Yes" : "No" : String(value);
      return <Select value={selectValue} onValueChange={(next) => updateResponse(memberIndex, field, field.type === "yes_no" ? next === "Yes" : next)}><SelectTrigger><SelectValue placeholder="Select an option" /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{field.id === "pickup_point_id" ? event?.pickupPoints?.points?.find((point) => point.id === option)?.name ?? option : option}</SelectItem>)}</SelectContent></Select>;
    }
    return <Input type={field.type === "email" ? "email" : field.type === "date" ? "date" : field.type === "number" ? "number" : field.type === "phone" ? "tel" : "text"} inputMode={field.type === "phone" ? "numeric" : undefined} value={value === undefined ? "" : String(value)} onChange={(event) => updateResponse(memberIndex, field, event.target.value)} placeholder={field.type === "phone" ? "+91 98765 43210" : undefined} />;
  };

  const submit = async () => {
    if (!eventId || !ticketId || !selectedTicket) return;
    const sharedContactFields = new Set(["email", "phone"]);
    if (waiver?.enabled && !waiverAccepted) {
      toast.error("Confirm that the participant has accepted the event waiver.");
      return;
    }
    for (const [memberIndex, member] of members.entries()) {
      const missing = fields.find((field) => {
        if (memberIndex > 0 && sharedContactFields.has(field.id)) return false;
        const value = member.responses[field.id];
        return field.required && (value === undefined || String(value).trim() === "");
      });
      if (missing) {
        toast.error(`Participant ${memberIndex + 1}: ${missing.label} is required.`);
        return;
      }
    }
    const primaryResponses = members[0]?.responses ?? {};
    if (!["email", "phone"].some((fieldId) => {
      const value = primaryResponses[fieldId];
      return value !== undefined && String(value).trim() !== "";
    })) {
      toast.error("Enter an email or phone number for this entry.");
      return;
    }
    if (paymentReceived && totalPaise > 0 && (!receivedAmount || Number(receivedAmount) <= 0)) {
      toast.error("Enter the amount received from the participant entry.");
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/organizer/events/${eventId}/registrations/manual`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          event_id: eventId,
          ticket_id: ticketId,
          email: primaryResponses.email,
          phone: primaryResponses.phone,
          participants: members.map((member, index) => ({
            responses: {
              ...Object.fromEntries(Object.entries(member.responses).filter(([fieldId]) => !sharedContactFields.has(fieldId))),
              ...(index === 0 && waiver?.enabled ? { waiver_accepted: true } : {}),
            },
          })),
          selections,
          payment_received: paymentReceived,
          received_amount_paise: paymentReceived && totalPaise > 0 ? Math.round(Number(receivedAmount) * 100) : null,
        }),
      });
      toast.success(paymentReceived || totalPaise === 0 ? "Participant entry added and confirmed." : "Participant entry added. Payment is pending review.");
      navigate(`/organizer/registrations?event_id=${eventId}&status=all`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add participant entry.");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <OrganizerDashboardLayout eventId={eventId}><div className="px-4 py-20 text-center text-sm text-muted-foreground">Loading event form…</div></OrganizerDashboardLayout>;
  if (isError || !event) return <OrganizerDashboardLayout eventId={eventId}><div className="px-4 py-20 text-center text-sm text-muted-foreground">Could not load this event.</div></OrganizerDashboardLayout>;

  return (
    <OrganizerDashboardLayout eventId={event.id}>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-start gap-3"><Button variant="ghost" size="icon" onClick={() => navigate(`/organizer/events/${event.id}`)} aria-label="Back to event dashboard"><ArrowLeft className="h-4 w-4" /></Button><div><p className="text-sm font-semibold uppercase tracking-wider text-primary">Offline registration</p><h1 className="mt-1 text-3xl font-extrabold tracking-tight">Add participant</h1><p className="mt-2 text-muted-foreground">Use the same participant fields configured for {event.name}. This record will be marked as a manual entry.</p></div></div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Card><CardHeader><CardTitle>Participant details</CardTitle><CardDescription>Enter the details from the offline registration form.</CardDescription></CardHeader><CardContent className="space-y-6">
            <div className="space-y-2"><Label>Ticket / category *</Label><Select value={ticketId} onValueChange={setTicketId}><SelectTrigger><SelectValue placeholder="Select a ticket" /></SelectTrigger><SelectContent>{tickets.map((ticket) => <SelectItem key={ticket.id} value={ticket.id}>{ticket.categoryName} · {ticket.name} · {ticket.participantsPerEntry} participant{ticket.participantsPerEntry === 1 ? "" : "s"} · ₹{(ticket.pricePaise / 100).toLocaleString("en-IN")}{ticket.available < 1 ? " · Sold out" : ""}</SelectItem>)}</SelectContent></Select>{selectedTicket && <p className="text-xs text-muted-foreground">{selectedTicket.available} spots available · {selectedTicket.participantsPerEntry} participant{selectedTicket.participantsPerEntry === 1 ? "" : "s"} per entry</p>}</div>
            <div className="space-y-5">{members.map((member, memberIndex) => <section key={memberIndex} className="space-y-4 rounded-lg border p-4"><div><h3 className="font-bold">Participant {memberIndex + 1}</h3><p className="text-xs text-muted-foreground">Personal details for this member. Email and phone are collected once on Participant 1.</p></div><div className="grid gap-5 sm:grid-cols-2">{fields.filter((field) => memberIndex === 0 || (field.id !== "email" && field.id !== "phone")).map((field) => <div key={field.id} className={`space-y-2 ${field.id === "full_name" || field.id.startsWith("custom_") ? "sm:col-span-2" : ""}`}><Label>{field.label}{field.required ? " *" : ""}</Label>{fieldInput(memberIndex, field)}</div>)}</div></section>)}</div>
            {waiver?.enabled && <section className="space-y-3 rounded-lg border p-4"><div><h3 className="font-bold">{waiver.title || "Waiver & Declaration"}</h3><p className="whitespace-pre-wrap text-sm text-muted-foreground">{waiver.text}</p></div><label className="flex items-start gap-2 text-sm"><Checkbox checked={waiverAccepted} onCheckedChange={(value) => setWaiverAccepted(value === true)} /><span>The participant has read and accepted this waiver.</span></label></section>}
            {addons.length > 0 && <section className="space-y-4 border-t pt-6"><div><h3 className="font-bold">Add-ons</h3><p className="text-sm text-muted-foreground">Apply the same add-ons available in public checkout.</p></div><div className="grid gap-4 sm:grid-cols-2">{addons.map((addon) => <div key={addon.id} className="space-y-2"><Label>{addon.name}{addon.required ? " *" : ""} <span className="text-muted-foreground">(+₹{(addon.price_paise / 100).toFixed(2)}{addon.type === "quantity" ? " each" : ""})</span></Label>{addon.type === "quantity" ? <Input type="number" min={addon.required ? 1 : 0} max={addon.max_qty ?? undefined} value={selections[addon.id]?.qty ?? 0} onChange={(event) => updateAddon(addon, event.target.value)} /> : <Select value={selections[addon.id]?.selected ?? ""} onValueChange={(value) => updateAddon(addon, value)}><SelectTrigger><SelectValue placeholder="Select an option" /></SelectTrigger><SelectContent>{(addon.options ?? []).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select>}</div>)}</div></section>}
          </CardContent></Card>

          <div className="space-y-6 lg:sticky lg:top-24 lg:self-start"><Card><CardHeader><CardTitle>Payment</CardTitle><CardDescription>Record what happened at the offline desk.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex items-start gap-3 rounded-lg border p-3"><Checkbox id="payment-received" checked={paymentReceived} onCheckedChange={(checked) => { const received = checked === true; setPaymentReceived(received); if (received && !receivedAmount) setReceivedAmount((totalPaise / 100).toFixed(2)); }} /><div><Label htmlFor="payment-received" className="cursor-pointer font-semibold">Payment received</Label><p className="mt-1 text-xs text-muted-foreground">Confirm the participant immediately when money was collected.</p></div></div>{paymentReceived && totalPaise > 0 && <div className="space-y-2"><Label htmlFor="received-amount">Amount received (₹) *</Label><Input id="received-amount" type="number" min="0.01" step="0.01" value={receivedAmount} onChange={(event) => setReceivedAmount(event.target.value)} /><p className="text-xs text-muted-foreground">Calculated registration total: ₹{(totalPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p></div>}{!paymentReceived && totalPaise > 0 && <div className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">This participant will be saved as awaiting payment and the ticket spot will remain reserved.</div>}{(paymentReceived || totalPaise === 0) && <div className="flex items-center gap-2 text-sm font-medium text-accent"><CheckCircle2 className="h-4 w-4" /> Participant will be confirmed</div>}</CardContent></Card><Card><CardContent className="space-y-4 p-5"><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Registration total</span><span className="text-xl font-extrabold text-primary">₹{(totalPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div><Badge variant="outline" className="w-fit">Manual entry</Badge><Button className="w-full gap-2" onClick={() => void submit()} disabled={saving || !ticketId}>{saving ? "Saving participant…" : <><Save className="h-4 w-4" /> Add participant</>}</Button><Button variant="outline" className="w-full" onClick={() => navigate(`/organizer/events/${event.id}`)} disabled={saving}>Cancel</Button></CardContent></Card></div>
        </div>
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerManualParticipant;
