import { MAX_TICKETS_PER_TRANSACTION } from "@/lib/registration-limits";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, Copy, Download, Plus, Shield, Trash2 } from "lucide-react";
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
import { computeSportPassFeePaise, formatPaise } from "@/lib/platform-fee";

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
  baseAmountPaise?: number;
  platformFeePaise?: number;
  platformFeeBearer?: "ORGANIZER" | "PARTICIPANT";
  participantTotalPaise?: number;
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
  // Team two-section config (present only for team-format events)
  const mainRegistrantFields = useMemo(
    () => event?.fieldConfig?.main_registrant_fields ? [...event.fieldConfig.main_registrant_fields].sort((a, b) => a.order - b.order) : [],
    [event],
  );
  const teamParticipantFields = useMemo(
    () => event?.fieldConfig?.participant_fields ? [...event.fieldConfig.participant_fields].sort((a, b) => a.order - b.order) : [],
    [event],
  );
  const addons = useMemo(() => event?.addonConfig?.addons ?? [], [event]);
  const selectedTiers = useMemo(() => (event?.tiers ?? []).filter((tier) => cart.some((line) => line.ticketId === tier.id)), [cart, event]);
  const tierById = useMemo(() => new Map((event?.tiers ?? []).map((tier) => [tier.id, tier])), [event]);
  const isTeamTier = (ticketId: string | undefined) => ticketId != null && tierById.get(ticketId)?.entryType === "team";
  // For a given rider, resolve the field list to render (team-aware)
  const fieldsForRider = (rider: RiderDraft): ParticipantFieldConfig[] => {
    if (!isTeamTier(rider.ticketId)) return fields;
    return rider.participantIndex === 0 ? [...mainRegistrantFields, ...teamParticipantFields] : teamParticipantFields;
  };
  const entryGroups = useMemo(() => {
    const groups = new Map<string, RiderDraft[]>();
    riders.forEach((rider) => groups.set(rider.entryKey, [...(groups.get(rider.entryKey) ?? []), rider]));
    return [...groups.values()];
  }, [riders]);
  const totalTickets = entryGroups.length;
  const totalParticipants = riders.length;
  const entryBasePaise = useMemo(() => entryGroups.map((group) => {
    const entry = group[0];
    const tier = event?.tiers.find((candidate) => candidate.id === entry?.ticketId);
    const addonTotal = addons.reduce((addonSum, addon) => {
      const selection = entry?.selections[addon.id];
      if (!selection) return addonSum;
      return addonSum + addon.price_paise * (addon.type === "quantity" ? (selection.qty ?? 0) : selection.selected ? 1 : 0);
    }, 0);
    return (tier?.price ?? 0) * 100 + addonTotal;
  }), [addons, entryGroups, event]);
  const totalPaise = useMemo(() => entryBasePaise.reduce((sum, value) => sum + value, 0), [entryBasePaise]);

  // SportPass fee preview (one entry = one paid registration).
  const feeConfig = {
    percentageBasisPoints: event?.sportPassFeePercentageBasisPoints ?? 400,
    minimumFeePaise: event?.sportPassFeeMinimumPaise ?? 2000,
    maximumFeePaise: event?.sportPassFeeMaximumPaise ?? 6000,
  };
  const participantBearsFee = event?.platformFeeBearer === "PARTICIPANT";
  const sportPassFeePaise = useMemo(
    () => entryBasePaise.reduce((sum, base) => sum + computeSportPassFeePaise(base, feeConfig), 0),
    [entryBasePaise, feeConfig.percentageBasisPoints, feeConfig.minimumFeePaise, feeConfig.maximumFeePaise],
  );
  const participantTotalPreviewPaise = totalPaise + (participantBearsFee ? sportPassFeePaise : 0);

  useEffect(() => {
    if (!event || riders.length > 0) return;
    const nextRiders: RiderDraft[] = [];
    cart.forEach((line, lineIndex) => {
      const tier = event.tiers.find((candidate) => candidate.id === line.ticketId);
      // For team tiers, start with the minimum required members; participants can add more.
      const initialMembers = tier?.entryType === "team" ? (tier.teamSizeMin ?? 1) : (tier?.participantsPerEntry ?? 1);
      for (let entryIndex = 0; entryIndex < line.quantity; entryIndex += 1) {
        const entryKey = `${lineIndex}-${line.ticketId}-entry-${entryIndex}`;
        for (let participantIndex = 0; participantIndex < initialMembers; participantIndex += 1) {
          const responses: Record<string, ResponseValue> = {};
          nextRiders.push({ key: `${entryKey}-member-${participantIndex}`, entryKey, participantIndex, ticketId: line.ticketId, responses, selections: {} });
        }
      }
    });
    setRiders(nextRiders);
  }, [cart, event, riders.length]);

  // Auto-fill captain fields from team info for the first member
  const updateResponse = (riderKey: string, field: ParticipantFieldConfig, value: ResponseValue) => {
    setRiders((previous) => {
      const updatedRiders = previous.map((rider) => {
        if (rider.key !== riderKey) return rider;
        const responses = { ...rider.responses };
        if (value === "") delete responses[field.id];
        else responses[field.id] = value;
        return { ...rider, responses };
      });
      
      // For team events, auto-fill captain fields to the first member
      const firstRider = updatedRiders[0];
      if (firstRider) {
        const firstTier = event?.tiers.find((tier) => tier.id === firstRider.ticketId);
        if (firstTier?.entryType === "team") {
          // Group by entry to find riders in the same entry
          const entryMap = new Map<string, RiderDraft[]>();
          updatedRiders.forEach((r) => {
            const entry = entryMap.get(r.entryKey) || [];
            entry.push(r);
            entryMap.set(r.entryKey, entry);
          });
          
          const firstEntryKey = firstRider.entryKey;
          const entryRiders = entryMap.get(firstEntryKey) || [];
          const firstRiderInEntry = entryRiders.find((r) => r.participantIndex === 0);
          
          if (firstRiderInEntry) {
            const captainName = firstRiderInEntry.responses["captain_name"];
            const captainEmail = firstRiderInEntry.responses["captain_email"];
            const captainPhone = firstRiderInEntry.responses["captain_phone"];
            
            // Find the first member (participantIndex 0) and update their fields
            const firstMemberIndex = updatedRiders.findIndex(
              (r) => r.entryKey === firstEntryKey && r.participantIndex === 0
            );
            
            if (firstMemberIndex !== -1) {
              const updatedFirstMember = { ...updatedRiders[firstMemberIndex] };
              if (captainName && !updatedFirstMember.responses["full_name"]) {
                updatedFirstMember.responses["full_name"] = captainName;
              }
              if (captainEmail && !updatedFirstMember.responses["email"]) {
                updatedFirstMember.responses["email"] = captainEmail;
              }
              if (captainPhone && !updatedFirstMember.responses["phone"]) {
                updatedFirstMember.responses["phone"] = captainPhone;
              }
              updatedRiders[firstMemberIndex] = updatedFirstMember;
              
              // Auto-fill team_name for all members in the entry
              const teamName = firstRiderInEntry.responses["team_name"];
              if (teamName) {
                entryRiders.forEach((rider) => {
                  if (!rider.responses["team_name"]) {
                    const riderIndex = updatedRiders.findIndex((r) => r.key === rider.key);
                    if (riderIndex !== -1) {
                      updatedRiders[riderIndex] = { ...rider, responses: { ...rider.responses, team_name: teamName } };
                    }
                  }
                });
              }
            }
          }
        }
      }
      
      return updatedRiders;
    });
  };

  const membersInEntry = (entryKey: string) => riders.filter((rider) => rider.entryKey === entryKey);

  const addTeamMember = (entryKey: string, ticketId: string) => {
    const existing = membersInEntry(entryKey);
    const tier = tierById.get(ticketId);
    const max = tier?.teamSizeMax ?? existing.length;
    if (existing.length >= max) {
      toast.error(`This team can have at most ${max} members.`);
      return;
    }
    const nextIndex = existing.length;
    const primarySelections = existing[0]?.selections ?? {};
    setRiders((previous) => [
      ...previous,
      { key: `${entryKey}-member-${nextIndex}-${crypto.randomUUID().slice(0, 8)}`, entryKey, participantIndex: nextIndex, ticketId, responses: {}, selections: { ...primarySelections } },
    ]);
  };

  const removeTeamMember = (riderKey: string) => {
    setRiders((previous) => {
      const target = previous.find((rider) => rider.key === riderKey);
      if (!target) return previous;
      const tier = tierById.get(target.ticketId);
      const min = tier?.teamSizeMin ?? 1;
      const entryMembers = previous.filter((rider) => rider.entryKey === target.entryKey);
      if (entryMembers.length <= min) {
        toast.error(`This team must have at least ${min} members.`);
        return previous;
      }
      // Remove the target, then re-index remaining members within the entry
      const remaining = previous.filter((rider) => rider.key !== riderKey);
      let idx = 0;
      return remaining.map((rider) => {
        if (rider.entryKey !== target.entryKey) return rider;
        return { ...rider, participantIndex: idx++ };
      });
    });
    // Keep active index in bounds
    setActiveRiderIndex((current) => Math.max(0, current - (riders.findIndex((r) => r.key === riderKey) <= current ? 1 : 0)));
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

  const CONTACT_FIELD_IDS = ["email", "phone", "captain_email", "captain_phone"];
  const riderReady = (rider: RiderDraft) => {
    const isEntryPrimary = rider.participantIndex === 0;
    const riderFields = fieldsForRider(rider);
    const fieldsReady = riderFields.every((field) => {
      const isSharedContact = CONTACT_FIELD_IDS.includes(field.id);
      if (!field.required || (isSharedContact && !isEntryPrimary)) return true;
      const value = rider.responses[field.id];
      return value !== undefined && String(value).trim() !== "";
    });
    const sharedContactReady = !isEntryPrimary || CONTACT_FIELD_IDS.some((fieldId) => {
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
  const activeIsTeam = isTeamTier(activeRider?.ticketId);
  const activeFields = activeRider ? fieldsForRider(activeRider) : fields;
  const identityFields = activeFields.filter((field) => field.id === "full_name");
  const contactFields = activeFields.filter((field) => CONTACT_FIELD_IDS.includes(field.id));
  const emergencyFields = activeFields.filter((field) => EMERGENCY_RIDER_FIELD_IDS.includes(field.id as typeof EMERGENCY_RIDER_FIELD_IDS[number]));
  const teamInfoFields = activeFields.filter((field) => field.id === "team_name" || field.id === "captain_name");
  const otherFields = activeFields.filter((field) => !identityFields.includes(field) && !contactFields.includes(field) && !emergencyFields.includes(field) && !teamInfoFields.includes(field));

  if (isLoading) return <Layout><div className="py-20 text-center text-muted-foreground">Loading event…</div></Layout>;
  if (isError || !event || selectedTiers.length === 0) return <Layout><div className="py-20 text-center text-muted-foreground">Event or ticket selection not found.</div></Layout>;
  if (event.registrationStatus === "closed") return <Layout><div className="mx-auto max-w-2xl px-4 py-20 text-center"><h1 className="text-2xl font-extrabold">Registration is closed</h1><p className="mt-3 text-muted-foreground">The organizer is not accepting new responses for {event.title}.</p><Button className="mt-6" onClick={() => navigate(`/event/${event.id}`)}>Back to event</Button></div></Layout>;

  if (cart.reduce((sum, line) => sum + line.quantity, 0) > MAX_TICKETS_PER_TRANSACTION) return <Layout><div className="mx-auto max-w-2xl px-4 py-20 text-center"><h1 className="text-2xl font-extrabold">Maximum {MAX_TICKETS_PER_TRANSACTION} tickets per transaction</h1><p className="mt-3 text-muted-foreground">Your selection exceeds the limit. Reduce your selection before entering participant details.</p><Button className="mt-6" onClick={() => navigate(`/event/${event.id}`)}>Change ticket selection</Button></div></Layout>;

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
            // Main-registrant-only fields live on the captain (index 0). They must
            // not be sent on other members, whose rows are validated against the
            // per-member field list only.
            const MAIN_REGISTRANT_ONLY_IDS = ["team_name", "captain_name", "captain_email", "captain_phone"];
            return {
              ticket_id: group[0].ticketId,
              email: (primaryResponses.email ?? primaryResponses.captain_email) as string | undefined,
              phone: (primaryResponses.phone ?? primaryResponses.captain_phone) as string | undefined,
              participants: group.map(({ responses }, memberIndex) => ({
                // Strip the plain shared-contact keys for everyone; keep captain_* on the captain only.
                // For non-captain members, also strip main-registrant-only fields (e.g. team_name).
                responses: Object.fromEntries(
                  Object.entries(responses).filter(([fieldId]) => {
                    if (fieldId === "email" || fieldId === "phone") return false;
                    if (memberIndex > 0 && MAIN_REGISTRANT_ONLY_IDS.includes(fieldId)) return false;
                    return true;
                  }),
                ),
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

  // Once submitted, the authoritative amount the participant pays is the UPI amount
  // (participant total incl. fee when they bear it). Fall back to the preview otherwise.
  const chargedPaise = registration?.paymentSettings?.amountPaise
    ?? registration?.participantTotalPaise
    ?? registration?.amountPaise
    ?? participantTotalPreviewPaise;
  const totalRupees = chargedPaise / 100;

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

  // Team-specific view: show all participants in a table/grid with all fields together per member
  const teamParticipantsView = () => {
    const entryKeys = Array.from(new Set(riders.map((r) => r.entryKey)));
    const firstRider = riders[0];
    const firstTier = firstRider ? event?.tiers.find((tier) => tier.id === firstRider.ticketId) : undefined;
    const minMembers = firstTier?.teamSizeMin ?? 1;
    const maxMembers = firstTier?.teamSizeMax ?? 50;

    return (
      <div className="space-y-6">
        {entryKeys.map((entryKey, entryIdx) => {
          const entryRiders = riders.filter((r) => r.entryKey === entryKey).sort((a, b) => a.participantIndex - b.participantIndex);
          const entryRider = entryRiders[0];
          const fields = fieldsForRider(entryRider);
          
          // Group fields by type
          // Team info fields (collected once): team_name, captain_name
          const teamInfoFieldIds = ["team_name", "captain_name"];
          const teamInfoFields = fields.filter((f) => teamInfoFieldIds.includes(f.id));
          const contactFields = fields.filter((f) => CONTACT_FIELD_IDS.includes(f.id));
          // Per-member fields: everything that is NOT team info and NOT contact
          const memberFields = fields.filter((f) => !teamInfoFieldIds.includes(f.id) && !CONTACT_FIELD_IDS.includes(f.id));
          const allOtherFields: ParticipantFieldConfig[] = [];

          return (
            <div key={entryKey} className="overflow-hidden rounded-2xl border-2 border-primary/30 bg-card shadow-sm">
              <div className="flex items-start justify-between gap-4 bg-primary/5 px-5 py-4 sm:px-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Entry {entryIdx + 1} · {entryRiders.length} member{entryRiders.length !== 1 ? "s" : ""}
                  </p>
                  <h3 className="mt-1 text-xl font-bold">{firstTier?.name}</h3>
                </div>
                <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
                  <p className="whitespace-nowrap text-lg font-bold text-primary">₹{firstTier?.price.toLocaleString("en-IN")}</p>
                </div>
              </div>
              <div className="space-y-6 p-5 sm:p-6">
                {/* Team information (collected once per entry) */}
                {teamInfoFields.length > 0 && (
                  <section className="space-y-4 border-b pb-6">
                    <div>
                      <h4 className="font-bold">Team information</h4>
                      <p className="text-sm text-muted-foreground">Collected once for the whole team.</p>
                    </div>
                    {renderFieldGrid(entryRider, teamInfoFields)}
                  </section>
                )}

                {/* Captain contact (collected once per entry) - now after team info */}
                {contactFields.length > 0 && (
                  <section className="space-y-4 border-b pb-6">
                    <div>
                      <h4 className="font-bold">Captain contact</h4>
                      <p className="text-sm text-muted-foreground">One email or phone number is used for this entire team.</p>
                    </div>
                    {renderFieldGrid(entryRider, contactFields)}
                  </section>
                )}

                {/* All member details in a single row per member */}
                <section className="space-y-4 border-b pb-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold">Member details</h4>
                      <p className="text-sm text-muted-foreground">Use the person who will participate in this event.</p>
                    </div>
                    <div className="flex gap-2">
                      {entryRiders.length > minMembers && (
                        <Button type="button" variant="outline" size="sm" onClick={() => removeTeamMember(entryRiders[entryRiders.length - 1].key)}>
                          <Trash2 className="mr-1 h-4 w-4" /> Remove last
                        </Button>
                      )}
                      {entryRiders.length < maxMembers && (
                        <Button type="button" variant="outline" size="sm" onClick={() => addTeamMember(entryKey, firstRider?.ticketId || "")}>
                          <Plus className="mr-1 h-4 w-4" /> Add member
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {entryRiders.map((rider, idx) => {
                      const memberFieldsGroup = memberFields.concat(allOtherFields).sort((a, b) => a.order - b.order);
                      return (
                        <div key={rider.key} className="overflow-hidden rounded-xl border bg-secondary/20 shadow-sm">
                          <div className="border-b bg-muted/30 px-4 py-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Member {rider.participantIndex + 1}
                            </span>
                            {!riderReady(rider) && <span className="ml-2 text-xs text-amber-600">Incomplete</span>}
                          </div>
                          <div className="p-4">
                            {renderFieldGrid(rider, memberFieldsGroup)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Other fields (if any remain) */}
                {allOtherFields.length > 0 && entryRiders.some((r) => otherFields.some((f) => r.responses[f.id] !== undefined)) && (
                  <section className="space-y-4">
                    <div>
                      <h4 className="font-bold">Event details</h4>
                      <p className="text-sm text-muted-foreground">These details can be different for every participant.</p>
                    </div>
                    <div className="space-y-4">
                      {entryRiders.map((rider) => (
                        <div key={rider.key} className="overflow-hidden rounded-xl border bg-secondary/20 shadow-sm">
                          <div className="border-b bg-muted/30 px-4 py-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Member {rider.participantIndex + 1} details</span>
                          </div>
                          <div className="p-4">
                            {renderFieldGrid(rider, allOtherFields)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const usesParticipantWizard = selectedTiers[0]?.entryType !== "team";
  const participantNavigator = () => (
    <nav aria-label="Participants" className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">Participants</span>
        <span className="text-muted-foreground">{completedRiders}/{totalParticipants} complete</span>
      </div>
      <div className="max-h-[50vh] space-y-4 overflow-y-auto overscroll-contain pr-1">
        {entryGroups.map((group, entryIndex) => (
          <div key={group[0].entryKey} className="space-y-1">
            <p className="px-2 text-xs font-medium text-muted-foreground">Entry {entryIndex + 1} · {tierById.get(group[0].ticketId)?.name}</p>
            {group.map((rider) => {
              const index = riders.findIndex((item) => item.key === rider.key);
              const active = index === activeRiderIndex;
              const name = String(rider.responses.full_name ?? "").trim();
              const complete = riderReady(rider);
              return (
                <button key={rider.key} type="button" aria-current={active ? "step" : undefined}
                  onClick={(event) => {
                    setActiveRiderIndex(index);
                    event.currentTarget.closest("details")?.removeAttribute("open");
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg border-l-4 px-3 py-3 text-left text-sm transition-colors ${active ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`}>
                  <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block break-words font-medium ${active ? "text-primary" : ""}`}>{name || "Add participant name"}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{group.length > 1 ? `Player ${rider.participantIndex + 1} · ` : ""}{active ? "Editing" : complete ? "Complete" : "Needs details"}</span>
                  </span>
                  {complete && <CheckCircle2 aria-label="Complete" className="h-4 w-4 shrink-0 text-accent" />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );

  return (
    <Layout>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <button onClick={() => (currentStep > 0 && !registration ? setCurrentStep(currentStep - 1) : navigate(-1))} className="mb-6 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> {currentStep > 0 && !registration ? "Previous step" : "Back to event"}</button>
        <div className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="mb-2 text-sm font-semibold uppercase tracking-wider text-primary">Registration checkout</p><h1 className="text-3xl font-extrabold tracking-tight">Register for this event</h1><p className="mt-2 text-muted-foreground">{event.title} · {event.date}</p></div><p className="text-sm text-muted-foreground">{totalTickets} {totalTickets === 1 ? "entry" : "entries"} selected</p></div>
        <div className="mb-8 flex items-center justify-center gap-2">{(totalPaise === 0 ? steps.slice(0, 2) : steps).map((label, index) => <div key={label} className="flex items-center gap-2"><div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${index <= currentStep ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>{index < currentStep ? <CheckCircle2 className="h-4 w-4" /> : index + 1}</div><span className={`hidden text-sm sm:inline ${index === currentStep ? "font-medium text-foreground" : "text-muted-foreground"}`}>{label}</span>{index < (totalPaise === 0 ? 1 : steps.length - 1) && <div className="h-px w-8 bg-border sm:w-12" />}</div>)}</div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <main className="min-w-0">
            {currentStep === 1 && usesParticipantWizard && <details className="mb-5 rounded-xl border bg-card p-4 lg:hidden">
              <summary className="cursor-pointer text-sm font-semibold">Participant {activeRiderIndex + 1} of {totalParticipants} · Change</summary>
              <div className="mt-4">{participantNavigator()}</div>
            </details>}

            {currentStep === 0 && <section className="space-y-5"><div><h2 className="text-xl font-bold">Review your tickets</h2><p className="mt-1 text-sm text-muted-foreground">We’ll collect the required participant profiles for every entry below.</p></div><div className="space-y-3">{selectedTiers.map((tier) => { const quantity = cart.find((line) => line.ticketId === tier.id)?.quantity ?? 0; return <div key={tier.id} className="flex items-center justify-between rounded-2xl border bg-card p-5 shadow-sm"><div><p className="font-bold">{tier.name} <span className="font-normal text-muted-foreground">× {quantity}</span></p><p className="mt-1 text-sm text-muted-foreground">{tier.description}</p></div><p className="text-lg font-bold text-primary">₹{(tier.price * quantity).toLocaleString("en-IN")}</p></div>; })}</div><div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground"><p className="font-semibold text-foreground">What happens next?</p><p className="mt-1">We’ll collect member details for each entry, then make one payment for the paid entries.</p></div><div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground"><p className="font-semibold text-foreground">Save your registration</p>{!isInitialized ? <p className="mt-1">Checking your account session…</p> : isParticipant ? <p className="mt-1">You are signed in as <span className="font-semibold text-foreground">{user?.email}</span>. This registration will be linked to your participant account so you can easily access your records, tickets, and results.</p> : <div className="mt-3 space-y-3"><p>Create a free participant account to keep your registrations, tickets, and results together. You can also continue as a guest. Guest checkout gives you a private claim code on the confirmation page; save it with your registration reference so you can link this registration to an account later.</p><div className="flex flex-col gap-2 sm:flex-row"><Button type="button" onClick={() => { setRegistrationMode("guest"); setCurrentStep(1); }}>Continue as guest</Button><Button type="button" variant="outline" onClick={() => navigate("/login", { state: { from: checkoutReturnPath } })}>I have an account — sign in</Button><Button type="button" variant="ghost" onClick={() => navigate("/signup?type=participant", { state: { from: checkoutReturnPath } })}>Create participant account</Button></div>{registrationMode === "guest" && <p className="font-medium text-foreground">Guest checkout selected. After registration, your confirmation page will show a private one-time claim code. Save it with your registration reference; use both in your participant dashboard to link this registration later. This is separate from your event ticket QR.</p>}</div>}</div><Button onClick={() => setCurrentStep(1)} disabled={!isInitialized || !effectiveRegistrationMode} size="lg" className="w-full">Start {participantLabel.toLowerCase()} details <ArrowRight className="ml-2 h-4 w-4" /></Button></section>}

            {currentStep === 1 && activeRider && (() => {
              // For team events with team entryType, show simplified team view
              const firstRider = riders[0];
              const firstTier = firstRider ? event?.tiers.find((tier) => tier.id === firstRider.ticketId) : undefined;
              const isTeamEvent = firstTier?.entryType === "team";

              if (isTeamEvent) {
                return (
                  <section className="space-y-5">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                      <div>
                        <h2 className="text-xl font-bold">{participantLabel} details</h2>
                        <p className="mt-1 text-sm text-muted-foreground">Complete all participant details below.</p>
                      </div>
                      <p className="text-sm font-medium text-muted-foreground">{completedRiders} of {totalParticipants} complete</p>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${totalParticipants ? (completedRiders / totalParticipants) * 100 : 0}%` }} />
                    </div>
                    {teamParticipantsView()}
                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                      <Button type="button" variant="outline" onClick={() => setCurrentStep(0)}>
                        <ArrowLeft className="mr-2 h-4 w-4" /> Previous
                      </Button>
                      <Button type="button" onClick={createRegistration} disabled={!participantReady || loading}>
                        {loading ? "Creating registrations…" : totalPaise === 0 ? "Complete free registrations" : "Continue to payment"}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                    {!participantReady && (
                      <p className="text-right text-sm text-muted-foreground">Complete the required {participantLabel.toLowerCase()} fields for every {participantLabel.toLowerCase()} before continuing.</p>
                    )}
                  </section>
                );
              }

              // Original step-by-step wizard for individual events
              return (
                <section className="space-y-5">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                    <div>
                      <h2 className="text-xl font-bold">{participantLabel} details</h2>
                      <p className="mt-1 text-sm text-muted-foreground">Complete one {participantLabel.toLowerCase()} at a time. You can return to any {participantLabel.toLowerCase()} before submitting.</p>
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">{completedRiders} of {totalParticipants} complete</p>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${totalParticipants ? (completedRiders / totalParticipants) * 100 : 0}%` }} />
                  </div>
                  <div className="overflow-hidden rounded-2xl border-2 border-primary/30 bg-card shadow-sm">
                    <div className="flex items-start justify-between gap-4 bg-primary/5 px-5 py-4 sm:px-6">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-primary">{participantLabel} {activeRiderIndex + 1} of {totalParticipants}</p>
                        <h3 className="mt-1 text-xl font-bold">{activeTier?.name}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">{activeTier?.description}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
                        <p className="whitespace-nowrap text-lg font-bold text-primary">₹{activeTier?.price.toLocaleString("en-IN")}</p>
                      </div>
                    </div>
                    <div className="space-y-6 p-5 sm:p-6">
                      {activeIsTeam && activeRider.participantIndex === 0 && teamInfoFields.length > 0 && (
                        <section className="space-y-4">
                          <div>
                            <h4 className="font-bold">Team information</h4>
                            <p className="text-sm text-muted-foreground">Collected once for the whole team.</p>
                          </div>
                          {renderFieldGrid(activeRider, teamInfoFields)}
                        </section>
                      )}
                      <section className="space-y-4">
                        {activeIsTeam && <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Member {activeRider.participantIndex + 1}</div>}
                        <div>
                          <h4 className="font-bold">{activeIsTeam ? "Member details" : "Participant identity"}</h4>
                          <p className="text-sm text-muted-foreground">Use the person who will participate in this event.</p>
                        </div>
                        {renderFieldGrid(activeRider, identityFields)}
                      </section>
                      {activeRider.participantIndex === 0 && contactFields.length > 0 && (
                        <section className="space-y-4 border-t pt-6">
                          <div>
                            <h4 className="font-bold">{activeIsTeam ? "Captain contact" : "Entry contact"}</h4>
                            <p className="text-sm text-muted-foreground">One email or phone number is used for this entire {activeIsTeam ? "team" : "entry"}.</p>
                          </div>
                          {renderFieldGrid(activeRider, contactFields)}
                        </section>
                      )}
                      {otherFields.length > 0 && (
                        <section className="space-y-4 border-t pt-6">
                          <div>
                            <h4 className="font-bold">Event details</h4>
                            <p className="text-sm text-muted-foreground">These details can be different for every participant.</p>
                          </div>
                          {renderFieldGrid(activeRider, otherFields)}
                        </section>
                      )}
                      {emergencyFields.length > 0 && (
                        <section className="space-y-4 border-t pt-6">
                          <div>
                            <h4 className="font-bold">Emergency contact</h4>
                            <p className="text-sm text-muted-foreground">Who should we contact if this {participantLabel.toLowerCase()} needs help?</p>
                          </div>
                          {renderFieldGrid(activeRider, emergencyFields)}
                        </section>
                      )}
                      {addons.length > 0 && (
                        <section className="space-y-4 border-t pt-6">
                          <div>
                            <h4 className="font-bold">Add-ons for this entry</h4>
                            <p className="text-sm text-muted-foreground">Add-ons are optional and saved once for this entry. Leave the quantity at 0 if you do not need one.</p>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            {addons.map((addon) => (
                              <div key={addon.id} className="space-y-2">
                                <Label>
                                  {addon.name}
                                  {addon.required ? " *" : ""}
                                  {addon.price_paise > 0 && <span className="text-muted-foreground">(+₹{(addon.price_paise / 100).toFixed(2)}{addon.type === "quantity" ? " each" : ""})</span>}
                                </Label>
                                {addon.description && <p className="text-xs leading-5 text-muted-foreground">{addon.description}</p>}
                                {addon.type === "quantity" ? (
                                  <Input
                                    type="number"
                                    min={addon.required ? 1 : 0}
                                    max={addon.max_qty ?? undefined}
                                    value={activeRider.selections[addon.id]?.qty ?? 0}
                                    onChange={(e) => updateAddon(activeRider.key, addon, e.target.value)}
                                    placeholder="0"
                                  />
                                ) : (
                                  <Select value={activeRider.selections[addon.id]?.selected ?? ""} onValueChange={(value) => updateAddon(activeRider.key, addon, value)}>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select an option" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {(addon.options ?? []).map((option) => (
                                        <SelectItem key={option} value={option}>
                                          {option}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              </div>
                            ))}
                          </div>
                        </section>
                      )}
                    </div>
                  </div>
                  {activeIsTeam && (() => {
                    const entryMembers = riders.filter((r) => r.entryKey === activeRider.entryKey);
                    const tier = tierById.get(activeRider.ticketId);
                    const min = tier?.teamSizeMin ?? 1;
                    const max = tier?.teamSizeMax ?? entryMembers.length;
                    return (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4">
                        <p className="text-sm text-muted-foreground">{entryMembers.length} member{entryMembers.length !== 1 ? "s" : ""} added (min {min}, max {max})</p>
                        <div className="flex gap-2">
                          {entryMembers.length > min && <Button type="button" variant="outline" size="sm" onClick={() => removeTeamMember(activeRider.key)}>Remove this member</Button>}
                          {entryMembers.length < max && <Button type="button" variant="outline" size="sm" onClick={() => addTeamMember(activeRider.entryKey, activeRider.ticketId)}><Plus className="mr-1 h-4 w-4" /> Add member</Button>}
                        </div>
                      </div>
                    );
                  })()}
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                    <Button type="button" variant="outline" onClick={() => activeRiderIndex > 0 ? setActiveRiderIndex(activeRiderIndex - 1) : setCurrentStep(0)}>
                      <ArrowLeft className="mr-2 h-4 w-4" /> Previous
                    </Button>
                    {activeRiderIndex < totalParticipants - 1 ? (
                      <Button
                        type="button"
                        onClick={() => {
                          if (!riderReady(activeRider)) {
                            toast.error(`Complete the required ${participantLabel.toLowerCase()} fields for this ${participantLabel.toLowerCase()}.`);
                            return;
                          }
                          setActiveRiderIndex(activeRiderIndex + 1);
                        }}
                      >
                        Save {participantLabel.toLowerCase()} & continue
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    ) : (
                      <Button type="button" onClick={createRegistration} disabled={!participantReady || loading}>
                        {loading ? "Creating registrations…" : totalPaise === 0 ? "Complete free registrations" : "Continue to payment"}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {!participantReady && activeRiderIndex === totalParticipants - 1 && (
                    <p className="text-right text-sm text-muted-foreground">Complete the required {participantLabel.toLowerCase()} fields for every {participantLabel.toLowerCase()} before continuing.</p>
                  )}
                </section>
              );
            })()}

            {currentStep === 2 && registration && <section className="space-y-5"><div><h2 className="text-xl font-bold">Pay for all {participantLabel.toLowerCase()}s</h2><p className="mt-1 text-sm text-muted-foreground">One payment covers all paid entries in this order.</p></div><div className="rounded-2xl border bg-card p-5"><p className="text-sm text-muted-foreground">{registration.registrations.length} {registration.registrations.length === 1 ? "entry" : "entries"}</p><p className="mt-2 text-sm font-bold tracking-wide">{registration.registrations.map((child) => child.registrationReference).join(" · ")}</p>{registration.platformFeeBearer === "PARTICIPANT" && (registration.platformFeePaise ?? 0) > 0 && <div className="mt-4 space-y-1 text-sm text-muted-foreground"><div className="flex items-center justify-between"><span>Registration Fee</span><span>{formatPaise(registration.baseAmountPaise ?? 0)}</span></div><div className="flex items-center justify-between"><span>SportPass Fee</span><span>{formatPaise(registration.platformFeePaise ?? 0)}</span></div></div>}<p className="mt-5 text-sm text-muted-foreground">Total amount to pay</p><p className="text-3xl font-extrabold text-primary">₹{totalRupees.toLocaleString("en-IN")}</p></div>{registration.paymentSettings && <div className="space-y-4 rounded-2xl border bg-primary/5 p-5"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">UPI ID</p><p className="font-bold">{registration.paymentSettings.upiId}</p><p className="text-xs text-muted-foreground">Payee: {registration.paymentSettings.payeeName}</p></div><Button variant="outline" size="sm" onClick={copyUpi}><Copy className="mr-2 h-4 w-4" /> Copy</Button></div><p className="text-sm text-muted-foreground">{registration.paymentSettings.instructions}</p><div className="flex flex-col items-center gap-3 rounded-lg bg-white p-3"><img src={registration.paymentSettings.qrDataUrl} alt="Generated UPI payment QR" className="h-56 w-56" /><p className="text-xs text-muted-foreground">Scan to pay ₹{totalRupees.toLocaleString("en-IN")}</p></div>{registration.paymentSettings.qrImageUrl && <div><p className="mb-2 text-xs font-medium text-muted-foreground">Organizer-provided QR</p><img src={registration.paymentSettings.qrImageUrl} alt="Organizer UPI QR" className="mx-auto max-h-56 rounded-lg" /></div>}<div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900/50 dark:bg-blue-950/20"><p className="font-semibold text-blue-900 dark:text-blue-100">Can't scan? Pay from your UPI app directly</p><p className="mt-1 text-blue-800/80 dark:text-blue-100/80">Download the QR image below, then open your UPI app (GPay, PhonePe, Paytm, etc.), choose <span className="font-semibold">Scan QR</span> or <span className="font-semibold">Upload QR</span>, and select the downloaded image to pay ₹{totalRupees.toLocaleString("en-IN")} automatically.</p><Button type="button" variant="outline" size="sm" className="mt-3 gap-2 border-blue-300 bg-white text-blue-900 hover:bg-blue-50 dark:border-blue-800 dark:bg-transparent dark:text-blue-100" onClick={() => void downloadQrAsPng(registration.paymentSettings!.qrDataUrl, `sportpass-payment-qr-${registration.registrations[0]?.registrationReference ?? "order"}.png`).then(() => setQrDownloaded(true)).catch(() => toast.error("Could not download QR image"))}><Download className="h-4 w-4" /> Download QR image</Button>{qrDownloaded && <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-400"><CheckCircle2 className="h-4 w-4 shrink-0" /> QR saved — open your UPI app, tap Scan QR or Upload QR, and pick this image to pay.</p>}</div></div>}<div className="space-y-2"><Label>UTR / transaction reference (optional)</Label><Input value={utrReference} onChange={(e) => setUtrReference(e.target.value)} placeholder="Enter it after paying in your UPI app" /><p className="text-xs text-muted-foreground">One reference will be submitted for the complete {participantLabel.toLowerCase()} group.</p></div><Button onClick={submitUtr} disabled={loading} size="lg" className="w-full">{loading ? "Saving…" : "Submit reference / continue"}</Button><p className="flex items-center justify-center gap-1 text-xs text-muted-foreground"><Shield className="h-3 w-3" /> Do not enter card details on SportPass.</p></section>}
          </main>

          <aside className="min-w-0 lg:col-span-1">
            <div className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Order summary</p>
                <p className="mt-1 text-lg font-bold">{event.title}</p>
                <div className="mt-3 flex items-center justify-between"><span className="text-sm text-muted-foreground">{totalTickets} tickets · Total</span><span className="text-xl font-extrabold text-primary">{formatPaise(participantTotalPreviewPaise)}</span></div>
              </div>
              <details className="border-t pt-3">
                <summary className="cursor-pointer text-sm font-medium">Ticket and pricing details</summary>
                <div className="mt-3 space-y-3">
                  {selectedTiers.map((tier) => {
                    const quantity = cart.find((line) => line.ticketId === tier.id)?.quantity ?? 0;
                    return <div key={tier.id} className="flex items-start justify-between gap-3 text-sm"><span>{tier.name} × {quantity}</span><span className="shrink-0 font-semibold">{formatPaise(tier.price * quantity * 100)}</span></div>;
                  })}
                  {participantBearsFee && sportPassFeePaise > 0 && <>
                    <div className="flex justify-between text-sm text-muted-foreground"><span>Registration Fee</span><span>{formatPaise(totalPaise)}</span></div>
                    <div className="flex justify-between text-sm text-muted-foreground"><span>SportPass Fee</span><span>{formatPaise(sportPassFeePaise)}</span></div>
                  </>}
                </div>
              </details>
              {currentStep === 1 && usesParticipantWizard && <div className="hidden border-t pt-4 lg:block">{participantNavigator()}</div>}
              <p className="border-t pt-4 text-xs text-muted-foreground">Each entry receives one event ticket and check-in QR.</p>
            </div>
          </aside>
        </div>
      </div>
    </Layout>
  );
};

export default Checkout;
