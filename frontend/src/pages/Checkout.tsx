import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, Copy, Download, Shield } from "lucide-react";
import { toast } from "sonner";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEvent } from "@/hooks/useEvents";
import { useAuth } from "@/contexts/AuthContext";
import type { AddonDefinition, ParticipantFieldConfig } from "@/data/mockEvents";
import { apiRequest } from "@/lib/api";
import { scrollToTop } from "@/lib/scroll";

const CONFIRMATION_TOKEN_KEY = "sportpass_confirmation_token";
type ResponseValue = string | boolean;
type CartLine = { ticketId: string; quantity: number };
type RiderDraft = {
  key: string;
  entryKey: string;
  participantIndex: number;
  ticketId: string;
  responses: Record<string, ResponseValue>;
  selections: Record<string, { selected?: string; qty?: number }>;
};

type RegistrationMode = "account" | "guest";

type RegistrationResponse = {
  registrationReference: string;
  confirmationToken: string;
  claimCode?: string | null;
  amountPaise: number;
  quantity?: number;
  status: string;
  paymentStatus: string;
  participant?: { name: string; email?: string | null; phone?: string | null };
  ticket?: { name?: string | null; category?: string | null } | null;
  event: { name: string; date: string; location: string };
  paymentSettings: {
    method: string;
    upiId: string;
    payeeName: string;
    instructions: string;
    qrImageUrl: string | null;
    upiUri: string;
    qrDataUrl: string;
    currency: string;
    amountPaise: number;
  } | null;
  registrations?: RegistrationResponse[];
};

type BatchRegistrationResponse = RegistrationResponse & { registrations: RegistrationResponse[] };

const EMERGENCY_RIDER_FIELD_IDS = ["emergency_contact_name", "emergency_contact_phone"] as const;
const FALLBACK_FIELDS: ParticipantFieldConfig[] = [
  { id: "full_name", label: "Full name", type: "text", required: true, predefined: true, order: 1 },
  { id: "email", label: "Email", type: "email", required: true, predefined: true, order: 2 },
  { id: "phone", label: "Phone", type: "phone", required: false, predefined: true, order: 3 },
  { id: "date_of_birth", label: "Date of birth", type: "date", required: false, predefined: true, order: 4 },
  { id: "gender", label: "Gender", type: "select", required: false, predefined: true, order: 5, options: ["Male", "Female", "Other", "Prefer not to say"] },
  { id: "jersey_size", label: "Jersey size", type: "select", required: false, predefined: true, order: 6, options: ["XS", "S", "M", "L", "XL", "XXL"] },
  { id: "team_name", label: "Team name", type: "text", required: false, predefined: true, order: 7 },
];

function readCart(eventId: string | undefined, tierId: string | undefined): CartLine[] {
  if (eventId) {
    try {
      const stored = JSON.parse(sessionStorage.getItem(`sportpass_cart_${eventId}`) ?? "null") as CartLine[] | null;
      if (Array.isArray(stored) && stored.length > 0) return stored.filter((line) => line?.ticketId && line.quantity > 0);
    } catch {
      // Fall back to the legacy single-tier route below.
    }
  }
  return tierId ? [{ ticketId: tierId, quantity: 1 }] : [];
}

/**
 * Downloads a UPI QR data URL as a PNG file.
 * The qrDataUrl from the backend is a base64-encoded SVG. We render it onto a
 * canvas first so the user gets a PNG they can upload into any UPI app.
 */
async function downloadQrAsPng(qrDataUrl: string, filename: string): Promise<void> {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not load QR image"));
    img.src = qrDataUrl;
  });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, size, size);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
}

