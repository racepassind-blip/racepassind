import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { eachDayOfInterval, format, startOfDay } from "date-fns";
import { ArrowLeft, ArrowRight, Calculator, CalendarIcon, CircleHelp, ClipboardList, Eye, Minus, Plus, Save, ShieldCheck, Shirt, Ticket, Trash2, UserRound, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { EventShareDialog } from "@/components/EventShareDialog";
import { LocationPicker } from "@/components/LocationPicker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, uploadFile } from "@/lib/api";
import type { AddonDefinition, EventAddonConfig, EventFieldConfig, ParticipantFieldConfig, ParticipantFieldType } from "@/data/mockEvents";
import { TeamFieldEditor, DEFAULT_MAIN_REGISTRANT_FIELDS, DEFAULT_PARTICIPANT_FIELDS, type TeamFieldEditorItem } from "@/components/TeamFieldEditor";
import { getSportConfig, sportOptions, normalizeSport } from "@/data/sportConfig";
import type { CommunicationEvent } from "@/lib/eventCommunication";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

interface TicketForm {
  id: string;
  persisted: boolean;
  name: string;
  description: string;
  price: string;
  quantity: string;
  saleStart: string | null;
  saleEnd: string | null;
  maxPerUser: number;
}

interface ScheduleItem {
  date: string;
  time: string;
  label: string;
}

interface CategoryForm {
  id: string;
  persisted: boolean;
  name: string;
  distance: string;       // combined string sent to API, e.g. "5 KM"
  distanceValue: string;  // numeric part, e.g. "5"
  distanceUnit: "KM" | "M"; // unit dropdown
  description: string;
  ageMin: number | null;
  ageMax: number | null;
  gender: string | null;
  entryType: "singles" | "doubles" | "team";
  participantsPerEntry: number;
  teamSizeMin: number | null;
  teamSizeMax: number | null;
  tickets: TicketForm[];
}

interface ParticipantFieldEditor extends ParticipantFieldConfig {
  optionsText: string;
}

interface AddonEditor extends AddonDefinition {
  optionsText: string;
  priceRupees: string;
}

const PREDEFINED_FIELDS: Array<Pick<ParticipantFieldConfig, "id" | "label" | "type" | "required" | "options">> = [
  { id: "full_name", label: "Full name", type: "text", required: true },
  { id: "email", label: "Email", type: "email", required: true },
  { id: "phone", label: "Phone", type: "phone", required: false },
  { id: "date_of_birth", label: "Date of birth", type: "date", required: false },
  { id: "gender", label: "Gender", type: "select", required: false, options: ["Male", "Female", "Other", "Prefer not to say"] },
  { id: "emergency_contact_name", label: "Emergency contact name", type: "text", required: false },
  { id: "emergency_contact_phone", label: "Emergency contact number", type: "phone", required: false },
  { id: "team_name", label: "Team name", type: "text", required: false },
  { id: "jersey_size", label: "Jersey size", type: "select", required: false, options: ["XS", "S", "M", "L", "XL", "XXL"] },
  { id: "blood_group", label: "Blood group", type: "select", required: false, options: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] },
  { id: "college_organization", label: "College / organization name", type: "text", required: false },
  { id: "category_distance", label: "Category / distance", type: "select", required: false, options: [] },
];

const PARTICIPANT_FIELD_GROUPS = [
  {
    title: "Contact",
    description: "How you identify and reach the participant.",
    icon: UserRound,
    ids: ["full_name", "email", "phone"],
  },
  {
    title: "Profile",
    description: "Details used for eligibility, grouping, or merchandise.",
    icon: ClipboardList,
    ids: ["date_of_birth", "gender", "jersey_size", "college_organization"],
  },
  {
    title: "Safety",
    description: "Useful information for event-day support.",
    icon: ShieldCheck,
    ids: ["emergency_contact_name", "emergency_contact_phone", "blood_group"],
  },
  {
    title: "Event-specific",
    description: "Only collect these when your event flow needs them.",
    icon: ClipboardList,
    ids: ["team_name", "category_distance"],
  },
] as const;

const PARTICIPANT_FIELD_HELP: Record<string, string> = {
  full_name: "Shown on the registration, participant list, and ticket.",
  email: "Used for confirmations and ticket communication.",
  phone: "Useful for payment follow-up and event-day updates.",
  date_of_birth: "Use when categories or prizes have age rules.",
  gender: "Use only when categories or results are grouped by gender.",
  emergency_contact_name: "The person organizers should contact in an emergency.",
  emergency_contact_phone: "Emergency contact number for event-day use.",
  team_name: "Usually unnecessary when the selected category already uses team registration.",
  jersey_size: "Collects one size for each participant. It does not add a charge.",
  blood_group: "Optional medical information for event-day support.",
  college_organization: "Useful for institution or corporate events.",
  category_distance: "Usually unnecessary because the participant already selects a category and ticket.",
};

const makeFieldEditor = (field: (typeof PREDEFINED_FIELDS)[number], order: number): ParticipantFieldEditor => ({
  ...field,
  predefined: true,
  order,
  optionsText: field.options?.join(", ") ?? "",
});

const DEFAULT_STANDARD_FIELD_IDS = new Set(["full_name", "email", "phone"]);
const defaultFieldEditors = (): ParticipantFieldEditor[] => PREDEFINED_FIELDS
  .filter((field) => DEFAULT_STANDARD_FIELD_IDS.has(field.id))
  .map(makeFieldEditor);
const defaultAddonEditors = (): AddonEditor[] => [];

interface OrganizerEventResponse {
  id: string;
  organizationId: string;
  name: string;
  sport: string;
  description: string;
  eventDate: string;
  eventEndDate?: string | null;
  registrationOpen: string | null;
  registrationClose: string | null;
  registrationStatus: "open" | "closed";
  location: { name: string | null; address: string | null; city: string | null; state: string | null; country: string | null; latitude: number | null; longitude: number | null };
  bannerUrl: string | null;
  whatsappGroupUrl: string | null;
  maxParticipants: number;
  rules: string[];
  schedule: ScheduleItem[];
  fieldConfig: EventFieldConfig;
  sportConfig?: { tournament_format?: string; ball_type?: string; overs_per_innings?: number; minimum_players?: number; maximum_players?: number };
  addonConfig: EventAddonConfig;
  categories: Array<{
    id: string;
    name: string;
    distance: string | null;
    description: string | null;
    ageMin: number | null;
    ageMax: number | null;
    gender: string | null;
    entryType: "singles" | "doubles" | "team";
    participantsPerEntry: number;
    teamSizeMin: number | null;
    teamSizeMax: number | null;
    tickets: Array<{ id: string; name: string; description: string; pricePaise: number; quantityTotal: number; saleStart: string | null; saleEnd: string | null; maxPerUser: number | null }>;
  }>;
  paymentSettings: { upiId: string; payeeName: string; instructions: string } | null;
  paymentCollectionMethod: "DIRECT_UPI" | "PAYMENT_GATEWAY";
  platformFeeBearer?: "ORGANIZER" | "PARTICIPANT";
  platformFeeBearerLocked?: boolean;
}

interface OrganizerOrganizationOption {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  status: string;
  allowDirectUpi?: boolean;
}

const MAX_IMAGE_BYTES = 2_000_000;

const rupeeFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatPaise(paise: number): string {
  return rupeeFormatter.format(Math.max(0, paise) / 100);
}

function formatFileSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function validateImageFile(file: File | undefined, label: string): File | null {
  if (!file) return null;
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
    toast.error(`${label} must be between 1 byte and ${formatFileSize(MAX_IMAGE_BYTES)}.`);
    return null;
  }
  return file;
}

const sports = sportOptions;

/** Parse a stored distance string like "21.1 KM" or "5 M" back into value + unit. */
function parseDistanceString(raw: string): { value: string; unit: "KM" | "M" } {
  const trimmed = (raw ?? "").trim().toUpperCase();
  // Match optional decimal number followed by optional whitespace then unit
  const match = trimmed.match(/^(\d*\.?\d+)\s*(KM|M)?$/);
  if (match) {
    return { value: match[1], unit: (match[2] === "M" ? "M" : "KM") };
  }
  // Legacy strings like "10 km", "5km", "42.2 KM"
  const legacyMatch = trimmed.match(/^(\d*\.?\d+)\s*(KM|KMS|M|METERS?)?/);
  if (legacyMatch) {
    return { value: legacyMatch[1], unit: (legacyMatch[2] === "M" || legacyMatch[2]?.startsWith("METER") ? "M" : "KM") };
  }
  // Fallback — store the raw value as-is so nothing is lost
  return { value: trimmed, unit: "KM" };
}

const newTicket = (): TicketForm => ({ id: crypto.randomUUID(), persisted: false, name: "", description: "", price: "", quantity: "", saleStart: null, saleEnd: null, maxPerUser: 1 });
const newCategory = (): CategoryForm => ({ id: crypto.randomUUID(), persisted: false, name: "", distance: "", distanceValue: "", distanceUnit: "KM", description: "", ageMin: null, ageMax: null, gender: null, entryType: "singles", participantsPerEntry: 1, teamSizeMin: null, teamSizeMax: null, tickets: [newTicket()] });