const Checkout = () => {
  const { eventId, tierId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isParticipant, isInitialized } = useAuth();
  const { data: event, isLoading, isError } = useEvent(eventId);
  const participantLabel = "Participant";
  const steps = ["Tickets", `${participantLabel} details`, "UPI Payment"];
  const [cart] = useState<CartLine[]>(() => readCart(eventId, tierId));
  const [riders, setRiders] = useState<RiderDraft[]>([]);
  const [activeRiderIndex, setActiveRiderIndex] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [registration, setRegistration] = useState<BatchRegistrationResponse | null>(null);
  const [utrReference, setUtrReference] = useState("");
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode | null>(null);
  const [qrDownloaded, setQrDownloaded] = useState(false);

  // Advancing a checkout step (or switching participant) can leave mobile users
  // scrolled at the bottom of the previous section. Reset to the top so the new
  // step's heading is visible.
  useEffect(() => {
    scrollToTop();
  }, [currentStep, activeRiderIndex]);

  const checkoutReturnPath = `${location.pathname}${location.search}`;
  const effectiveRegistrationMode = isParticipant ? "account" : registrationMode;
  const fields = useMemo(() => event?.fieldConfig?.fields?.length ? [...event.fieldConfig.fields].sort((a, b) => a.order - b.order) : FALLBACK_FIELDS, [event]);
  const addons = useMemo(() => event?.addonConfig?.addons ?? [], [event]);
  const selectedTiers = useMemo(() => (event?.tiers ?? []).filter((tier) => cart.some((line) => line.ticketId === tier.id)), [cart, event]);
  const entryGroups = useMemo(() => {
    const groups = new Map<string, RiderDraft[]>();
    riders.forEach((rider) => groups.set(rider.entryKey, [...(groups.get(rider.entryKey) ?? []), rider]));
    return [...groups.values()];
  }, [riders]);
  const totalTickets = entryGroups.length;
  const totalParticipants = riders.length;
  const totalPaise = useMemo(() => entryGroups.reduce((total, group) => {
    const entry = group[0];
    const tier = event?.tiers.find((candidate) => candidate.id === entry?.ticketId);
    const addonTotal = addons.reduce((addonSum, addon) => {
      const selection = entry?.selections[addon.id];
      if (!selection) return addonSum;
      return addonSum + addon.price_paise * (addon.type === "quantity" ? (selection.qty ?? 0) : selection.selected ? 1 : 0);
    }, 0);
    return total + (tier?.price ?? 0) * 100 + addonTotal;
  }, 0), [addons, entryGroups, event]);

  useEffect(() => {
    if (!event || riders.length > 0) return;
    const nextRiders: RiderDraft[] = [];
    cart.forEach((line, lineIndex) => {
      const tier = event.tiers.find((candidate) => candidate.id === line.ticketId);
      const participantsPerEntry = tier?.participantsPerEntry ?? 1;
      for (let entryIndex = 0; entryIndex < line.quantity; entryIndex += 1) {
        const entryKey = `${lineIndex}-${line.ticketId}-entry-${entryIndex}`;
        for (let participantIndex = 0; participantIndex < participantsPerEntry; participantIndex += 1) {
          nextRiders.push({ key: `${entryKey}-member-${participantIndex}`, entryKey, participantIndex, ticketId: line.ticketId, responses: {}, selections: {} });
        }
      }
    });
    setRiders(nextRiders);
  }, [cart, event, riders.length]);

  const updateResponse = (riderKey: string, field: ParticipantFieldConfig, value: ResponseValue) => {
    setRiders((previous) => previous.map((rider) => {
      if (rider.key !== riderKey) return rider;
      const responses = { ...rider.responses };
      if (value === "") delete responses[field.id];
      else responses[field.id] = value;
      return { ...rider, responses };
    }));
  };

  const updateAddon = (riderKey: string, addon: AddonDefinition, value: string) => {
    setRiders((previous) => {
      const target = previous.find((rider) => rider.key === riderKey);
      if (!target) return previous;
      const selections = { ...target.selections };
      if (addon.type === "quantity") {
        const qty = Math.max(0, Number(value) || 0);
        if (qty === 0) delete selections[addon.id];
        else selections[addon.id] = { qty };
      } else if (!value) delete selections[addon.id];
      else selections[addon.id] = { selected: value };
      return previous.map((rider) => rider.entryKey === target.entryKey ? { ...rider, selections } : rider);
    });
  };

  const riderReady = (rider: RiderDraft) => {
    const isEntryPrimary = rider.participantIndex === 0;
    const fieldsReady = fields.every((field) => {
      const isSharedContact = field.id === "email" || field.id === "phone";
      if (!field.required || (isSharedContact && !isEntryPrimary)) return true;
      const value = rider.responses[field.id];
      return value !== undefined && String(value).trim() !== "";
    });
    const sharedContactReady = !isEntryPrimary || ["email", "phone"].some((fieldId) => {
      const value = rider.responses[fieldId];
      return value !== undefined && String(value).trim() !== "";
    });
    const addonsReady = addons.every((addon) => {
      if (!addon.required) return true;
      const selection = rider.selections[addon.id];
      return addon.type === "quantity"
        ? (selection?.qty ?? 0) >= 1
        : Boolean(selection?.selected);
    });
    return fieldsReady && sharedContactReady && addonsReady;
  };
  const participantReady = riders.length > 0 && riders.every(riderReady);
  const completedRiders = riders.filter(riderReady).length;
  const activeRider = riders[activeRiderIndex] ?? riders[0];
  const activeTier = event?.tiers.find((tier) => tier.id === activeRider?.ticketId);
  const identityFields = fields.filter((field) => field.id === "full_name");
  const contactFields = fields.filter((field) => field.id === "email" || field.id === "phone");
  const emergencyFields = fields.filter((field) => EMERGENCY_RIDER_FIELD_IDS.includes(field.id as typeof EMERGENCY_RIDER_FIELD_IDS[number]));
  const otherFields = fields.filter((field) => !identityFields.includes(field) && !contactFields.includes(field) && !emergencyFields.includes(field));

  if (isLoading) return <Layout><div className="py-20 text-center text-muted-foreground">Loading event…</div></Layout>;
  if (isError || !event || selectedTiers.length === 0) return <Layout><div className="py-20 text-center text-muted-foreground">Event or ticket selection not found.</div></Layout>;
  if (event.registrationStatus === "closed") return <Layout><div className="mx-auto max-w-2xl px-4 py-20 text-center"><h1 className="text-2xl font-extrabold">Registration is closed</h1><p className="mt-3 text-muted-foreground">The organizer is not accepting new responses for {event.title}.</p><Button className="mt-6" onClick={() => navigate(`/event/${event.id}`)}>Back to event</Button></div></Layout>;

  const createRegistration = async () => {
    if (!participantReady || !eventId) {
      toast.error(`Complete all required ${participantLabel.toLowerCase()} fields before continuing.`);
      return;
    }
    if (!effectiveRegistrationMode) {
      toast.error("Choose whether to use a participant account or continue as a guest.");
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<BatchRegistrationResponse>("/registrations/batch", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          event_id: eventId,
          entries: entryGroups.map((group) => {
            const primaryResponses = group[0].responses;
            return {
              ticket_id: group[0].ticketId,
              email: primaryResponses.email,
              phone: primaryResponses.phone,
              participants: group.map(({ responses }) => ({
                responses: Object.fromEntries(Object.entries(responses).filter(([fieldId]) => fieldId !== "email" && fieldId !== "phone")),
              })),
              selections: group[0].selections,
            };
          }),
        }),
      });
      setRegistration(result);
      if (result.confirmationToken) sessionStorage.setItem(CONFIRMATION_TOKEN_KEY, result.confirmationToken);
      const allFree = result.registrations.every((child) => child.paymentStatus === "not_required");
      if (allFree) {
        toast.success(`All ${participantLabel.toLowerCase()} registrations confirmed.`);
        navigate("/confirmation", { state: result });
        return;
      }
      setCurrentStep(2);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const submitUtr = async () => {
    if (!registration?.confirmationToken) return;
    setLoading(true);
    try {
      const result = await apiRequest<BatchRegistrationResponse>("/registrations/payment-reference", {
        method: "POST",
        body: JSON.stringify({ confirmation_token: registration.confirmationToken, utr_reference: utrReference || null }),
      });
      const childTokens = registration.registrations.map((child, index) => ({
        ...result.registrations[index],
        confirmationToken: child.confirmationToken,
        claimCode: child.claimCode,
      }));
      toast.success(utrReference.trim() ? `Reference submitted for all ${participantLabel.toLowerCase()}s. The organizer will verify your payment.` : "Registration saved. Pay by UPI and submit your reference when ready.");
      navigate("/confirmation", { state: { ...result, registrations: childTokens } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit payment reference");
    } finally {
      setLoading(false);
    }
  };

  const totalRupees = (registration?.amountPaise ?? totalPaise) / 100;

  const copyUpi = async () => {
    if (registration?.paymentSettings?.upiId) {
      await navigator.clipboard.writeText(registration.paymentSettings.upiId);
      toast.success("UPI ID copied");
    }
  };
  const fieldInput = (rider: RiderDraft, field: ParticipantFieldConfig) => {
    const value = rider.responses[field.id];
    if (field.type === "select" || field.type === "dropdown" || field.type === "yes_no") {
      const options = field.type === "yes_no" ? ["Yes", "No"] : field.options ?? [];
      const selectValue = value === undefined ? "" : field.type === "yes_no" ? value === true ? "Yes" : "No" : String(value);
      return <Select value={selectValue} onValueChange={(next) => updateResponse(rider.key, field, field.type === "yes_no" ? next === "Yes" : next)}><SelectTrigger><SelectValue placeholder="Select an option" /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select>;
    }
    return <Input type={field.type === "email" ? "email" : field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} value={value === undefined ? "" : String(value)} onChange={(e) => updateResponse(rider.key, field, e.target.value)} placeholder={field.type === "phone" ? "+91 98765 43210" : undefined} />;
  };
  const renderFieldGrid = (rider: RiderDraft, groupFields: ParticipantFieldConfig[]) => groupFields.length > 0 && <div className="grid gap-4 sm:grid-cols-2">{groupFields.map((field) => <div key={field.id} className={`space-y-2 ${field.id === "full_name" || field.id.startsWith("custom_") ? "sm:col-span-2" : ""}`}><Label>{field.label}{field.required ? " *" : ""}</Label>{fieldInput(rider, field)}</div>)}</div>;

  return (
    <Layout>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <button onClick={() => (currentStep > 0 && !registration ? setCurrentStep(currentStep - 1) : navigate(-1))} className="mb-6 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> {currentStep > 0 && !registration ? "Previous step" : "Back to event"}</button>
        <div className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="mb-2 text-sm font-semibold uppercase tracking-wider text-primary">Registration checkout</p><h1 className="text-3xl font-extrabold tracking-tight">Register for this event</h1><p className="mt-2 text-muted-foreground">{event.title} · {event.date}</p></div><p className="text-sm text-muted-foreground">{totalTickets} {totalTickets === 1 ? "entry" : "entries"} selected</p></div>
        <div className="mb-8 flex items-center justify-center gap-2">{(totalPaise === 0 ? steps.slice(0, 2) : steps).map((label, index) => <div key={label} className="flex items-center gap-2"><div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${index <= currentStep ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>{index < currentStep ? <CheckCircle2 className="h-4 w-4" /> : index + 1}</div><span className={`hidden text-sm sm:inline ${index === currentStep ? "font-medium text-foreground" : "text-muted-foreground"}`}>{label}</span>{index < (totalPaise === 0 ? 1 : steps.length - 1) && <div className="h-px w-8 bg-border sm:w-12" />}</div>)}</div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <main className="min-w-0">
            {currentStep === 0 && <section className="space-y-5"><div><h2 className="text-xl font-bold">Review your tickets</h2><p className="mt-1 text-sm text-muted-foreground">We’ll collect the required participant profiles for every entry below.</p></div><div className="space-y-3">{selectedTiers.map((tier) => { const quantity = cart.find((line) => line.ticketId === tier.id)?.quantity ?? 0; return <div key={tier.id} className="flex items-center justify-between rounded-2xl border bg-card p-5 shadow-sm"><div><p className="font-bold">{tier.name} <span className="font-normal text-muted-foreground">× {quantity}</span></p><p className="mt-1 text-sm text-muted-foreground">{tier.description}</p></div><p className="text-lg font-bold text-primary">₹{(tier.price * quantity).toLocaleString("en-IN")}</p></div>; })}</div><div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground"><p className="font-semibold text-foreground">What happens next?</p><p className="mt-1">We’ll collect member details for each entry, then make one payment for the paid entries.</p></div><div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground"><p className="font-semibold text-foreground">Save your registration</p>{!isInitialized ? <p className="mt-1">Checking your account session…</p> : isParticipant ? <p className="mt-1">You are signed in as <span className="font-semibold text-foreground">{user?.email}</span>. This registration will be linked to your participant account so you can easily access your records, tickets, and results.</p> : <div className="mt-3 space-y-3"><p>Create a free participant account to keep your registrations, tickets, and results together. You can also continue as a guest. Guest checkout gives you a private claim code on the confirmation page; save it with your registration reference so you can link this registration to an account later.</p><div className="flex flex-col gap-2 sm:flex-row"><Button type="button" onClick={() => { setRegistrationMode("guest"); setCurrentStep(1); }}}>Continue as guest</Button><Button type="button" variant="outline" onClick={() => navigate("/login", { state: { from: checkoutReturnPath } })}>I have an account — sign in</Button><Button type="button" variant="ghost" onClick={() => navigate("/signup?type=participant", { state: { from: checkoutReturnPath } })}>Create participant account</Button></div>{registrationMode === "guest" && <p className="font-medium text-foreground">Guest checkout selected. After registration, your confirmation page will show a private one-time claim code. Save it with your registration reference; use both in your participant dashboard to link this registration later. This is separate from your event ticket QR.</p>}</div>}</div><Button onClick={() => setCurrentStep(1)} disabled={!isInitialized || !effectiveRegistrationMode} size="lg" className="w-full">Start {participantLabel.toLowerCase()} details <ArrowRight className="ml-2 h-4 w-4" /></Button></section>}

            {currentStep === 1 && activeRider && <section className="space-y-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-xl font-bold">{participantLabel} details</h2><p className="mt-1 text-sm text-muted-foreground">Complete one {participantLabel.toLowerCase()} at a time. You can return to any {participantLabel.toLowerCase()} before submitting.</p></div><p className="text-sm font-medium text-muted-foreground">{completedRiders} of {totalParticipants} complete</p></div><div className="h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${totalParticipants ? (completedRiders / totalParticipants) * 100 : 0}%` }} /></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{riders.map((rider, index) => { const tier = event.tiers.find((candidate) => candidate.id === rider.ticketId); const complete = riderReady(rider); const active = index === activeRiderIndex; return <button key={rider.key} type="button" onClick={() => setActiveRiderIndex(index)} className={`rounded-xl border p-3 text-left transition-colors ${active ? "border-primary bg-primary/10 shadow-sm" : "border-border bg-card hover:border-primary/40"}`}><span className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">{participantLabel} {index + 1}{complete && <CheckCircle2 className="h-4 w-4 text-accent" />}</span><span className="mt-1 block truncate text-sm font-semibold">{tier?.name}</span><span className="mt-1 block text-xs text-muted-foreground">{complete ? "Ready" : "Needs details"}</span></button>; })}</div><div className="overflow-hidden rounded-2xl border-2 border-primary/30 bg-card shadow-sm"><div className="flex items-start justify-between gap-4 bg-primary/5 px-5 py-4 sm:px-6"><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">{participantLabel} {activeRiderIndex + 1} of {totalParticipants}</p><h3 className="mt-1 text-xl font-bold">{activeTier?.name}</h3><p className="mt-1 text-sm text-muted-foreground">{activeTier?.description}</p></div><div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center"><p className="whitespace-nowrap text-lg font-bold text-primary">₹{activeTier?.price.toLocaleString("en-IN")}</p></div></div><div className="space-y-6 p-5 sm:p-6"><section className="space-y-4"><div><h4 className="font-bold">Participant identity</h4><p className="text-sm text-muted-foreground">Use the person who will participate in this event.</p></div>{renderFieldGrid(activeRider, identityFields)}</section>{activeRider.participantIndex === 0 && contactFields.length > 0 && <section className="space-y-4 border-t pt-6"><div><h4 className="font-bold">Entry contact</h4><p className="text-sm text-muted-foreground">One email or phone number is used for this entire entry.</p></div>{renderFieldGrid(activeRider, contactFields)}</section>}{otherFields.length > 0 && <section className="space-y-4 border-t pt-6"><div><h4 className="font-bold">Event details</h4><p className="text-sm text-muted-foreground">These details can be different for every participant.</p></div>{renderFieldGrid(activeRider, otherFields)}</section>}{emergencyFields.length > 0 && <section className="space-y-4 border-t pt-6"><div><h4 className="font-bold">Emergency contact</h4><p className="text-sm text-muted-foreground">Who should we contact if this {participantLabel.toLowerCase()} needs help?</p></div>{renderFieldGrid(activeRider, emergencyFields)}</section>}{addons.length > 0 && <section className="space-y-4 border-t pt-6"><div><h4 className="font-bold">Add-ons for this entry</h4><p className="text-sm text-muted-foreground">Add-ons are optional and saved once for this entry. Leave the quantity at 0 if you do not need one.</p></div><div className="grid gap-4 sm:grid-cols-2">{addons.map((addon) => <div key={addon.id} className="space-y-2"><Label>{addon.name}{addon.required ? " *" : ""} {addon.price_paise > 0 && <span className="text-muted-foreground">(+₹{(addon.price_paise / 100).toFixed(2)}{addon.type === "quantity" ? " each" : ""})</span>}</Label>{addon.type === "quantity" ? <Input type="number" min={addon.required ? 1 : 0} max={addon.max_qty ?? undefined} value={activeRider.selections[addon.id]?.qty ?? 0} onChange={(e) => updateAddon(activeRider.key, addon, e.target.value)} placeholder="0" /> : <Select value={activeRider.selections[addon.id]?.selected ?? ""} onValueChange={(value) => updateAddon(activeRider.key, addon, value)}><SelectTrigger><SelectValue placeholder="Select an option" /></SelectTrigger><SelectContent>{(addon.options ?? []).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select>}</div>)}</div></section>}</div></div><div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><Button type="button" variant="outline" onClick={() => activeRiderIndex > 0 ? setActiveRiderIndex(activeRiderIndex - 1) : setCurrentStep(0)}><ArrowLeft className="mr-2 h-4 w-4" /> Previous</Button>{activeRiderIndex < totalParticipants - 1 ? <Button type="button" onClick={() => { if (!riderReady(activeRider)) { toast.error(`Complete the required ${participantLabel.toLowerCase()} fields for this ${participantLabel.toLowerCase()}.`); return; } setActiveRiderIndex(activeRiderIndex + 1); }}>Save {participantLabel.toLowerCase()} & continue <ArrowRight className="ml-2 h-4 w-4" /></Button> : <Button type="button" onClick={createRegistration} disabled={!participantReady || loading}>{loading ? "Creating registrations…" : totalPaise === 0 ? "Complete free registrations" : "Continue to payment"}<ArrowRight className="ml-2 h-4 w-4" /></Button>}</div>{!participantReady && activeRiderIndex === totalParticipants - 1 && <p className="text-right text-sm text-muted-foreground">Complete the required {participantLabel.toLowerCase()} fields for every {participantLabel.toLowerCase()} before continuing.</p>}</section>}

            {currentStep === 2 && registration && <section className="space-y-5"><div><h2 className="text-xl font-bold">Pay for all {participantLabel.toLowerCase()}s</h2><p className="mt-1 text-sm text-muted-foreground">One payment covers all paid entries in this order.</p></div><div className="rounded-2xl border bg-card p-5"><p className="text-sm text-muted-foreground">{registration.registrations.length} {registration.registrations.length === 1 ? "entry" : "entries"}</p><p className="mt-2 text-sm font-bold tracking-wide">{registration.registrations.map((child) => child.registrationReference).join(" · ")}</p><p className="mt-5 text-sm text-muted-foreground">Total amount to pay</p><p className="text-3xl font-extrabold text-primary">₹{totalRupees.toLocaleString("en-IN")}</p></div>{registration.paymentSettings && <div className="space-y-4 rounded-2xl border bg-primary/5 p-5"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">UPI ID</p><p className="font-bold">{registration.paymentSettings.upiId}</p><p className="text-xs text-muted-foreground">Payee: {registration.paymentSettings.payeeName}</p></div><Button variant="outline" size="sm" onClick={copyUpi}><Copy className="mr-2 h-4 w-4" /> Copy</Button></div><p className="text-sm text-muted-foreground">{registration.paymentSettings.instructions}</p><div className="flex flex-col items-center gap-3 rounded-lg bg-white p-3"><img src={registration.paymentSettings.qrDataUrl} alt="Generated UPI payment QR" className="h-56 w-56" /><p className="text-xs text-muted-foreground">Scan to pay ₹{totalRupees.toLocaleString("en-IN")}</p></div>{registration.paymentSettings.qrImageUrl && <div><p className="mb-2 text-xs font-medium text-muted-foreground">Organizer-provided QR</p><img src={registration.paymentSettings.qrImageUrl} alt="Organizer UPI QR" className="mx-auto max-h-56 rounded-lg" /></div>}<div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900/50 dark:bg-blue-950/20"><p className="font-semibold text-blue-900 dark:text-blue-100">Can't scan? Pay from your UPI app directly</p><p className="mt-1 text-blue-800/80 dark:text-blue-100/80">Download the QR image below, then open your UPI app (GPay, PhonePe, Paytm, etc.), choose <span className="font-semibold">Scan QR</span> or <span className="font-semibold">Upload QR</span>, and select the downloaded image to pay ₹{totalRupees.toLocaleString("en-IN")} automatically.</p><Button type="button" variant="outline" size="sm" className="mt-3 gap-2 border-blue-300 bg-white text-blue-900 hover:bg-blue-50 dark:border-blue-800 dark:bg-transparent dark:text-blue-100" onClick={() => void downloadQrAsPng(registration.paymentSettings!.qrDataUrl, `sportpass-payment-qr-${registration.registrations[0]?.registrationReference ?? "order"}.png`).then(() => setQrDownloaded(true)).catch(() => toast.error("Could not download QR image"))}><Download className="h-4 w-4" /> Download QR image</Button>{qrDownloaded && <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-400"><CheckCircle2 className="h-4 w-4 shrink-0" /> QR saved — open your UPI app, tap Scan QR or Upload QR, and pick this image to pay.</p>}</div></div>}<div className="space-y-2"><Label>UTR / transaction reference (optional)</Label><Input value={utrReference} onChange={(e) => setUtrReference(e.target.value)} placeholder="Enter it after paying in your UPI app" /><p className="text-xs text-muted-foreground">One reference will be submitted for the complete {participantLabel.toLowerCase()} group.</p></div><Button onClick={submitUtr} disabled={loading} size="lg" className="w-full">{loading ? "Saving…" : "Submit reference / continue"}</Button><p className="flex items-center justify-center gap-1 text-xs text-muted-foreground"><Shield className="h-3 w-3" /> Do not enter card details on SportPass.</p></section>}
          </main>

          <aside className="lg:col-span-1"><div className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm lg:sticky lg:top-24"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Order summary</p><p className="mt-1 text-lg font-bold">{event.title}</p><p className="text-sm text-muted-foreground">{event.location}</p></div><div className="space-y-3 border-t pt-4">{selectedTiers.map((tier) => { const quantity = cart.find((line) => line.ticketId === tier.id)?.quantity ?? 0; return <div key={tier.id} className="flex items-center justify-between gap-3 text-sm"><span><span className="font-medium">{tier.name}</span><span className="ml-2 text-muted-foreground">× {quantity}</span></span><span className="font-semibold">₹{(tier.price * quantity).toLocaleString("en-IN")}</span></div>; })}<div className="flex items-center justify-between border-t pt-3"><span className="font-bold">Total</span><span className="text-xl font-extrabold text-primary">₹{(totalPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div></div>{currentStep === 1 && <div className="border-t pt-4"><div className="mb-3 flex items-center justify-between text-sm"><span className="font-semibold">{participantLabel} progress</span><span className="text-muted-foreground">{completedRiders}/{totalParticipants}</span></div><div className="space-y-2">{riders.map((rider, index) => { const tier = event.tiers.find((candidate) => candidate.id === rider.ticketId); return <button key={rider.key} type="button" onClick={() => setActiveRiderIndex(index)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"><span className={index === activeRiderIndex ? "font-semibold text-primary" : "text-muted-foreground"}>{participantLabel} {index + 1} · {tier?.name}</span>{riderReady(rider) ? <CheckCircle2 className="h-4 w-4 text-accent" /> : <span className="text-xs text-muted-foreground">Pending</span>}</button>; })}</div></div>}<div className="border-t pt-4 text-xs text-muted-foreground"><p className="font-semibold text-foreground">Secure registration</p><p className="mt-1">Each entry receives one event ticket and check-in QR.</p></div></div></aside>
        </div>
      </div>
    </Layout>
  );
};

export default Checkout;