const OrganizerEventCreate = () => {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // Prevent double-submission: synchronous guard that fires before React re-renders
  const savingRef = useRef(false);
  // Track the ID of an event created in this session so repeated saves use PUT, not POST
  const createdEventIdRef = useRef<string | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [organizationOptions, setOrganizationOptions] = useState<OrganizerOrganizationOption[]>([]);
  const [organizationsLoading, setOrganizationsLoading] = useState(!eventId);
  const [organizationsError, setOrganizationsError] = useState<string | null>(null);
  const [eventName, setEventName] = useState("");
  const [description, setDescription] = useState("");
  const [sport, setSport] = useState("");
  const [cricketConfig, setCricketConfig] = useState({ tournament_format: "league", ball_type: "tennis", overs_per_innings: "10", minimum_players: "11", maximum_players: "15" });
  const [location, setLocation] = useState("");
  const [whatsappGroupUrl, setWhatsappGroupUrl] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [eventDate, setEventDate] = useState<Date>();
  const [eventEndDate, setEventEndDate] = useState<Date>();
  const [registrationOpen, setRegistrationOpen] = useState<string | null>(null);
  const [registrationClose, setRegistrationClose] = useState<string | null>(null);
  const [rules, setRules] = useState<string[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [maxParticipants, setMaxParticipants] = useState("1000");
  const [upiId, setUpiId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("Pay the exact amount using UPI, then submit your UTR/reference.");
  const [paymentCollectionMethod, setPaymentCollectionMethod] = useState<"DIRECT_UPI" | "PAYMENT_GATEWAY">("DIRECT_UPI");
  const [allowDirectUpi, setAllowDirectUpi] = useState(false);
  const [paymentDestinationStatus, setPaymentDestinationStatus] = useState<"NOT_SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "LEGACY_APPROVED">("NOT_SUBMITTED");
  const [platformFeeBearer, setPlatformFeeBearer] = useState<"ORGANIZER" | "PARTICIPANT">("ORGANIZER");
  // Set once the loaded event already had this bearer persisted; used to lock the
  // control after paid registrations have started (backend enforces this too).
  const [feeBearerLocked, setFeeBearerLocked] = useState(false);
  // Refund policy
  const [refundPolicyEnabled, setRefundPolicyEnabled] = useState(false);
  const [refundPolicyType, setRefundPolicyType] = useState<"full_refund" | "partial_refund" | "organizer_approval" | "no_refund">("full_refund");
  const [refundCutoffAt, setRefundCutoffAt] = useState<string>("");
  const [refundPercentage, setRefundPercentage] = useState<string>("100");
  const [platformFeeRefundable, setPlatformFeeRefundable] = useState(false);
  const [refundPolicyText, setRefundPolicyText] = useState("");
  const [categories, setCategories] = useState<CategoryForm[]>([newCategory()]);
  const [ticketPreviewQuantities, setTicketPreviewQuantities] = useState<Record<string, number>>({});
  const [fieldEditors, setFieldEditors] = useState<ParticipantFieldEditor[]>(defaultFieldEditors);
  const [mainRegistrantFields, setMainRegistrantFields] = useState<TeamFieldEditorItem[]>(() => DEFAULT_MAIN_REGISTRANT_FIELDS.map((f) => ({ ...f })));
  const [teamParticipantFields, setTeamParticipantFields] = useState<TeamFieldEditorItem[]>(() => DEFAULT_PARTICIPANT_FIELDS.map((f) => ({ ...f })));
  const [addonEditors, setAddonEditors] = useState<AddonEditor[]>(defaultAddonEditors);
  const currentSportConfig = getSportConfig(sport);
  const supportsDistance = currentSportConfig.supports_distance;
  // Build combined distance strings for the category_distance registration dropdown
  const categoryDistances = useMemo(
    () => categories
      .map((c) => c.distanceValue.trim() ? `${c.distanceValue.trim()} ${c.distanceUnit}` : "")
      .filter(Boolean),
    [categories],
  );
  const hasPaidTickets = categories.some((category) => category.tickets.some((ticket) => Number(ticket.price) > 0));
  const hasTeamCategory = categories.some((category) => category.entryType === "team");
  const hasMultiParticipantCategory = categories.some((category) => category.entryType !== "singles");
  const visiblePredefinedFields = PREDEFINED_FIELDS.filter((field) => supportsDistance || field.id !== "category_distance");
  const selectedParticipantFieldCount = fieldEditors.filter((field) => supportsDistance || field.id !== "category_distance").length;
  const requiredParticipantFieldCount = fieldEditors.filter((field) => field.required && (supportsDistance || field.id !== "category_distance")).length;
  const hasRequiredParticipantContact = fieldEditors.some((field) => (field.id === "email" || field.id === "phone") && field.required);
  const eventDays = useMemo(() => {
    if (!eventDate) return [];
    const effectiveEnd = eventEndDate && eventEndDate >= eventDate ? eventEndDate : eventDate;
    return eachDayOfInterval({ start: eventDate, end: effectiveEnd }).map((date, index) => ({
      date,
      key: format(date, "yyyy-MM-dd"),
      dayNumber: index + 1,
      label: format(date, "EEEE, d MMMM yyyy"),
    }));
  }, [eventDate, eventEndDate]);
  useEffect(() => {
    if (eventDays.length === 0) return;
    const validDates = new Set(eventDays.map((day) => day.key));
    const firstDate = eventDays[0].key;
    const lastDate = eventDays[eventDays.length - 1].key;
    setSchedule((current) => {
      let changed = false;
      const next = current.map((item) => {
        const storedDate = item.date?.slice(0, 10) || firstDate;
        if (validDates.has(storedDate)) {
          if (storedDate === item.date) return item;
          changed = true;
          return { ...item, date: storedDate };
        }
        changed = true;
        return { ...item, date: storedDate > lastDate ? lastDate : firstDate };
      });
      return changed ? next : current;
    });
  }, [eventDays]);
  const exampleTicketPricePaise = useMemo(() => {
    const prices = categories.flatMap((category) => category.tickets)
      .map((ticket) => Number(ticket.price))
      .filter((price) => Number.isFinite(price) && price >= 0);
    const representativePrice = prices.find((price) => price > 0) ?? prices[0] ?? 0;
    return Math.round(representativePrice * 100);
  }, [categories]);
  const checkoutPreviewTickets = categories.flatMap((category) => category.tickets.map((ticket) => ({ category, ticket })));
  const firstPreviewTicketId = checkoutPreviewTickets[0]?.ticket.id;
  const previewQuantity = (ticketId: string) => ticketPreviewQuantities[ticketId] ?? (ticketId === firstPreviewTicketId ? 1 : 0);
  const selectedPreviewTickets = checkoutPreviewTickets.filter(({ ticket }) => previewQuantity(ticket.id) > 0);
  const previewSubtotalPaise = selectedPreviewTickets.reduce((total, { ticket }) => {
    const pricePaise = Number.isFinite(Number(ticket.price)) ? Math.max(0, Math.round(Number(ticket.price) * 100)) : 0;
    return total + pricePaise * previewQuantity(ticket.id);
  }, 0);
  const [isLoadingEvent, setIsLoadingEvent] = useState(Boolean(eventId));
  const [isSaving, setIsSaving] = useState(false);
  const [shareEvent, setShareEvent] = useState<CommunicationEvent | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const wizardSteps = [
    { title: "Basics", description: "Event identity and location" },
    { title: "Schedule & rules", description: "What participants should know" },
    { title: "Categories & tickets", description: "Category options and pricing" },
    { title: "Registration form", description: "Participant information" },
    { title: "Add-ons", description: "Optional extras and pricing" },
    { title: "Payment & review", description: "Payment details and save" },
  ];

  useEffect(() => {
    if (eventId) return;
    setOrganizationsLoading(true);
    setOrganizationsError(null);
    apiRequest<OrganizerOrganizationOption[]>("/organizer/organizations")
      .then((organizations) => {
        const activeOrganizations = organizations.filter((organization) => organization.status === "active");
        setOrganizationOptions(activeOrganizations);

        // A normal organizer with one organization has no decision to make. Admins
        // and multi-organization users must choose explicitly so a new event is
        // never assigned to whichever organization happened to be returned first.
        if (user?.role !== "admin" && activeOrganizations.length === 1) {
          const organization = activeOrganizations[0];
          setOrganizationId(organization.id);
          setAllowDirectUpi(organization.allowDirectUpi ?? false);
          if (!(organization.allowDirectUpi ?? false)) {
            setPaymentCollectionMethod("PAYMENT_GATEWAY");
          }
        } else {
          setOrganizationId("");
          setAllowDirectUpi(false);
          setPaymentCollectionMethod("PAYMENT_GATEWAY");
        }
      })
      .catch((error) => {
        setOrganizationOptions([]);
        setOrganizationsError(error instanceof Error ? error.message : "Could not load organizers");
      })
      .finally(() => setOrganizationsLoading(false));
  }, [eventId, user?.role]);

  const handleOrganizationChange = (nextOrganizationId: string) => {
    const organization = organizationOptions.find((option) => option.id === nextOrganizationId);
    setOrganizationId(nextOrganizationId);
    setAllowDirectUpi(organization?.allowDirectUpi ?? false);
    setPaymentCollectionMethod(organization?.allowDirectUpi ? "DIRECT_UPI" : "PAYMENT_GATEWAY");
  };

  const selectedOrganization = organizationOptions.find((organization) => organization.id === organizationId);

  useEffect(() => {
    if (!eventId) return;
    setIsLoadingEvent(true);
    apiRequest<OrganizerEventResponse>(`/organizer/events/${eventId}`)
      .then((event) => {
        setOrganizationId(event.organizationId);
        setEventName(event.name);
        setDescription(event.description);
        setSport(normalizeSport(event.sport));
        if (event.sportConfig) {
          setCricketConfig({
            tournament_format: event.sportConfig.tournament_format ?? "league",
            ball_type: event.sportConfig.ball_type ?? "tennis",
            overs_per_innings: String(event.sportConfig.overs_per_innings ?? 10),
            minimum_players: String(event.sportConfig.minimum_players ?? 11),
            maximum_players: String(event.sportConfig.maximum_players ?? 15),
          });
        }
        setLocation(event.location.name ?? "");
        setAddress(event.location.address ?? "");
        setCity(event.location.city ?? "");
        setState(event.location.state ?? "");
        setLatitude(event.location.latitude ?? null);
        setLongitude(event.location.longitude ?? null);
        setBannerUrl(event.bannerUrl);
        setWhatsappGroupUrl(event.whatsappGroupUrl ?? "");
        setEventDate(new Date(`${event.eventDate}T00:00:00`));
        setEventEndDate(event.eventEndDate ? new Date(`${event.eventEndDate}T00:00:00`) : undefined);
        setRegistrationOpen(event.registrationOpen ? event.registrationOpen.slice(0, 16) : null);
        setRegistrationClose(event.registrationClose ? event.registrationClose.slice(0, 16) : null);
        setRules(event.rules);
        setSchedule((event.schedule ?? []).map((item) => ({ ...item, date: item.date?.slice(0, 10) || event.eventDate })));
        const loadedFields = (event.fieldConfig?.fields ?? defaultFieldEditors()).map((field, index) => ({
          ...field,
          order: index + 1,
          optionsText: field.options?.join(", ") ?? "",
        }));
        setFieldEditors(loadedFields);
        // Load team two-section field config if present
        if (event.fieldConfig?.main_registrant_fields?.length) {
          setMainRegistrantFields(event.fieldConfig.main_registrant_fields.map((field, index) => ({
            ...field,
            order: index + 1,
            optionsText: field.options?.join(", ") ?? "",
          })));
        }
        if (event.fieldConfig?.participant_fields?.length) {
          setTeamParticipantFields(event.fieldConfig.participant_fields.map((field, index) => ({
            ...field,
            order: index + 1,
            optionsText: field.options?.join(", ") ?? "",
          })));
        }
        setAddonEditors((event.addonConfig?.addons ?? []).map((addon, index) => ({
          ...addon,
          description: addon.description ?? "",
          order: index + 1,
          priceRupees: String(addon.price_paise / 100),
          optionsText: addon.options?.join(", ") ?? "",
        })));
        setMaxParticipants(String(event.maxParticipants));
        setUpiId(event.paymentSettings?.upiId ?? "");
        setPayeeName(event.paymentSettings?.payeeName ?? "");
        setPaymentInstructions(event.paymentSettings?.instructions ?? "Pay the exact amount using UPI, then submit your UTR/reference.");
        setPaymentCollectionMethod(event.paymentCollectionMethod);
        setPlatformFeeBearer(event.platformFeeBearer ?? "ORGANIZER");
        setFeeBearerLocked(Boolean(event.platformFeeBearerLocked));
        // Refund policy
        setRefundPolicyEnabled(Boolean(event.refundPolicyEnabled));
        if (event.refundPolicyType) setRefundPolicyType(event.refundPolicyType as typeof refundPolicyType);
        setRefundCutoffAt(event.refundCutoffAt ? event.refundCutoffAt.slice(0, 16) : "");
        setRefundPercentage(event.refundPercentage != null ? String(event.refundPercentage) : "100");
        setPlatformFeeRefundable(Boolean(event.platformFeeRefundable));
        setRefundPolicyText(event.refundPolicyText ?? "");
        // Also fetch org to know if Direct UPI is allowed
        apiRequest<{ allowDirectUpi?: boolean }>(`/organizer/organizations/${event.organizationId}`)
          .then((org) => setAllowDirectUpi(org.allowDirectUpi ?? false))
          .catch(() => undefined);
        apiRequest<{ paymentDestinationStatus: typeof paymentDestinationStatus }>(`/organizer/events/${event.id}/payment-settings`)
          .then((settings) => setPaymentDestinationStatus(settings.paymentDestinationStatus))
          .catch(() => undefined);
        setCategories(event.categories.map((category) => {
          const parsed = parseDistanceString(category.distance ?? "");
          return {
            id: category.id,
            persisted: true,
            name: category.name,
            distance: category.distance ?? "",
            distanceValue: parsed.value,
            distanceUnit: parsed.unit,
            description: category.description ?? "",
            ageMin: category.ageMin,
            ageMax: category.ageMax,
            gender: category.gender,
          entryType: category.entryType ?? "singles",
          participantsPerEntry: category.participantsPerEntry ?? 1,
          teamSizeMin: category.teamSizeMin ?? null,
          teamSizeMax: category.teamSizeMax ?? null,
          tickets: category.tickets.map((ticket) => ({
            id: ticket.id,
            persisted: true,
            name: ticket.name,
            description: ticket.description,
            price: String(ticket.pricePaise / 100),
            quantity: String(ticket.quantityTotal),
            saleStart: ticket.saleStart,
            saleEnd: ticket.saleEnd,
            maxPerUser: ticket.maxPerUser ?? 1,
          })),
          };
        }));
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Could not load event");
        navigate("/organizer");
      })
      .finally(() => setIsLoadingEvent(false));
  }, [eventId, navigate]);

  const updateCategory = (id: string, field: "name" | "distanceValue" | "distanceUnit", value: string) => {
    setCategories((current) => current.map((category) => {
      if (category.id !== id) return category;
      const updated = { ...category, [field]: value };
      // Keep the combined `distance` string in sync for the API payload
      if (field === "distanceValue" || field === "distanceUnit") {
        const val = field === "distanceValue" ? value : updated.distanceValue;
        const unit = field === "distanceUnit" ? value : updated.distanceUnit;
        updated.distance = val.trim() ? `${val.trim()} ${unit}` : "";
      }
      return updated;
    }));
  };

  const updateEntryType = (id: string, entryType: CategoryForm["entryType"]) => {
    const participantsPerEntry = entryType === "singles" ? 1 : entryType === "doubles" ? 2 : 3;
    const teamSizeMin = entryType === "team" ? 3 : null;
    const teamSizeMax = entryType === "team" ? 10 : null;
    setCategories((current) => current.map((category) => category.id === id ? { ...category, entryType, participantsPerEntry, teamSizeMin, teamSizeMax } : category));
  };

  const updateTeamSize = (id: string, field: "teamSizeMin" | "teamSizeMax", value: number) => {
    setCategories((current) => current.map((category) => {
      if (category.id !== id) return category;
      const updated = { ...category, [field]: value };
      // Keep participantsPerEntry in sync with teamSizeMin for the API
      if (field === "teamSizeMin") updated.participantsPerEntry = value;
      return updated;
    }));
  };

  const addCategory = () => setCategories((current) => [...current, newCategory()]);
  const removeCategory = (id: string) => {
    if (categories.length > 1) setCategories((current) => current.filter((category) => category.id !== id));
  };

  const updateTicket = (categoryId: string, ticketId: string, field: "name" | "description" | "price" | "quantity", value: string) => {
    setCategories((current) => current.map((category) => category.id !== categoryId ? category : {
      ...category,
      tickets: category.tickets.map((ticket) => ticket.id === ticketId ? { ...ticket, [field]: value } : ticket),
    }));
  };

  const addTicket = (categoryId: string) => {
    setCategories((current) => current.map((category) => category.id === categoryId ? { ...category, tickets: [...category.tickets, newTicket()] } : category));
  };

  const removeTicket = (categoryId: string, ticketId: string) => {
    setCategories((current) => current.map((category) => category.id !== categoryId || category.tickets.length <= 1 ? category : {
      ...category,
      tickets: category.tickets.filter((ticket) => ticket.id !== ticketId),
    }));
  };

  const changeTicketPreviewQuantity = (ticketId: string, delta: number, available: number) => {
    const safeAvailable = Number.isFinite(available) ? Math.max(0, Math.floor(available)) : 0;
    const maximum = Math.min(safeAvailable, 10);
    setTicketPreviewQuantities((current) => {
      const currentQuantity = current[ticketId] ?? (ticketId === firstPreviewTicketId ? 1 : 0);
      return { ...current, [ticketId]: Math.max(0, Math.min(maximum, currentQuantity + delta)) };
    });
  };

  const updateScheduleItem = (index: number, field: keyof ScheduleItem, value: string) => {
    setSchedule((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  };

  const addScheduleItem = (date: string) => {
    if (schedule.length >= 50) return toast.error("You can add up to 50 schedule items.");
    setSchedule((current) => [...current, { date, time: "", label: "" }]);
  };
  const removeScheduleItem = (index: number) => setSchedule((current) => current.filter((_, itemIndex) => itemIndex !== index));

  const updateField = (id: string, patch: Partial<ParticipantFieldEditor>) => {
    setFieldEditors((current) => current.map((field) => field.id === id ? { ...field, ...patch } : field));
  };

  const togglePredefinedField = (field: (typeof PREDEFINED_FIELDS)[number]) => {
    setFieldEditors((current) => {
      if (current.some((item) => item.id === field.id)) {
        return field.id === "full_name" ? current : current.filter((item) => item.id !== field.id);
      }
      return [...current, makeFieldEditor(field, current.length + 1)];
    });
  };

  const addRecommendedParticipantFields = (kind: "essential" | "safety") => {
    const ids = kind === "essential"
      ? new Set(["full_name", "email", "phone"])
      : new Set(["emergency_contact_name", "emergency_contact_phone", "blood_group"]);
    setFieldEditors((current) => {
      const next = [...current];
      PREDEFINED_FIELDS.filter((field) => ids.has(field.id)).forEach((definition) => {
        const existingIndex = next.findIndex((field) => field.id === definition.id);
        if (existingIndex === -1) {
          next.push(makeFieldEditor(definition, next.length + 1));
        }
      });
      return next.map((field) => field.id === "email" ? { ...field, required: true } : field);
    });
    toast.success(kind === "essential" ? "Essential contact fields added." : "Event-day safety fields added.");
  };

  const addCustomField = () => {
    const customCount = fieldEditors.filter((field) => !field.predefined).length;
    if (customCount >= 5) return toast.error("You can add up to five custom fields.");
    const id = `custom_${customCount + 1}`;
    setFieldEditors((current) => [...current, { id, label: "", type: "text", required: false, predefined: false, order: current.length + 1, optionsText: "" }]);
  };

  const removeField = (id: string) => {
    if (id !== "full_name") setFieldEditors((current) => current.filter((field) => field.id !== id));
  };

  const updateAddon = (id: string, patch: Partial<AddonEditor>) => {
    setAddonEditors((current) => current.map((addon) => addon.id === id ? { ...addon, ...patch } : addon));
  };

  const addAddon = (preset: "blank" | "breakfast" | "shirt" = "blank") => {
    setAddonEditors((current) => {
      const order = current.length + 1;
      const base: AddonEditor = {
        id: `addon_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
        name: "",
        description: "",
        price_paise: 0,
        priceRupees: "0",
        type: "single_select",
        required: false,
        order,
        optionsText: "",
      };
      if (preset === "breakfast") {
        return [...current, { ...base, name: "Extra breakfast", description: "Order additional breakfast packs for this registration entry.", type: "quantity", max_qty: 10 }];
      }
      if (preset === "shirt") {
        return [...current, { ...base, name: "Event T-shirt", description: "Choose one T-shirt size for this registration entry.", optionsText: "XS, S, M, L, XL, XXL" }];
      }
      return [...current, base];
    });
  };

  const removeAddon = (id: string) => setAddonEditors((current) => current.filter((addon) => addon.id !== id));

  const requireJerseySizePerParticipant = () => {
    if (hasTeamCategory) {
      setTeamParticipantFields((current) => {
        const existing = current.find((field) => field.id === "jersey_size");
        if (existing) return current.map((field) => field.id === "jersey_size" ? { ...field, required: true } : field);
        const template = DEFAULT_PARTICIPANT_FIELDS.find((field) => field.id === "jersey_size");
        return template ? [...current, { ...template, required: true, order: current.length + 1 }] : current;
      });
    } else {
      setFieldEditors((current) => {
        const existing = current.find((field) => field.id === "jersey_size");
        if (existing) return current.map((field) => field.id === "jersey_size" ? { ...field, required: true } : field);
        const template = PREDEFINED_FIELDS.find((field) => field.id === "jersey_size");
        return template ? [...current, { ...makeFieldEditor(template, current.length + 1), required: true }] : current;
      });
    }
    toast.success("Jersey size will be required for every participant.");
  };

  const mapTeamSection = (fields: TeamFieldEditorItem[]): ParticipantFieldConfig[] =>
    fields
      .filter((field) => field.predefined || field.label.trim())
      .map((field, index) => ({
        id: field.id,
        label: field.predefined ? field.label : field.label.trim(),
        type: field.type,
        required: field.required,
        predefined: field.predefined,
        order: index + 1,
        ...(field.type === "select" || field.type === "dropdown"
          ? { options: field.optionsText.split(",").map((item) => item.trim()).filter(Boolean) }
          : {}),
      }));

  const participantConfigPayload = (): EventFieldConfig => {
    if (hasTeamCategory) {
      return {
        fields: [],
        main_registrant_fields: mapTeamSection(mainRegistrantFields),
        participant_fields: mapTeamSection(teamParticipantFields),
      };
    }
    return {
      fields: fieldEditors.filter((field) => (field.predefined || field.label.trim()) && supportsDistance || field.id !== "category_distance").map((field, index) => ({
        id: field.id,
        label: field.predefined ? field.label : field.label.trim(),
        type: field.type,
        required: field.id === "full_name" ? true : field.required,
        predefined: field.predefined,
        order: index + 1,
        ...(field.type === "select" || field.type === "dropdown" ? { options: field.id === "category_distance" ? categoryDistances : field.optionsText.split(",").map((item) => item.trim()).filter(Boolean) } : {}),
      })),
    };
  };

  const addonConfigPayload = (): EventAddonConfig => ({
    addons: addonEditors.filter((addon) => addon.name.trim()).map((addon, index) => ({
      id: addon.id,
      name: addon.name.trim(),
      description: addon.description?.trim() ?? "",
      price_paise: Math.round(Number(addon.priceRupees || 0) * 100),
      type: addon.type,
      required: addon.required,
      order: index + 1,
      ...(addon.type === "single_select" ? { options: addon.optionsText.split(",").map((item) => item.trim()).filter(Boolean) } : { max_qty: addon.max_qty ?? null }),
    })),
  });

  const validateStep = (step: number): boolean => {
    if (step === 0) {
      const missingFields = [
        !organizationId ? "event organizer" : null,
        !eventName.trim() ? "event name" : null,
        !description.trim() ? "event description" : null,
        !sport ? "sport" : null,
        !location.trim() ? "venue or location" : null,
        !eventDate ? "event date" : null,
      ].filter((field): field is string => Boolean(field));
      if (missingFields.length > 0) {
        toast.error(`Missing: ${missingFields.join(", ")}.`);
        return false;
      }
      if (eventDate && eventEndDate && eventEndDate < eventDate) {
        toast.error("Event end date must be on or after the start date.");
        return false;
      }
    }
    if (step === 1) {
      if (registrationOpen && registrationClose && new Date(registrationClose) <= new Date(registrationOpen)) {
        toast.error("Registration close must be after registration open.");
        return false;
      }
      if (schedule.some((item) => (item.time.trim() && !item.label.trim()) || (!item.time.trim() && item.label.trim()))) {
        toast.error("Complete or remove every schedule item.");
        return false;
      }
    }
    if (step === 2) {
      if (categories.some((category) => !category.name.trim() || (supportsDistance && !category.distanceValue.trim()) || category.tickets.some((ticket) => !ticket.name.trim() || ticket.price.trim() === "" || ticket.quantity.trim() === ""))) {
        toast.error("Complete every category and ticket field.");
        return false;
      }
      // Validate team size range
      for (const category of categories) {
        if (category.entryType === "team") {
          const min = Number(category.teamSizeMin);
          const max = Number(category.teamSizeMax);
          if (!Number.isInteger(min) || min < 2 || min > 50) {
            toast.error(`Team size minimum must be between 2 and 50 for category "${category.name || `#${categories.indexOf(category) + 1}`}".`);
            return false;
          }
          if (!Number.isInteger(max) || max < min || max > 50) {
            toast.error(`Team size maximum must be between ${min} and 50 for category "${category.name || `#${categories.indexOf(category) + 1}`}".`);
            return false;
          }
        }
      }
      const participantLimit = Number(maxParticipants);
      const hasInvalidNumber = !Number.isInteger(participantLimit) || participantLimit < 1 || participantLimit > 1_000_000 || categories.some((category) => category.tickets.some((ticket) => {
        const price = Number(ticket.price);
        const quantity = Number(ticket.quantity);
        return !Number.isFinite(price) || price < 0 || !Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000;
      }));
      if (hasInvalidNumber) {
        toast.error("Use valid participant limits, prices, and ticket quantities.");
        return false;
      }
    }
    if (step === 3) {
      const fieldConfig = participantConfigPayload();
      if (hasTeamCategory) {
        const allTeamFields = [...(fieldConfig.main_registrant_fields ?? []), ...(fieldConfig.participant_fields ?? [])];
        if ((fieldConfig.main_registrant_fields ?? []).some((field) => !field.predefined && !field.label.trim())) {
          toast.error("Give every custom field a label.");
          return false;
        }
        if (allTeamFields.some((field) => (field.type === "select" || field.type === "dropdown") && (!field.options || field.options.length === 0))) {
          toast.error("Add at least one option to every dropdown field.");
          return false;
        }
        return true;
      }
      if (!fieldConfig.fields.some((field) => field.id === "email" && field.required) && !fieldConfig.fields.some((field) => field.id === "phone" && field.required)) {
        toast.error("Make email or phone required.");
        return false;
      }
      if (fieldConfig.fields.some((field) => (field.type === "select" || field.type === "dropdown") && (!field.options || field.options.length === 0))) {
        toast.error("Add at least one option to every select field.");
        return false;
      }
    }
    if (step === 4) {
      const addonConfig = addonConfigPayload();
      if (addonEditors.some((addon) => !addon.name.trim() || addon.priceRupees.trim() === "")) {
        toast.error("Give every add-on a name and price. Use ₹0 only when it is included for free.");
        return false;
      }
      if (addonConfig.addons.some((addon) => !addon.id.startsWith("addon_") || !Number.isFinite(addon.price_paise) || addon.price_paise < 0)) {
        toast.error("Complete every add-on with a valid name and price.");
        return false;
      }
      if (addonConfig.addons.some((addon) => addon.type === "single_select" && (!addon.options || addon.options.length === 0))) {
        toast.error("Add at least one option to every one-choice add-on, such as S / M / L.");
        return false;
      }
    }
    if (step === 5 && hasPaidTickets && paymentCollectionMethod === "DIRECT_UPI" && (!upiId.trim() || !payeeName.trim())) {
      toast.error("Add UPI ID and payee name for paid ticket tiers.");
      return false;
    }
    return true;
  };

  const goToNextStep = () => {
    if (validateStep(currentStep)) setCurrentStep((step) => Math.min(step + 1, wizardSteps.length - 1));
  };

  const saveEvent = async (publish: boolean) => {
    const missingFields = [
      !organizationId ? "event organizer" : null,
      !eventName.trim() ? "event name" : null,
      !description.trim() ? "event description" : null,
      !sport ? "sport" : null,
      !location.trim() ? "venue or location" : null,
      !eventDate ? "event date" : null,
    ].filter((field): field is string => Boolean(field));
    if (missingFields.length > 0) {
      toast.error(`Missing: ${missingFields.join(", ")}.`);
      return;
    }
    if (hasPaidTickets && paymentCollectionMethod === "DIRECT_UPI" && (!upiId || !payeeName)) {
      toast.error("Add UPI payment details for paid ticket tiers.");
      return;
    }
    if (categories.some((category) => !category.name.trim() || (supportsDistance && !category.distanceValue.trim()) || category.tickets.some((ticket) => !ticket.name.trim() || ticket.price.trim() === "" || ticket.quantity.trim() === ""))) {
      toast.error("Complete every category and ticket field.");
      return;
    }

    const participantLimit = Number(maxParticipants);
    const isCricket = currentSportConfig.event_setup === "cricket";
    if (isCricket) {
      const overs = Number(cricketConfig.overs_per_innings);
      const minimum = Number(cricketConfig.minimum_players);
      const maximum = Number(cricketConfig.maximum_players);
      if (!Number.isInteger(overs) || overs <= 0 || !Number.isInteger(minimum) || minimum <= 0 || !Number.isInteger(maximum) || maximum < minimum) {
        toast.error("Enter valid cricket overs and squad size values.");
        return;
      }
    }
    const hasInvalidNumber = !Number.isInteger(participantLimit) || participantLimit < 1 || participantLimit > 1_000_000 || categories.some((category) =>
      category.tickets.some((ticket) => {
        const price = Number(ticket.price);
        const quantity = Number(ticket.quantity);
        return !Number.isFinite(price) || price < 0 || !Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000;
      }),
    );
    if (hasInvalidNumber) {
      toast.error("Use valid participant limits, prices, and ticket quantities.");
      return;
    }

    if (registrationOpen && registrationClose && new Date(registrationClose) <= new Date(registrationOpen)) {
      toast.error("Registration close must be after registration open.");
      return;
    }

    if (schedule.some((item) => (item.time.trim() && !item.label.trim()) || (!item.time.trim() && item.label.trim()))) {
      toast.error("Complete or remove every schedule item.");
      return;
    }

    const normalizedRules = rules.map((rule) => rule.trim()).filter(Boolean);
    const validEventDays = new Set(eventDays.map((day) => day.key));
    const firstEventDay = eventDays[0]?.key ?? format(eventDate, "yyyy-MM-dd");
    const lastEventDay = eventDays[eventDays.length - 1]?.key ?? firstEventDay;
    const normalizedSchedule = schedule
      .map((item) => {
        const storedDate = item.date?.slice(0, 10) || firstEventDay;
        const date = validEventDays.has(storedDate) ? storedDate : storedDate > lastEventDay ? lastEventDay : firstEventDay;
        return { date, time: item.time.trim(), label: item.label.trim() };
      })
      .filter((item) => item.time && item.label)
      .sort((left, right) => left.date.localeCompare(right.date) || left.time.localeCompare(right.time));

    const fieldConfig = participantConfigPayload();
    const addonConfig = addonConfigPayload();
    if (!hasTeamCategory && !fieldConfig.fields.some((field) => field.id === "email" && field.required) && !fieldConfig.fields.some((field) => field.id === "phone" && field.required)) {
      toast.error("Make email or phone required.");
      return;
    }
    if (!hasTeamCategory && fieldConfig.fields.some((field) => (field.type === "select" || field.type === "dropdown") && (!field.options || field.options.length === 0))) {
      toast.error("Add at least one option to every select field.");
      return;
    }
    if (addonConfig.addons.some((addon) => !addon.id.startsWith("addon_") || !Number.isFinite(addon.price_paise) || addon.price_paise < 0)) {
      toast.error("Complete every add-on with a valid name and price.");
      return;
    }

    // Synchronous guard — blocks double-clicks before React re-renders the disabled state
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    try {
      const eventPayload = {
        name: eventName,
        description,
        sport,
        event_date: format(eventDate, "yyyy-MM-dd"),
        event_end_date: eventEndDate && eventEndDate > eventDate ? format(eventEndDate, "yyyy-MM-dd") : null,
        registration_open: registrationOpen,
        registration_close: registrationClose,
        location_name: location,
        city: city || null,
        state: state || null,
        country: "India",
        latitude,
        longitude,
        max_participants: participantLimit,
        rules: normalizedRules,
        schedule: normalizedSchedule,
        field_config: fieldConfig,
        addon_config: addonConfig,
        sport_config: isCricket ? { ...cricketConfig, overs_per_innings: Number(cricketConfig.overs_per_innings), minimum_players: Number(cricketConfig.minimum_players), maximum_players: Number(cricketConfig.maximum_players) } : eventId && sport === "badminton" ? undefined : {},
        payment_collection_method: paymentCollectionMethod,
        platform_fee_bearer: platformFeeBearer,
        refund_policy_enabled: refundPolicyEnabled,
        refund_policy_type: refundPolicyEnabled ? refundPolicyType : null,
        refund_cutoff_at: refundPolicyEnabled && refundCutoffAt ? refundCutoffAt : null,
        refund_percentage: refundPolicyEnabled && refundPolicyType === "partial_refund" ? Number(refundPercentage) || 100 : null,
        platform_fee_refundable: refundPolicyEnabled ? platformFeeRefundable : false,
        refund_policy_text: refundPolicyEnabled && refundPolicyText.trim() ? refundPolicyText.trim() : null,
        address: address || null,
        whatsapp_group_url: whatsappGroupUrl.trim() || null,
        banner_url: null,
        categories: categories.map((category) => ({
          ...(eventId && category.persisted ? { id: category.id } : {}),
          name: category.name,
          distance: supportsDistance ? category.distance.trim() || null : null,
          description: category.description,
          age_min: category.ageMin,
          age_max: category.ageMax,
          gender: category.gender,
          entry_type: category.entryType,
          participants_per_entry: category.participantsPerEntry,
          ...(category.entryType === "team" ? { team_size_min: category.teamSizeMin, team_size_max: category.teamSizeMax } : {}),
          tickets: category.tickets.map((ticket) => ({
            ...(eventId && ticket.persisted ? { id: ticket.id } : {}),
            name: ticket.name,
            description: ticket.description,
            price_rupees: Number(ticket.price),
            quantity: Number(ticket.quantity),
            sale_start: ticket.saleStart,
            sale_end: ticket.saleEnd,
            max_per_user: ticket.maxPerUser,
          })),
        })),
      };
      const effectiveEventId = eventId ?? createdEventIdRef.current;
      const saved = effectiveEventId
        ? await apiRequest<{ id: string }>(`/organizer/events/${effectiveEventId}`, {
            method: "PUT",
            body: JSON.stringify(eventPayload),
          })
        : await apiRequest<{ id: string }>("/organizer/events", {
            method: "POST",
            body: JSON.stringify({ organization_id: organizationId, ...eventPayload }),
          });
      const savedEventId = effectiveEventId ?? saved.id;
      // Remember the created ID so any repeat save in this session uses PUT
      if (!eventId && !createdEventIdRef.current) {
        createdEventIdRef.current = savedEventId;
      }
      const communicationEvent: CommunicationEvent = {
        id: savedEventId,
        name: eventName.trim(),
        eventDate: format(eventDate, "yyyy-MM-dd"),
        eventEndDate: eventEndDate ? format(eventEndDate, "yyyy-MM-dd") : null,
        sport,
        registrationStatus: "open",
        location: { name: location.trim(), address: address || null, city: city || null, state: state || null, country: "India" },
        categories: categories.map((category) => ({
          name: category.name.trim(),
          distance: supportsDistance ? category.distance.trim() || null : null,
          entryType: category.entryType,
          participantsPerEntry: category.participantsPerEntry,
          tickets: category.tickets.map((ticket) => ({ name: ticket.name.trim(), pricePaise: Math.round(Number(ticket.price) * 100) })),
        })),
      };

      const [, paymentResult] = await Promise.all([
        bannerFile
          ? uploadFile(`/organizer/events/${savedEventId}/banner`, bannerFile)
          : Promise.resolve(),
        hasPaidTickets
          ? apiRequest<{ paymentDestinationStatus: typeof paymentDestinationStatus }>(`/organizer/events/${savedEventId}/payment-settings`, {
              method: "PUT",
              body: JSON.stringify({ upi_id: upiId, payee_name: payeeName, instructions: paymentInstructions }),
            })
          : Promise.resolve(),
      ]);
      if (paymentResult) setPaymentDestinationStatus(paymentResult.paymentDestinationStatus);
      if (publish) await apiRequest(`/organizer/events/${savedEventId}/publish`, { method: "POST", body: "{}" });
      await queryClient.invalidateQueries({ queryKey: ["organizer-events"] });
      await queryClient.invalidateQueries({ queryKey: ["events"] });
      if (publish) {
        setShareEvent(communicationEvent);
        setShareDialogOpen(true);
        return;
      }
      toast.success(eventId ? "Event updated successfully." : "Event saved as draft.");
      navigate("/organizer");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save event";
      if (message.includes("Paid Organizer Verification")) {
        toast.error(message, {
          action: { label: "Verify now", onClick: () => navigate("/organizer?tab=organization#paid-verification") },
          duration: 8000,
        });
      } else {
        toast.error(message);
      }
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <OrganizerDashboardLayout eventId={eventId} showNavigation={Boolean(eventId)}>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        {isLoadingEvent ? <p className="py-20 text-center text-muted-foreground">Loading event…</p> : <>
        <div className="mb-6 flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/organizer")} aria-label="Back to organizer dashboard"><ArrowLeft className="h-4 w-4" /></Button>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Step {currentStep + 1} of {wizardSteps.length}</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{eventId ? "Edit event" : "Create an event"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{wizardSteps[currentStep].description}. Your changes are checked before you move to the next step.</p>
          </div>
        </div>

        {!eventId && <div className="mb-6 flex flex-col gap-3 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">What are you selling?</p><p className="mt-1 text-sm text-muted-foreground">Continue here for event tickets and participant registration. Use a product storefront for breakfast, jerseys, or merchandise without tickets.</p></div><Button type="button" variant="outline" className="shrink-0 gap-2" onClick={() => navigate("/organizer/products")}><Shirt className="h-4 w-4" /> Sell products instead</Button></div>}

        <div className="mb-8 overflow-x-auto pb-1">
          <div className="grid min-w-[820px] grid-cols-6 gap-2">{wizardSteps.map((step, index) => <button key={step.title} type="button" onClick={() => index < currentStep && setCurrentStep(index)} disabled={index > currentStep} className={cn("rounded-xl border p-3 text-left transition-colors disabled:cursor-default", index === currentStep ? "border-primary bg-primary/5 shadow-sm" : index < currentStep ? "border-primary/30 bg-card hover:bg-muted" : "border-border bg-muted/30")}><div className="flex items-center gap-2"><span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", index <= currentStep ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{index + 1}</span><span className="text-sm font-semibold">{step.title}</span></div><p className="mt-1 hidden text-xs text-muted-foreground sm:block">{step.description}</p></button>)}</div>
        </div>

        <div className="space-y-8">
          {currentStep === 0 && <section className="space-y-5 rounded-xl border bg-card p-6">
            <h2 className="text-lg font-bold">About This Event</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {!eventId && <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.035] p-4 sm:col-span-2">
                <div>
                  <Label htmlFor="event-organization">Event organizer *</Label>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {user?.role === "admin"
                      ? "Choose the organizer that will own this event. You will remain signed in as a SportPass admin."
                      : "This organization will own the event and receive its registrations."}
                  </p>
                </div>
                {organizationsLoading ? <p className="text-sm text-muted-foreground">Loading organizers…</p> : organizationOptions.length > 0 ? <Select value={organizationId} onValueChange={handleOrganizationChange}>
                  <SelectTrigger id="event-organization" className="bg-background"><SelectValue placeholder="Select an organizer" /></SelectTrigger>
                  <SelectContent>{organizationOptions.map((organization) => {
                    const locationLabel = [organization.city, organization.state].filter(Boolean).join(", ");
                    return <SelectItem key={organization.id} value={organization.id}>{organization.name}{locationLabel ? ` · ${locationLabel}` : ""}</SelectItem>;
                  })}</SelectContent>
                </Select> : <p className="text-sm font-medium text-destructive">{organizationsError ?? "No active organizer is available for this event."}</p>}
                {selectedOrganization && <p className="text-sm font-semibold text-foreground">Creating for: {selectedOrganization.name}</p>}
              </div>}
              <div className="space-y-2 sm:col-span-2"><Label>Event name *</Label><Input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. Bengaluru Community Sports Day" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Event description *</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tell participants what makes this event special." /></div>
              <div className="space-y-2"><Label>Sport *</Label><Select value={sport} onValueChange={setSport}><SelectTrigger><SelectValue placeholder="Select sport" /></SelectTrigger><SelectContent>{sports.map((sportOption) => <SelectItem key={sportOption.value} value={sportOption.value}>{sportOption.label}</SelectItem>)}</SelectContent></Select></div>
              {currentSportConfig.event_setup === "cricket" && <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/[0.035] p-4 sm:col-span-2"><div><h3 className="font-semibold">Cricket Setup</h3><p className="mt-1 text-sm text-muted-foreground">Basic event defaults for this cricket event.</p></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Tournament format</Label><Select value={cricketConfig.tournament_format} onValueChange={(value) => setCricketConfig((current) => ({ ...current, tournament_format: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="league">League</SelectItem><SelectItem value="knockout">Knockout</SelectItem><SelectItem value="league_knockout">League + Knockout</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Ball type</Label><Select value={cricketConfig.ball_type} onValueChange={(value) => setCricketConfig((current) => ({ ...current, ball_type: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="tennis">Tennis Ball</SelectItem><SelectItem value="leather">Leather Ball</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Overs per innings</Label><Input type="number" min={1} step={1} value={cricketConfig.overs_per_innings} onChange={(event) => setCricketConfig((current) => ({ ...current, overs_per_innings: event.target.value }))} /></div><div className="space-y-2 sm:col-span-2"><Label>Default squad size</Label><div className="grid gap-4 sm:grid-cols-2"><Input aria-label="Minimum players" type="number" min={1} value={cricketConfig.minimum_players} onChange={(event) => setCricketConfig((current) => ({ ...current, minimum_players: event.target.value }))} placeholder="Minimum players" /><Input aria-label="Maximum players" type="number" min={1} value={cricketConfig.maximum_players} onChange={(event) => setCricketConfig((current) => ({ ...current, maximum_players: event.target.value }))} placeholder="Maximum players" /></div></div></div></div>}
              <div className="sm:col-span-2 border-t pt-4"><h3 className="font-semibold">Location</h3><p className="mt-1 text-sm text-muted-foreground">Tell participants exactly where the event takes place.</p></div>
              <div className="space-y-2 sm:col-span-2"><Label>Venue or location *</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Event venue and city" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Address</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address (optional)" /></div>
              <div className="space-y-2"><Label>City</Label><Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Bengaluru" /></div>
              <div className="space-y-2"><Label>State</Label><Input value={state} onChange={(e) => setState(e.target.value)} placeholder="Karnataka" /></div>
              {import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() && <div className="space-y-2 sm:col-span-2"><Label>Pin location on Google Maps</Label><LocationPicker latitude={latitude} longitude={longitude} onChange={(coordinates) => { setLatitude(coordinates?.latitude ?? null); setLongitude(coordinates?.longitude ?? null); }} /></div>}
              <div className="space-y-2 sm:col-span-2"><Label>WhatsApp community link (optional)</Label><Input type="url" value={whatsappGroupUrl} onChange={(e) => setWhatsappGroupUrl(e.target.value)} placeholder="https://chat.whatsapp.com/your-invite-link" /><p className="text-xs text-muted-foreground">Confirmed participants can join this event group after their ticket is generated.</p></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="event-banner">Event banner (optional)</Label><Input id="event-banner" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = validateImageFile(event.target.files?.[0], "Event banner"); setBannerFile(file); if (!file) event.currentTarget.value = ""; }} /><p className="text-xs text-muted-foreground">PNG, JPEG, or WebP. Maximum size: {formatFileSize(MAX_IMAGE_BYTES)}.</p>{bannerFile && <p className="text-xs text-muted-foreground">Selected: {bannerFile.name} ({formatFileSize(bannerFile.size)})</p>}{bannerUrl && <img src={bannerUrl} alt="Current event banner" className="h-32 w-full rounded-lg border object-cover" />}</div>
              <div className="space-y-3 sm:col-span-2">
                <div><h3 className="font-semibold">Event dates *</h3><p className="text-sm text-muted-foreground">For a one-day event, choose only the start date. Add an end date when the event runs across multiple days.</p></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Start date *</Label><Popover><PopoverTrigger asChild><Button variant="outline" className={cn("w-full justify-start text-left font-normal", !eventDate && "text-muted-foreground")}><CalendarIcon className="mr-2 h-4 w-4" />{eventDate ? format(eventDate, "PPP") : "Choose start date"}</Button></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={eventDate} onSelect={(date) => { setEventDate(date); if (date && eventEndDate && eventEndDate < date) setEventEndDate(undefined); }} disabled={(date) => date < startOfDay(new Date())} initialFocus /></PopoverContent></Popover></div>
                  <div className="space-y-2"><Label>End date (optional)</Label><Popover><PopoverTrigger asChild><Button variant="outline" disabled={!eventDate} className={cn("w-full justify-start text-left font-normal", !eventEndDate && "text-muted-foreground")}><CalendarIcon className="mr-2 h-4 w-4" />{eventEndDate ? format(eventEndDate, "PPP") : "Same day"}</Button></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={eventEndDate} onSelect={(date) => setEventEndDate(date && eventDate && date > eventDate ? date : undefined)} disabled={(date) => !eventDate || date <= eventDate} initialFocus /></PopoverContent></Popover>{eventEndDate && <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setEventEndDate(undefined)}>Make this a one-day event</Button>}</div>
                </div>
                {eventDays.length > 1 && <p className="rounded-lg bg-primary/5 px-3 py-2 text-sm font-medium text-primary">{eventDays.length}-day event · {format(eventDays[0].date, "d MMM")} to {format(eventDays[eventDays.length - 1].date, "d MMM yyyy")}</p>}
              </div>
            </div>
          </section>}

          {currentStep === 1 && <section className="space-y-5 rounded-xl border bg-card p-6">
            <div><h2 className="text-lg font-bold">Registration window</h2><p className="text-sm text-muted-foreground">Leave either field empty if registrations should open immediately or remain open until you close them.</p></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Registration opens (optional)</Label><Input type="datetime-local" value={registrationOpen ?? ""} onChange={(event) => setRegistrationOpen(event.target.value || null)} /></div>
              <div className="space-y-2"><Label>Registration closes (optional)</Label><Input type="datetime-local" value={registrationClose ?? ""} onChange={(event) => setRegistrationClose(event.target.value || null)} /></div>
            </div>
          </section>}

          {currentStep === 1 && <section className="space-y-5 rounded-xl border bg-card p-6">
            <div><h2 className="text-lg font-bold">Day-by-day schedule</h2><p className="text-sm text-muted-foreground">Add activities under the day when they happen. Participants will see the same day-wise layout on the event page. If you shorten the event date range, activities are moved to the nearest remaining day.</p></div>
            {!eventDate ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Choose the event dates in Step 1 before adding the schedule.</p> : <div className="space-y-4">{eventDays.map((day) => {
              const dayItems = schedule.map((item, index) => ({ item, index })).filter(({ item }) => item.date === day.key);
              return <div key={day.key} className="overflow-hidden rounded-xl border">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3">
                  <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Day {day.dayNumber}</p><p className="font-semibold">{day.label}</p></div>
                  <Button type="button" variant="outline" size="sm" onClick={() => addScheduleItem(day.key)} disabled={schedule.length >= 50}><Plus className="mr-1 h-4 w-4" /> Add activity</Button>
                </div>
                {dayItems.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No activities added for this day.</p> : <div className="space-y-3 p-4">{dayItems.map(({ item, index }) => <div key={`${day.key}-${index}`} className={cn("grid gap-3", eventDays.length > 1 ? "sm:grid-cols-[8rem_10rem_1fr_auto]" : "sm:grid-cols-[9rem_1fr_auto]")}><div className="space-y-1"><Label className="text-xs">Time</Label><Input type="time" value={item.time} onChange={(event) => updateScheduleItem(index, "time", event.target.value)} /></div>{eventDays.length > 1 && <div className="space-y-1"><Label className="text-xs">Event day</Label><Select value={item.date} onValueChange={(value) => updateScheduleItem(index, "date", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{eventDays.map((option) => <SelectItem key={option.key} value={option.key}>Day {option.dayNumber}</SelectItem>)}</SelectContent></Select></div>}<div className="space-y-1"><Label className="text-xs">Activity</Label><Input value={item.label} onChange={(event) => updateScheduleItem(index, "label", event.target.value)} placeholder="Registration and kit pickup" /></div><Button type="button" variant="ghost" size="icon" className="self-end text-destructive" onClick={() => removeScheduleItem(index)} aria-label="Remove schedule item"><Trash2 className="h-4 w-4" /></Button></div>)}</div>}
              </div>;
            })}</div>}
          </section>}

          {currentStep === 1 && <section className="space-y-5 rounded-xl border bg-card p-6">
            <div><h2 className="text-lg font-bold">Rules & Regulations</h2><p className="text-sm text-muted-foreground">Add one participant rule per line. These will appear on the public event page.</p></div>
            <Textarea value={rules.join("\n")} onChange={(event) => setRules(event.target.value.split("\n"))} placeholder="Participants must check in at the venue.\nFollow organizer instructions and venue guidelines." className="min-h-32" />
          </section>}

          {currentStep === 3 && hasTeamCategory && <section className="space-y-5 rounded-xl border bg-card p-6">
            <div><h2 className="text-lg font-bold">Team registration form</h2><p className="text-sm text-muted-foreground">Team info is collected once per team. Per-participant fields are collected for every member. Reorder, edit, or add custom fields to either section.</p></div>
            <TeamFieldEditor
              mainFields={mainRegistrantFields}
              participantFields={teamParticipantFields}
              onMainChange={setMainRegistrantFields}
              onParticipantChange={setTeamParticipantFields}
            />
          </section>}

          {currentStep === 3 && !hasTeamCategory && <section className="space-y-6 rounded-xl border bg-card p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold">What should participants fill in?</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Keep the form short. Select only the information you will use for communication, eligibility, safety, or event operations.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addCustomField} disabled={fieldEditors.filter((field) => !field.predefined).length >= 5}><Plus className="mr-1 h-4 w-4" /> Add your own question</Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/50 p-4">
              <div><p className="font-semibold">{selectedParticipantFieldCount} fields selected</p><p className="text-xs text-muted-foreground">{requiredParticipantFieldCount} required · optional fields may be skipped</p></div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => addRecommendedParticipantFields("essential")}>Add essential contact fields</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => addRecommendedParticipantFields("safety")}>Add safety fields</Button>
              </div>
            </div>

            {!hasRequiredParticipantContact && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><strong>Choose a contact method.</strong> Email or phone must be selected and marked required so you can reach the participant.</div>}

            <div className="space-y-5">{PARTICIPANT_FIELD_GROUPS.map((group) => {
              const GroupIcon = group.icon;
              const definitions = visiblePredefinedFields.filter((definition) => group.ids.some((id) => id === definition.id));
              if (definitions.length === 0) return null;
              return <div key={group.title} className="space-y-2">
                <div className="flex items-start gap-2"><GroupIcon className="mt-0.5 h-4 w-4 text-primary" /><div><h3 className="text-sm font-semibold">{group.title}</h3><p className="text-xs text-muted-foreground">{group.description}</p></div></div>
                <div className="space-y-2">{definitions.map((definition) => {
                  const field = fieldEditors.find((item) => item.id === definition.id);
                  const isSelected = Boolean(field);
                  return <div key={definition.id} className={cn("rounded-lg border p-3 transition-colors", isSelected ? "border-primary/30 bg-primary/[0.025]" : "bg-background")}>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                        <input type="checkbox" checked={isSelected} disabled={definition.id === "full_name"} onChange={() => togglePredefinedField(definition)} className="mt-1 h-4 w-4 shrink-0" />
                        <span><span className="font-medium">{definition.label}</span>{definition.id === "full_name" && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Always collected</span>}<span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{definition.id === "category_distance" ? `Options come from your categories: ${categoryDistances.join(", ") || "add category distances first"}.` : PARTICIPANT_FIELD_HELP[definition.id]}</span></span>
                      </label>
                      {field && (definition.id === "full_name" ? <span className="text-xs font-medium text-muted-foreground">Required</span> : <label className="flex cursor-pointer items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium"><input type="checkbox" checked={field.required} onChange={(event) => updateField(definition.id, { required: event.target.checked })} /> Must answer</label>)}
                    </div>
                  </div>;
                })}</div>
              </div>;
            })}</div>

            {fieldEditors.some((field) => !field.predefined) && <div className="space-y-3 border-t pt-5">
              <div><h3 className="font-semibold">Your questions</h3><p className="text-xs text-muted-foreground">Up to five custom questions. Ask only for information needed to run this event.</p></div>
              {fieldEditors.filter((field) => !field.predefined).map((field) => <div key={field.id} className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-[1fr_12rem_auto]">
                <div className="space-y-1"><Label>Question *</Label><Input value={field.label} onChange={(event) => updateField(field.id, { label: event.target.value })} placeholder="Example: Which club do you represent?" /></div>
                <div className="space-y-1"><Label>Answer format</Label><Select value={field.type} onValueChange={(value) => updateField(field.id, { type: value as ParticipantFieldType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="text">Short text</SelectItem><SelectItem value="number">Number</SelectItem><SelectItem value="dropdown">Choose from a list</SelectItem><SelectItem value="yes_no">Yes or No</SelectItem></SelectContent></Select></div>
                <Button type="button" variant="ghost" size="icon" className="self-end text-destructive" onClick={() => removeField(field.id)} aria-label="Remove custom field"><Trash2 className="h-4 w-4" /></Button>
                {field.type === "dropdown" && <div className="space-y-1 sm:col-span-2"><Label>Choices *</Label><Input value={field.optionsText} onChange={(event) => updateField(field.id, { optionsText: event.target.value })} placeholder="Student, Professional, Other" /><p className="text-xs text-muted-foreground">Separate each choice with a comma.</p></div>}
                <label className="flex cursor-pointer items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={field.required} onChange={(event) => updateField(field.id, { required: event.target.checked })} /> Participant must answer this question</label>
              </div>)}
            </div>}

            <div className="rounded-xl border bg-background p-4 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-3"><div><p className="font-semibold">Participant preview</p><p className="text-xs text-muted-foreground">This is the form participants will see after choosing a ticket.</p></div><span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{participantConfigPayload().fields.length} fields</span></div>
              <div className="grid gap-4 sm:grid-cols-2">{participantConfigPayload().fields.map((field) => { const isSelect = field.type === "select" || field.type === "dropdown" || field.type === "yes_no"; const options = field.type === "yes_no" ? ["Yes", "No"] : field.options ?? []; return <div key={field.id} className={`space-y-2 ${field.id === "full_name" || field.id.startsWith("custom_") ? "sm:col-span-2" : ""}`}><Label>{field.label}{field.required ? " *" : ""}</Label>{isSelect ? <Select disabled><SelectTrigger><SelectValue placeholder="Select an option" /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select> : <Input disabled type={field.type === "email" ? "email" : field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} placeholder={field.type === "phone" ? "+91 98765 43210" : undefined} />}</div>; })}</div>
            </div>
          </section>}

          {currentStep === 4 && <section className="space-y-6 rounded-xl border bg-card p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold">Extras participants can choose</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Add-ons are optional. Each one belongs to a single registration entry and is added to that entry's ticket subtotal.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => addAddon()}><Plus className="mr-1 h-4 w-4" /> Blank add-on</Button>
            </div>

            <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-sm text-blue-950">
              <div className="flex items-start gap-3">
                <CircleHelp className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-semibold">What counts as one add-on?</p>
                  <p className="mt-1 text-blue-900/80">One registration entry means one single entry, one doubles pair, or one team. An add-on is not automatically multiplied by the number of people in that entry.</p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border p-4">
                <div className="flex items-center gap-2 font-semibold"><UtensilsCrossed className="h-4 w-4 text-primary" /> Breakfast included</div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">If every participant gets breakfast with the ticket, write it in the ticket's “What this ticket includes” field. No add-on is needed.</p>
              </div>
              <div className="rounded-xl border p-4">
                <div className="flex items-center gap-2 font-semibold"><Calculator className="h-4 w-4 text-primary" /> Sell extra breakfasts</div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">Use Quantity. Two ₹100 packs add ₹200 to the registration subtotal.</p>
                <Button type="button" variant="link" className="mt-2 h-auto p-0 text-xs" onClick={() => addAddon("breakfast")}>Add breakfast quantity</Button>
              </div>
              <div className="rounded-xl border p-4">
                <div className="flex items-center gap-2 font-semibold"><Shirt className="h-4 w-4 text-primary" /> Collect sizes correctly</div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">Use Jersey size in participant details when every person needs a size. A paid size add-on charges once per entry.</p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={requireJerseySizePerParticipant}>Require participant sizes</Button>
                  <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => addAddon("shirt")}>Sell one T-shirt</Button>
                </div>
              </div>
            </div>

            {hasMultiParticipantCategory && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950"><strong>Your event has doubles or team entries.</strong> One-choice add-ons collect only one shared choice for the pair or team. Use the per-participant Jersey size field when every member needs their own size.</p>}

            {addonEditors.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center">
                <p className="font-medium">No paid extras are configured</p>
                <p className="mt-1 text-sm text-muted-foreground">Participants will pay the ticket price and any applicable SportPass fee.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => addAddon("breakfast")}><UtensilsCrossed className="mr-2 h-4 w-4" /> Extra breakfast</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => addAddon("shirt")}><Shirt className="mr-2 h-4 w-4" /> One T-shirt</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">{addonEditors.map((addon, addonIndex) => {
                const pricePaise = Number.isFinite(Number(addon.priceRupees)) ? Math.max(0, Math.round(Number(addon.priceRupees) * 100)) : 0;
                const exampleQuantity = addon.max_qty === 1 ? 1 : 2;
                const exampleAddonPaise = addon.type === "quantity" ? pricePaise * exampleQuantity : pricePaise;
                const exampleBasePaise = exampleTicketPricePaise || 50000;
                const optionNames = addon.optionsText.split(",").map((item) => item.trim()).filter(Boolean);
                const hasNoOption = pricePaise > 0 && optionNames.some((option) => ["no", "none", "no thanks"].includes(option.toLowerCase()));
                return <div key={addon.id} className="space-y-4 rounded-xl border p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">{addonIndex + 1}</span><p className="truncate font-semibold">{addon.name || "New add-on"}</p></div>
                    <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removeAddon(addon.id)} aria-label="Remove add-on"><Trash2 className="h-4 w-4" /></Button>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1"><Label>Name *</Label><Input value={addon.name} onChange={(event) => updateAddon(addon.id, { name: event.target.value })} placeholder="Extra breakfast" /></div>
                    <div className="space-y-1"><Label>{addon.type === "quantity" ? "Price per item (₹) *" : "Price added once (₹) *"}</Label><Input type="number" min="0" step="0.01" value={addon.priceRupees} onChange={(event) => updateAddon(addon.id, { priceRupees: event.target.value })} /><p className="text-xs text-muted-foreground">Use 0 only when the choice is free.</p></div>
                    <div className="space-y-1 sm:col-span-2">
                      <div className="flex items-center justify-between gap-3"><Label>Note for participants (optional)</Label><span className="text-xs text-muted-foreground">{addon.description?.length ?? 0}/500</span></div>
                      <Textarea value={addon.description ?? ""} onChange={(event) => updateAddon(addon.id, { description: event.target.value })} maxLength={500} className="min-h-[82px]" placeholder="Example: Served after the finish. Vegetarian meal included. Collect using your bib." />
                      <p className="text-xs leading-5 text-muted-foreground">Shown below the add-on name at checkout. Explain what is included, collection details, restrictions, or sizing guidance.</p>
                    </div>
                    <div className="space-y-1 sm:col-span-2"><Label>How should participants choose?</Label><Select value={addon.type} onValueChange={(value) => updateAddon(addon.id, { type: value as AddonDefinition["type"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single_select">One choice · price added once</SelectItem><SelectItem value="quantity">Quantity · price multiplied by units</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">{addon.type === "quantity" ? "Best for extra meals, merchandise, parking passes, or any item where participants may order more than one." : "Best when the participant chooses one option and every option has the same price."}</p></div>
                  </div>

                  {addon.type === "quantity" ? <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1"><Label>Maximum quantity (optional)</Label><Input type="number" min="1" max="100" value={addon.max_qty ?? ""} onChange={(event) => updateAddon(addon.id, { max_qty: event.target.value ? Number(event.target.value) : null })} placeholder="No maximum" /></div>
                    <label className="flex items-center gap-2 self-end rounded-lg border p-3 text-sm"><input type="checkbox" checked={addon.required} onChange={(event) => updateAddon(addon.id, { required: event.target.checked })} /><span><strong>Require at least one</strong><span className="block text-xs text-muted-foreground">The participant cannot continue with quantity 0.</span></span></label>
                  </div> : <div className="space-y-3">
                    <div className="space-y-1"><Label>Choices (comma separated) *</Label><Input value={addon.optionsText} onChange={(event) => updateAddon(addon.id, { optionsText: event.target.value })} placeholder="XS, S, M, L, XL" /><p className="text-xs text-muted-foreground">Every listed choice adds the same price once. Do not add “No” as a paid choice.</p></div>
                    {hasNoOption && <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">“No” would still add {formatPaise(pricePaise)} because every choice has the same price. Remove that option and leave this add-on optional.</p>}
                    <label className="flex items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" checked={addon.required} onChange={(event) => updateAddon(addon.id, { required: event.target.checked })} /><span><strong>Participant must choose an option</strong><span className="block text-xs text-muted-foreground">Required means they must choose; it does not mean the item is included.</span></span></label>
                  </div>}

                  <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-3 text-sm">
                    <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div><p className="font-medium">Calculation example</p><p className="mt-0.5 text-xs text-muted-foreground">{formatPaise(exampleBasePaise)} ticket + {addon.type === "quantity" ? `${exampleQuantity} × ${formatPaise(pricePaise)}` : `${formatPaise(pricePaise)} once`} = <strong className="text-foreground">{formatPaise(exampleBasePaise + exampleAddonPaise)}</strong> registration subtotal.</p></div>
                  </div>
                  {addon.type === "single_select" && <p className="text-xs text-muted-foreground">Need multiple shirts in different sizes? Create one Quantity add-on per size, for example “T-shirt — S” and “T-shirt — M”.</p>}
                </div>;
              })}</div>
            )}

            {addonEditors.length > 0 && <div className="overflow-hidden rounded-2xl border bg-background shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 p-4 sm:p-5"><div><p className="flex items-center gap-2 font-bold"><Eye className="h-4 w-4 text-primary" /> Participant checkout preview</p><p className="mt-1 text-sm text-muted-foreground">This is how your add-ons and notes will appear after participant details.</p></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">Preview only</span></div>
              <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">{addonConfigPayload().addons.map((addon) => <div key={addon.id} className="space-y-3 rounded-xl border bg-card p-4">
                <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{addon.name}{addon.required ? " *" : ""}</p>{addon.description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{addon.description}</p>}</div><span className="shrink-0 text-sm font-bold text-primary">{formatPaise(addon.price_paise)}{addon.type === "quantity" ? " each" : ""}</span></div>
                {addon.type === "quantity" ? <div><Label className="text-xs">Quantity{addon.max_qty ? ` · max ${addon.max_qty}` : ""}</Label><Input disabled value="0" className="mt-1" /></div> : <div><Label className="text-xs">Choose one</Label><Select disabled><SelectTrigger className="mt-1"><SelectValue placeholder={addon.options?.join(" / ") || "Add choices"} /></SelectTrigger><SelectContent /></Select></div>}
              </div>)}</div>
              <p className="border-t bg-muted/20 px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-5">Checkout adds selected extras to the ticket subtotal. Any applicable SportPass fee is calculated separately.</p>
            </div>}
          </section>}

          {currentStep === 2 && <section className="space-y-5 rounded-xl border bg-card p-6">
            <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Categories and Tickets</h2><p className="text-sm text-muted-foreground">Add one or more categories and ticket options for this event.</p></div><Button variant="outline" size="sm" onClick={addCategory}><Plus className="mr-1 h-4 w-4" /> Category</Button></div>
            {categories.map((category, categoryIndex) => <div key={category.id} className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between"><p className="font-semibold">Category #{categoryIndex + 1}</p>{categories.length > 1 && <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeCategory(category.id)}><Trash2 className="h-4 w-4" /></Button>}</div>
              <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Category name *</Label><Input value={category.name} onChange={(e) => updateCategory(category.id, "name", e.target.value)} placeholder="Open category" /></div>{supportsDistance && <div className="space-y-2"><Label>Distance *</Label><div className="flex gap-2"><Input type="number" min="0" step="any" value={category.distanceValue} onChange={(e) => updateCategory(category.id, "distanceValue", e.target.value)} placeholder="e.g. 21.1" className="flex-1" /><Select value={category.distanceUnit} onValueChange={(v) => updateCategory(category.id, "distanceUnit", v)}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="KM"><span className="font-medium">KM</span><span className="ml-2 text-xs text-muted-foreground">Kilometers</span></SelectItem><SelectItem value="M"><span className="font-medium">M</span><span className="ml-2 text-xs text-muted-foreground">Meters</span></SelectItem></SelectContent></Select></div>{category.distanceUnit === "KM" && <p className="text-xs text-muted-foreground">KM = Kilometers (e.g. 5 KM, 21.1 KM, 42.2 KM)</p>}{category.distanceUnit === "M" && <p className="text-xs text-muted-foreground">M = Meters (e.g. 400 M, 800 M)</p>}</div>}<div className="space-y-2"><Label>Entry format *</Label><Select value={category.entryType} onValueChange={(value) => updateEntryType(category.id, value as CategoryForm["entryType"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="singles">Singles · 1 participant</SelectItem><SelectItem value="doubles">Doubles · 2 participants</SelectItem><SelectItem value="team">Team</SelectItem></SelectContent></Select></div>{category.entryType === "team" && <div className="space-y-2 sm:col-span-2"><Label>Team size *</Label><div className="flex items-center gap-3"><div className="flex-1 space-y-1"><p className="text-xs text-muted-foreground">Min participants</p><Input type="number" min={2} max={50} value={category.teamSizeMin ?? ""} onChange={(e) => updateTeamSize(category.id, "teamSizeMin", Number(e.target.value))} placeholder="3" /></div><span className="mt-5 text-sm text-muted-foreground">—</span><div className="flex-1 space-y-1"><p className="text-xs text-muted-foreground">Max participants</p><Input type="number" min={2} max={50} value={category.teamSizeMax ?? ""} onChange={(e) => updateTeamSize(category.id, "teamSizeMax", Number(e.target.value))} placeholder="10" /></div></div><p className="text-xs text-muted-foreground">Ticket price and inventory count per complete team.</p></div>}</div>
              {category.tickets.map((ticket, ticketIndex) => <div key={ticket.id} className="space-y-3 rounded-md bg-muted/40 p-4">
                <div className="flex items-center justify-between"><p className="text-sm font-medium">Ticket #{ticketIndex + 1}</p>{category.tickets.length > 1 && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeTicket(category.id, ticket.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}</div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1"><Label className="text-xs">Name *</Label><Input value={ticket.name} onChange={(e) => updateTicket(category.id, ticket.id, "name", e.target.value)} placeholder="Early Bird" /></div>
                  <div className="space-y-1"><Label className="text-xs">Price (₹; 0 = free) *</Label><Input type="number" min="0" step="0.01" value={ticket.price} onChange={(e) => updateTicket(category.id, ticket.id, "price", e.target.value)} placeholder="0 for free" /></div>
                  <div className="space-y-1"><Label className="text-xs">Places *</Label><Input type="number" min="1" value={ticket.quantity} onChange={(e) => updateTicket(category.id, ticket.id, "quantity", e.target.value)} placeholder="100" /></div>
                  <div className="space-y-1 sm:col-span-3"><Label className="text-xs">What this ticket includes (optional)</Label><Input value={ticket.description} onChange={(e) => updateTicket(category.id, ticket.id, "description", e.target.value)} placeholder="Example: Registration, timing chip, breakfast and finisher medal" /><p className="text-xs text-muted-foreground">Use this for items every participant automatically receives. Do not create a paid add-on for an included item.</p></div>
                </div>
              </div>)}
              <Button variant="outline" size="sm" onClick={() => addTicket(category.id)}><Plus className="mr-1 h-4 w-4" /> Ticket tier</Button>
            </div>)}

            <div className="space-y-4 border-t pt-6">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 font-bold"><Eye className="h-4 w-4 text-primary" /> Participant checkout preview</h3><p className="mt-1 text-sm text-muted-foreground">This updates as you edit categories and tickets. Use + and − to test the participant subtotal.</p></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">Preview only</span></div>
              <div className="overflow-hidden rounded-2xl border bg-background shadow-sm">
                <div className="border-b bg-muted/30 px-4 py-4 sm:px-5"><p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Choose your entry</p><p className="mt-1 font-bold">{eventName || "Your event name"}</p><p className="text-sm text-muted-foreground">Select a ticket and quantity to continue.</p></div>
                <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="space-y-5 p-4 sm:p-5">{categories.map((category, categoryIndex) => <div key={`preview-${category.id}`} className="space-y-3">
                    <div><p className="font-bold">{category.name || `Category ${categoryIndex + 1}`}</p><p className="text-xs text-muted-foreground">{supportsDistance && category.distanceValue.trim() ? `${category.distanceValue} ${category.distanceUnit} · ` : ""}{category.entryType === "singles" ? "1 participant per entry" : category.entryType === "doubles" ? "2 participants per entry" : `${category.teamSizeMin || 2}–${category.teamSizeMax || "?"} participants per team`}</p></div>
                    <div className="space-y-2">{category.tickets.map((ticket) => {
                      const quantity = previewQuantity(ticket.id);
                      const available = Number(ticket.quantity);
                      const pricePaise = Number.isFinite(Number(ticket.price)) ? Math.max(0, Math.round(Number(ticket.price) * 100)) : 0;
                      return <div key={`preview-${ticket.id}`} className={cn("rounded-xl border p-4 transition-colors", quantity > 0 ? "border-primary/40 bg-primary/[0.035]" : "bg-card")}>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{ticket.name || "Ticket name"}</p>{ticket.price.trim() === "0" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">Free</span>}</div><p className="mt-1 text-sm text-muted-foreground">{ticket.description.trim() || "Add what this ticket includes so participants know what they receive."}</p><p className="mt-2 text-xs text-muted-foreground">{Number.isFinite(available) && available > 0 ? `${available.toLocaleString("en-IN")} places available` : "Availability not set"}</p></div>
                          <div className="flex shrink-0 items-center justify-between gap-4 sm:flex-col sm:items-end sm:gap-2"><p className="text-lg font-extrabold text-primary">{ticket.price.trim() === "" ? "Price not set" : formatPaise(pricePaise)}</p><div className="flex items-center rounded-lg border bg-background"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => changeTicketPreviewQuantity(ticket.id, -1, available)} disabled={quantity <= 0} aria-label={`Remove one ${ticket.name || "ticket"}`}><Minus className="h-3.5 w-3.5" /></Button><span className="w-8 text-center text-sm font-bold">{quantity}</span><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => changeTicketPreviewQuantity(ticket.id, 1, available)} disabled={!Number.isFinite(available) || available < 1 || quantity >= Math.min(available, 10)} aria-label={`Add one ${ticket.name || "ticket"}`}><Plus className="h-3.5 w-3.5" /></Button></div></div>
                        </div>
                      </div>;
                    })}</div>
                  </div>)}</div>
                  <aside className="border-t bg-muted/20 p-4 lg:border-l lg:border-t-0 sm:p-5">
                    <div className="lg:sticky lg:top-24"><div className="flex items-center gap-2"><Ticket className="h-4 w-4 text-primary" /><p className="font-bold">Order summary</p></div>
                      {selectedPreviewTickets.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No tickets selected.</p> : <div className="mt-4 space-y-3">{selectedPreviewTickets.map(({ category, ticket }) => { const quantity = previewQuantity(ticket.id); const pricePaise = Number.isFinite(Number(ticket.price)) ? Math.max(0, Math.round(Number(ticket.price) * 100)) : 0; return <div key={`summary-${ticket.id}`} className="flex items-start justify-between gap-3 text-sm"><div><p className="font-medium">{category.name || "Category"} · {ticket.name || "Ticket"}</p><p className="text-xs text-muted-foreground">{quantity} {quantity === 1 ? "entry" : "entries"}</p></div><span className="font-semibold">{formatPaise(pricePaise * quantity)}</span></div>; })}</div>}
                      <div className="mt-4 flex items-center justify-between border-t pt-4"><span className="font-bold">Registration subtotal</span><span className="text-xl font-extrabold text-primary">{formatPaise(previewSubtotalPaise)}</span></div>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">{platformFeeBearer === "PARTICIPANT" ? "The applicable SportPass fee is calculated separately at checkout." : "Participants pay this subtotal before any optional add-ons."}</p>
                      <Button type="button" className="mt-4 w-full" disabled>Continue to participant details</Button>
                    </div>
                  </aside>
                </div>
              </div>
            </div>
          </section>}

          {currentStep === 5 && <section className="space-y-5 rounded-xl border bg-card p-6">
            <div><h2 className="text-lg font-bold">Payment details</h2><p className="text-sm text-muted-foreground">{hasPaidTickets ? "Paid ticket tiers use manual UPI. Participants submit a UTR and you approve payment." : "All ticket tiers are free. Participants can register without payment or UPI details."}</p></div>
            <div className="space-y-3">
              <Label>Payment Collection Method {hasPaidTickets ? "*" : "(optional)"}</Label>
              <div className="space-y-2">
                {allowDirectUpi ? (
                  <div className="flex items-center gap-3 rounded-lg border p-3">
                    <input type="radio" name="paymentCollectionMethod" value="DIRECT_UPI" checked={paymentCollectionMethod === "DIRECT_UPI"} onChange={() => setPaymentCollectionMethod("DIRECT_UPI")} className="h-4 w-4 text-primary focus:ring-primary" />
                    <div>
                      <div className="font-medium">Direct UPI — Available Now</div>
                      <div className="text-xs text-muted-foreground">Use your UPI ID for manual payment collection. Participants submit UTR and you approve payment.</div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-lg border border-dashed p-3 opacity-60 cursor-not-allowed">
                    <input type="radio" name="paymentCollectionMethod" value="DIRECT_UPI" disabled className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="font-medium flex items-center gap-2">Direct UPI <span className="rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">Not enabled</span></div>
                      <div className="text-xs text-muted-foreground">Contact SportPass to request Direct UPI access for your organization.</div>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3 rounded-lg border p-3 opacity-70">
                  <input type="radio" name="paymentCollectionMethod" value="PAYMENT_GATEWAY" checked={paymentCollectionMethod === "PAYMENT_GATEWAY"} onChange={() => setPaymentCollectionMethod("PAYMENT_GATEWAY")} disabled className="h-4 w-4 text-muted-foreground focus:ring-muted-foreground" />
                  <div className="flex-1">
                    <div className="font-medium flex items-center gap-2">
                      <span>Online Payment Gateway</span>
                      <span className="rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">Coming Soon</span>
                    </div>
                    <div className="text-xs text-muted-foreground">Automated payment processing via Payment Gateway. (Available soon)</div>
                  </div>
                </div>
              </div>
            </div>
            {paymentCollectionMethod === "DIRECT_UPI" && <div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2 rounded-lg border bg-muted/30 p-3 text-sm"><span className="font-semibold">Destination status: {paymentDestinationStatus.replaceAll("_", " ")}</span><p className="mt-1 text-xs text-muted-foreground">Changing the UPI ID or payee name sends the new destination for review. Paid registrations remain unavailable until it is approved.</p></div><div className="space-y-2"><Label>UPI ID {hasPaidTickets ? "*" : "(optional)"}</Label><Input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="yourname@upi" /></div><div className="space-y-2"><Label>Payee name {hasPaidTickets ? "*" : "(optional)"}</Label><Input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="Your club or organization" /></div><div className="space-y-2 sm:col-span-2"><Label>Payment instructions *</Label><Textarea value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} /></div></div>}

            {hasPaidTickets && (
              <div className="space-y-3 border-t pt-6">
                <div>
                  <Label>Who pays the SportPass fee?</Label>
                  <p className="text-sm text-muted-foreground">Standard SportPass pricing is 4% of the registration amount, with a ₹20 minimum and ₹60 maximum. Pricing changes apply only to future registrations.</p>
                </div>
                <div className="space-y-2">
                  <label className={`flex items-start gap-3 rounded-lg border p-3 ${feeBearerLocked ? "opacity-70" : "cursor-pointer"}`}>
                    <input type="radio" name="platformFeeBearer" value="ORGANIZER" checked={platformFeeBearer === "ORGANIZER"} onChange={() => setPlatformFeeBearer("ORGANIZER")} disabled={feeBearerLocked} className="mt-1 h-4 w-4 text-primary focus:ring-primary" />
                    <div>
                      <div className="font-medium">Organizer absorbs the fee</div>
                      <div className="text-xs text-muted-foreground">Participants pay only the registration price. Your organization covers the SportPass fee through its Credit settings.</div>
                    </div>
                  </label>
                  <label className={`flex items-start gap-3 rounded-lg border p-3 ${feeBearerLocked ? "opacity-70" : "cursor-pointer"}`}>
                    <input type="radio" name="platformFeeBearer" value="PARTICIPANT" checked={platformFeeBearer === "PARTICIPANT"} onChange={() => setPlatformFeeBearer("PARTICIPANT")} disabled={feeBearerLocked} className="mt-1 h-4 w-4 text-primary focus:ring-primary" />
                    <div>
                      <div className="font-medium">Pass the fee to participants</div>
                      <div className="text-xs text-muted-foreground">The SportPass fee is added to the participant's payable amount at checkout.</div>
                    </div>
                  </label>
                </div>
                {feeBearerLocked && (
                  <p className="text-xs font-medium text-amber-600">SportPass fee responsibility cannot be changed after paid registrations have started.</p>
                )}
              </div>
            )}
          </section>}

          {/* Refund Policy section — final step, always shown so organizer can opt in */}
          {currentStep === 5 && <section className="space-y-5 rounded-xl border bg-card p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold">Refund Policy</h2>
                <p className="text-sm text-muted-foreground">Optionally configure a refund policy for participants. If disabled, no refund option appears publicly.</p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={refundPolicyEnabled}
                  onChange={(e) => setRefundPolicyEnabled(e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                <span className="text-sm font-medium">Enable refund policy</span>
              </label>
            </div>

            {refundPolicyEnabled && <div className="space-y-5 border-t pt-5">
              <div className="space-y-2">
                <Label>Refund policy type *</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([
                    { value: "full_refund", label: "Full refund until a date", desc: "100% refund up to the cutoff date" },
                    { value: "partial_refund", label: "Partial refund until a date", desc: "Set a percentage and cutoff date" },
                    { value: "organizer_approval", label: "Organizer approval required", desc: "Requests reviewed case by case" },
                    { value: "no_refund", label: "No refunds after registration", desc: "No refunds will be issued" },
                  ] as const).map((opt) => (
                    <label key={opt.value} className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${refundPolicyType === opt.value ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}>
                      <input
                        type="radio"
                        name="refundPolicyType"
                        value={opt.value}
                        checked={refundPolicyType === opt.value}
                        onChange={() => setRefundPolicyType(opt.value)}
                        className="mt-0.5 h-4 w-4 text-primary"
                      />
                      <div>
                        <p className="font-medium text-sm">{opt.label}</p>
                        <p className="text-xs text-muted-foreground">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {(refundPolicyType === "full_refund" || refundPolicyType === "partial_refund") && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Refund cutoff date & time *</Label>
                    <input
                      type="datetime-local"
                      value={refundCutoffAt}
                      onChange={(e) => setRefundCutoffAt(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <p className="text-xs text-muted-foreground">Participants cannot request refunds after this date and time.</p>
                  </div>
                  {refundPolicyType === "partial_refund" && (
                    <div className="space-y-2">
                      <Label>Refund percentage *</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={refundPercentage}
                          onChange={(e) => setRefundPercentage(e.target.value)}
                          className="flex h-9 w-24 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <span className="text-sm text-muted-foreground">% of registration fee</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {refundPolicyType !== "no_refund" && (
                <label className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/40">
                  <input
                    type="checkbox"
                    checked={platformFeeRefundable}
                    onChange={(e) => setPlatformFeeRefundable(e.target.checked)}
                    className="h-4 w-4 rounded"
                  />
                  <div>
                    <p className="text-sm font-medium">Refund the SportPass convenience fee</p>
                    <p className="text-xs text-muted-foreground">If unchecked, only the registration fee is refunded. The SportPass fee is non-refundable by default.</p>
                  </div>
                </label>
              )}

              <div className="space-y-2">
                <Label>Refund policy terms (optional)</Label>
                <Textarea
                  value={refundPolicyText}
                  onChange={(e) => setRefundPolicyText(e.target.value)}
                  placeholder="Add any additional terms or conditions for your refund policy..."
                  maxLength={2000}
                  className="min-h-[80px] text-sm"
                />
                <p className="text-xs text-muted-foreground">This text will be shown to participants on the event page.</p>
              </div>
            </div>}
          </section>}

          {currentStep === 5 && <section className="space-y-4 rounded-xl border bg-card p-6">
            <div><h2 className="text-lg font-bold">Review before publishing</h2><p className="text-sm text-muted-foreground">A quick check of the details participants will rely on.</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-muted/50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Event</p><p className="mt-1 font-semibold">{eventName || "Event name missing"}</p><p className="mt-1 text-sm text-muted-foreground">{eventDate ? `${format(eventDate, "PPP")}${eventEndDate ? ` – ${format(eventEndDate, "PPP")}` : ""}` : "Date missing"} · {location || "Venue missing"}</p></div>
              <div className="rounded-lg bg-muted/50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Registration setup</p><p className="mt-1 font-semibold">{categories.length} {categories.length === 1 ? "category" : "categories"} · {categories.reduce((count, category) => count + category.tickets.length, 0)} ticket {categories.reduce((count, category) => count + category.tickets.length, 0) === 1 ? "tier" : "tiers"}</p><p className="mt-1 text-sm text-muted-foreground">{addonEditors.length} {addonEditors.length === 1 ? "add-on" : "add-ons"} · {hasTeamCategory ? "Team fields enabled" : `${participantConfigPayload().fields.length} participant fields`}</p></div>
              <div className="rounded-lg bg-muted/50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment</p><p className="mt-1 font-semibold">{hasPaidTickets ? (paymentCollectionMethod === "DIRECT_UPI" ? "Direct UPI" : "Online payment gateway") : "Free registration"}</p><p className="mt-1 text-sm text-muted-foreground">{hasPaidTickets ? (platformFeeBearer === "PARTICIPANT" ? "Participant pays the SportPass fee" : "Organizer covers the SportPass fee") : "No payment is collected"}</p></div>
              <div className="rounded-lg bg-muted/50 p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Refunds</p><p className="mt-1 font-semibold">{refundPolicyEnabled ? "Policy enabled" : "No public refund option"}</p><p className="mt-1 text-sm text-muted-foreground">{refundPolicyEnabled ? refundPolicyType.replaceAll("_", " ") : "You can configure this before publishing."}</p></div>
            </div>
          </section>}

          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/85">
            <Button variant="outline" size="lg" onClick={() => setCurrentStep((step) => Math.max(0, step - 1))} disabled={currentStep === 0 || isSaving}>Back</Button>
            {currentStep < wizardSteps.length - 1 ? <Button size="lg" onClick={goToNextStep}>Next: {wizardSteps[currentStep + 1].title}<ArrowRight className="ml-2 h-4 w-4" /></Button> : <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" size="lg" onClick={() => saveEvent(false)} disabled={isSaving}><Save className="mr-2 h-4 w-4" /> Save draft</Button><Button size="lg" onClick={() => saveEvent(true)} disabled={isSaving}><Save className="mr-2 h-4 w-4" /> {isSaving ? "Saving..." : "Publish event"}</Button></div>}
          </div>
        </div>
        </>}
        <EventShareDialog
          event={shareEvent}
          open={shareDialogOpen}
          onOpenChange={(open) => {
            setShareDialogOpen(open);
            if (!open) navigate("/organizer");
          }}
        />
      </div>
    </OrganizerDashboardLayout>
  );
};

export default OrganizerEventCreate;
