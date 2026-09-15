import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, ArrowRight, CalendarIcon, Plus, Save, Trash2 } from "lucide-react";
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
import { getSportConfig } from "@/data/sportConfig";
import type { CommunicationEvent } from "@/lib/eventCommunication";
import { cn } from "@/lib/utils";

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
  time: string;
  label: string;
}

interface CategoryForm {
  id: string;
  persisted: boolean;
  name: string;
  distance: string;
  description: string;
  ageMin: number | null;
  ageMax: number | null;
  gender: string | null;
  entryType: "singles" | "doubles" | "team";
  participantsPerEntry: number;
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

const makeFieldEditor = (field: (typeof PREDEFINED_FIELDS)[number], order: number): ParticipantFieldEditor => ({
  ...field,
  predefined: true,
  order,
  optionsText: field.options?.join(", ") ?? "",
});

const defaultFieldEditors = (): ParticipantFieldEditor[] => PREDEFINED_FIELDS.map(makeFieldEditor);
const defaultAddonEditors = (): AddonEditor[] => [];

interface OrganizerEventResponse {
  id: string;
  organizationId: string;
  name: string;
  sport: string;
  description: string;
  eventDate: string;
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
    tickets: Array<{ id: string; name: string; description: string; pricePaise: number; quantityTotal: number; saleStart: string | null; saleEnd: string | null; maxPerUser: number | null }>;
  }>;
  paymentSettings: { upiId: string; payeeName: string; instructions: string } | null;
}

const MAX_IMAGE_BYTES = 2_000_000;

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

const sports = [
  { value: "running", label: "Running" },
  { value: "cycling", label: "Cycling" },
  { value: "badminton", label: "Badminton" },
  { value: "triathlon", label: "Triathlons/Duathlons" },
  { value: "swimming", label: "Swimming (open water/mass swims)" },
  { value: "hiking", label: "Trekking/Hiking events" },
  { value: "obstacle_course", label: "Obstacle course races (Spartan-style, mud runs)" },
  { value: "walkathon", label: "Walkathons/charity walks" },
];

const newTicket = (): TicketForm => ({ id: crypto.randomUUID(), persisted: false, name: "", description: "", price: "", quantity: "", saleStart: null, saleEnd: null, maxPerUser: 1 });
const newCategory = (): CategoryForm => ({ id: crypto.randomUUID(), persisted: false, name: "", distance: "", description: "", ageMin: null, ageMax: null, gender: null, entryType: "singles", participantsPerEntry: 1, tickets: [newTicket()] });

const OrganizerEventCreate = () => {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const queryClient = useQueryClient();
  const [organizationId, setOrganizationId] = useState("");
  const [eventName, setEventName] = useState("");
  const [description, setDescription] = useState("");
  const [sport, setSport] = useState("");
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
  const [registrationOpen, setRegistrationOpen] = useState<string | null>(null);
  const [registrationClose, setRegistrationClose] = useState<string | null>(null);
  const [rules, setRules] = useState<string[]>([]);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [maxParticipants, setMaxParticipants] = useState("1000");
  const [upiId, setUpiId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("Pay the exact amount using UPI, then submit your UTR/reference.");
  const [qrImageFile, setQrImageFile] = useState<File | null>(null);
  const [categories, setCategories] = useState<CategoryForm[]>([newCategory()]);
  const [fieldEditors, setFieldEditors] = useState<ParticipantFieldEditor[]>(defaultFieldEditors);
  const [addonEditors, setAddonEditors] = useState<AddonEditor[]>(defaultAddonEditors);
  const currentSportConfig = getSportConfig(sport);
  const supportsDistance = currentSportConfig.supports_distance;
  const categoryDistances = useMemo(() => categories.map((category) => category.distance.trim()).filter(Boolean), [categories]);
  const hasPaidTickets = categories.some((category) => category.tickets.some((ticket) => Number(ticket.price) > 0));
  const [isLoadingEvent, setIsLoadingEvent] = useState(Boolean(eventId));
  const [isSaving, setIsSaving] = useState(false);
  const [shareEvent, setShareEvent] = useState<CommunicationEvent | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const wizardSteps = [
    { title: "Basics", description: "Event identity and location" },
    { title: "Schedule & rules", description: "What participants should know" },
    { title: "Categories & tickets", description: "Category options and pricing" },
    { title: "Participant form", description: "Information and add-ons" },
    { title: "Payment & review", description: "Payment details and save" },
  ];

  useEffect(() => {
    if (eventId) return;
    apiRequest<Array<{ id: string }>>("/organizer/organizations")
      .then((organizations) => setOrganizationId(organizations[0]?.id ?? ""))
      .catch(() => undefined);
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    setIsLoadingEvent(true);
    apiRequest<OrganizerEventResponse>(`/organizer/events/${eventId}`)
      .then((event) => {
        setOrganizationId(event.organizationId);
        setEventName(event.name);
        setDescription(event.description);
        setSport(event.sport);
        setLocation(event.location.name ?? "");
        setAddress(event.location.address ?? "");
        setCity(event.location.city ?? "");
        setState(event.location.state ?? "");
        setLatitude(event.location.latitude ?? null);
        setLongitude(event.location.longitude ?? null);
        setBannerUrl(event.bannerUrl);
        setWhatsappGroupUrl(event.whatsappGroupUrl ?? "");
        setEventDate(new Date(`${event.eventDate}T00:00:00`));
        setRegistrationOpen(event.registrationOpen);
        setRegistrationClose(event.registrationClose);
        setRules(event.rules);
        setSchedule(event.schedule ?? []);
        const loadedFields = (event.fieldConfig?.fields ?? defaultFieldEditors()).map((field, index) => ({
          ...field,
          order: index + 1,
          optionsText: field.options?.join(", ") ?? "",
        }));
        setFieldEditors(loadedFields);
        setAddonEditors((event.addonConfig?.addons ?? []).map((addon, index) => ({
          ...addon,
          order: index + 1,
          priceRupees: String(addon.price_paise / 100),
          optionsText: addon.options?.join(", ") ?? "",
        })));
        setMaxParticipants(String(event.maxParticipants));
        setUpiId(event.paymentSettings?.upiId ?? "");
        setPayeeName(event.paymentSettings?.payeeName ?? "");
        setPaymentInstructions(event.paymentSettings?.instructions ?? "Pay the exact amount using UPI, then submit your UTR/reference.");
        setCategories(event.categories.map((category) => ({
          id: category.id,
          persisted: true,
          name: category.name,
          distance: category.distance ?? "",
          description: category.description ?? "",
          ageMin: category.ageMin,
          ageMax: category.ageMax,
          gender: category.gender,
          entryType: category.entryType ?? "singles",
          participantsPerEntry: category.participantsPerEntry ?? 1,
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
        })));
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Could not load event");
        navigate("/organizer");
      })
      .finally(() => setIsLoadingEvent(false));
  }, [eventId, navigate]);

  const updateCategory = (id: string, field: "name" | "distance", value: string) => {
    setCategories((current) => current.map((category) => category.id === id ? { ...category, [field]: value } : category));
  };

  const updateEntryType = (id: string, entryType: CategoryForm["entryType"]) => {
    const participantsPerEntry = entryType === "singles" ? 1 : entryType === "doubles" ? 2 : 3;
    setCategories((current) => current.map((category) => category.id === id ? { ...category, entryType, participantsPerEntry } : category));
  };

  const updateTeamSize = (id: string, participantsPerEntry: number) => {
    setCategories((current) => current.map((category) => category.id === id ? { ...category, participantsPerEntry } : category));
  };

  const addCategory = () => setCategories((current) => [...current, newCategory()]);
  const removeCategory = (id: string) => {
    if (categories.length > 1) setCategories((current) => current.filter((category) => category.id !== id));
  };

  const updateTicket = (categoryId: string, ticketId: string, field: "name" | "price" | "quantity", value: string) => {
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

  const updateScheduleItem = (index: number, field: keyof ScheduleItem, value: string) => {
    setSchedule((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  };

  const addScheduleItem = () => setSchedule((current) => [...current, { time: "", label: "" }]);
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

  const addAddon = () => {
    const index = addonEditors.length + 1;
    setAddonEditors((current) => [...current, { id: `addon_${index}`, name: "", price_paise: 0, priceRupees: "0", type: "single_select", required: false, order: index, optionsText: "S, M, L, XL" }]);
  };

  const removeAddon = (id: string) => setAddonEditors((current) => current.filter((addon) => addon.id !== id));

  const participantConfigPayload = (): EventFieldConfig => ({
    fields: fieldEditors.filter((field) => (field.predefined || field.label.trim()) && supportsDistance || field.id !== "category_distance").map((field, index) => ({
      id: field.id,
      label: field.predefined ? field.label : field.label.trim(),
      type: field.type,
      required: field.id === "full_name" ? true : field.required,
      predefined: field.predefined,
      order: index + 1,
      ...(field.type === "select" || field.type === "dropdown" ? { options: field.id === "category_distance" ? categoryDistances : field.optionsText.split(",").map((item) => item.trim()).filter(Boolean) } : {}),
    })),
  });

  const addonConfigPayload = (): EventAddonConfig => ({
    addons: addonEditors.filter((addon) => addon.name.trim()).map((addon, index) => ({
      id: addon.id,
      name: addon.name.trim(),
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
        !organizationId ? "organizer organization" : null,
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
    }
    if (step === 1 && schedule.some((item) => (item.time.trim() && !item.label.trim()) || (!item.time.trim() && item.label.trim()))) {
      toast.error("Complete or remove every schedule item.");
      return false;
    }
    if (step === 2) {
      if (categories.some((category) => !category.name.trim() || (supportsDistance && !category.distance.trim()) || category.tickets.some((ticket) => !ticket.name.trim() || ticket.price.trim() === "" || ticket.quantity.trim() === ""))) {
        toast.error("Complete every category and ticket field.");
        return false;
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
      const addonConfig = addonConfigPayload();
      if (!fieldConfig.fields.some((field) => field.id === "email" && field.required) && !fieldConfig.fields.some((field) => field.id === "phone" && field.required)) {
        toast.error("Make email or phone required.");
        return false;
      }
      if (fieldConfig.fields.some((field) => (field.type === "select" || field.type === "dropdown") && (!field.options || field.options.length === 0))) {
        toast.error("Add at least one option to every select field.");
        return false;
      }
      if (addonConfig.addons.some((addon) => !addon.id.startsWith("addon_") || !Number.isFinite(addon.price_paise) || addon.price_paise < 0 || (addon.type === "single_select" && !addon.options?.length))) {
        toast.error("Complete every add-on with a valid price and options.");
        return false;
      }
    }
    if (step === 4 && hasPaidTickets && (!upiId.trim() || !payeeName.trim())) {
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
      !organizationId ? "organizer organization" : null,
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
    if (hasPaidTickets && (!upiId || !payeeName)) {
      toast.error("Add UPI payment details for paid ticket tiers.");
      return;
    }
    if (categories.some((category) => !category.name.trim() || (supportsDistance && !category.distance.trim()) || category.tickets.some((ticket) => !ticket.name.trim() || ticket.price.trim() === "" || ticket.quantity.trim() === ""))) {
      toast.error("Complete every category and ticket field.");
      return;
    }

    const participantLimit = Number(maxParticipants);
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
    const normalizedSchedule = schedule
      .map((item) => ({ time: item.time.trim(), label: item.label.trim() }))
      .filter((item) => item.time && item.label);

    const fieldConfig = participantConfigPayload();
    const addonConfig = addonConfigPayload();
    if (!fieldConfig.fields.some((field) => field.id === "email" && field.required) && !fieldConfig.fields.some((field) => field.id === "phone" && field.required)) {
      toast.error("Make email or phone required.");
      return;
    }
    if (fieldConfig.fields.some((field) => (field.type === "select" || field.type === "dropdown") && (!field.options || field.options.length === 0))) {
      toast.error("Add at least one option to every select field.");
      return;
    }
    if (addonConfig.addons.some((addon) => !addon.id.startsWith("addon_") || !Number.isFinite(addon.price_paise) || addon.price_paise < 0 || (addon.type === "single_select" && !addon.options?.length))) {
      toast.error("Complete every add-on with a valid price and options.");
      return;
    }

    setIsSaving(true);
    try {
      const eventPayload = {
        name: eventName,
        description,
        sport,
        event_date: eventDate.toISOString().slice(0, 10),
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
      const saved = eventId
        ? await apiRequest<{ id: string }>(`/organizer/events/${eventId}`, {
            method: "PUT",
            body: JSON.stringify(eventPayload),
          })
        : await apiRequest<{ id: string }>("/organizer/events", {
            method: "POST",
            body: JSON.stringify({ organization_id: organizationId, ...eventPayload }),
          });
      const savedEventId = eventId ?? saved.id;
      const communicationEvent: CommunicationEvent = {
        id: savedEventId,
        name: eventName.trim(),
        eventDate: eventDate.toISOString().slice(0, 10),
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

      await Promise.all([
        bannerFile
          ? uploadFile(`/organizer/events/${savedEventId}/banner`, bannerFile)
          : Promise.resolve(),
        hasPaidTickets
          ? apiRequest(`/organizer/events/${savedEventId}/payment-settings`, {
              method: "PUT",
              body: JSON.stringify({ upi_id: upiId, payee_name: payeeName, instructions: paymentInstructions }),
            })
          : Promise.resolve(),
      ]);

      if (qrImageFile) {
        await uploadFile(`/organizer/events/${savedEventId}/payment-settings/qr`, qrImageFile);
      }
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
      toast.error(error instanceof Error ? error.message : "Could not save event");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <OrganizerDashboardLayout eventId={eventId} showNavigation={Boolean(eventId)}>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        {isLoadingEvent ? <p className="py-20 text-center text-muted-foreground">Loading event…</p> : <>
        <div className="mb-8 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/organizer")}><ArrowLeft className="h-4 w-4" /></Button>
          <div><h1 className="text-2xl font-extrabold tracking-tight">{eventId ? "Edit Event" : "Create Event"}</h1><p className="mt-1 text-sm text-muted-foreground">{eventId ? "Update your event details, tickets, and payment information." : "Set up your event, tickets, and manual UPI payment details."}</p></div>
        </div>

        <div className="mb-8 grid gap-2 sm:grid-cols-5">{wizardSteps.map((step, index) => <button key={step.title} type="button" onClick={() => index < currentStep && setCurrentStep(index)} className={cn("rounded-lg border p-3 text-left transition-colors", index === currentStep ? "border-primary bg-primary/5" : index < currentStep ? "border-primary/30 hover:bg-muted" : "border-border bg-muted/30")}><div className="flex items-center gap-2"><span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold", index <= currentStep ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{index + 1}</span><span className="text-sm font-semibold">{step.title}</span></div><p className="mt-1 hidden text-xs text-muted-foreground sm:block">{step.description}</p></button>)}</div>

        <div className="space-y-8">
          {currentStep === 0 && <section className="space-y-5 rounded-xl border bg-card p-6">
            <h2 className="text-lg font-bold">About This Event</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label>Event name *</Label><Input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. Bengaluru Community Sports Day" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Event description *</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tell participants what makes this event special." /></div>
              <div className="space-y-2"><Label>Sport *</Label><Select value={sport} onValueChange={setSport}><SelectTrigger><SelectValue placeholder="Select sport" /></SelectTrigger><SelectContent>{sports.map((sportOption) => <SelectItem key={sportOption.value} value={sportOption.value}>{sportOption.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="sm:col-span-2 border-t pt-4"><h3 className="font-semibold">Location</h3><p className="mt-1 text-sm text-muted-foreground">Tell participants exactly where the event takes place.</p></div>
              <div className="space-y-2 sm:col-span-2"><Label>Venue or location *</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Event venue and city" /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Address</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address (optional)" /></div>
              <div className="space-y-2"><Label>City</Label><Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Bengaluru" /></div>
              <div className="space-y-2"><Label>State</Label><Input value={state} onChange={(e) => setState(e.target.value)} placeholder="Karnataka" /></div>
              {import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() && <div className="space-y-2 sm:col-span-2"><Label>Pin location on Google Maps</Label><LocationPicker latitude={latitude} longitude={longitude} onChange={(coordinates) => { setLatitude(coordinates?.latitude ?? null); setLongitude(coordinates?.longitude ?? null); }} /></div>}
              <div className="space-y-2 sm:col-span-2"><Label>WhatsApp community link (optional)</Label><Input type="url" value={whatsappGroupUrl} onChange={(e) => setWhatsappGroupUrl(e.target.value)} placeholder="https://chat.whatsapp.com/your-invite-link" /><p className="text-xs text-muted-foreground">Confirmed participants can join this event group after their ticket is generated.</p></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="event-banner">Event banner (optional)</Label><Input id="event-banner" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = validateImageFile(event.target.files?.[0], "Event banner"); setBannerFile(file); if (!file) event.currentTarget.value = ""; }} /><p className="text-xs text-muted-foreground">PNG, JPEG, or WebP. Maximum size: {formatFileSize(MAX_IMAGE_BYTES)}.</p>{bannerFile && <p className="text-xs text-muted-foreground">Selected: {bannerFile.name} ({formatFileSize(bannerFile.size)})</p>}{bannerUrl && <img src={bannerUrl} alt="Current event banner" className="h-32 w-full rounded-lg border object-cover" />}</div>
              <div className="space-y-2"><Label>Event date *</Label><Popover><PopoverTrigger asChild><Button variant="outline" className={cn("w-full justify-start text-left font-normal", !eventDate && "text-muted-foreground")}><CalendarIcon className="mr-2 h-4 w-4" />{eventDate ? format(eventDate, "PPP") : "Pick a date"}</Button></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={eventDate} onSelect={setEventDate} disabled={(date) => date < new Date()} initialFocus /></PopoverContent></Popover></div>
            </div>
          </section>}

          {currentStep === 1 && <section className="space-y-5 rounded-xl border bg-card p-6">
            <div className="flex items-center justify-between gap-4"><div><h2 className="text-lg font-bold">Event Schedule</h2><p className="text-sm text-muted-foreground">Add the timings and activities participants should see on the event page.</p></div><Button type="button" variant="outline" size="sm" onClick={addScheduleItem}><Plus className="mr-1 h-4 w-4" /> Add item</Button></div>
            {schedule.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No schedule items added yet. You can publish the schedule later.</p> : <div className="space-y-3">{schedule.map((item, index) => <div key={index} className="grid gap-3 sm:grid-cols-[9rem_1fr_auto]"><div className="space-y-1"><Label className="text-xs">Time</Label><Input type="time" value={item.time} onChange={(event) => updateScheduleItem(index, "time", event.target.value)} /></div><div className="space-y-1"><Label className="text-xs">Activity</Label><Input value={item.label} onChange={(event) => updateScheduleItem(index, "label", event.target.value)} placeholder="Registration and kit pickup" /></div><Button type="button" variant="ghost" size="icon" className="self-end text-destructive" onClick={() => removeScheduleItem(index)} aria-label="Remove schedule item"><Trash2 className="h-4 w-4" /></Button></div>)}</div>}
          </section>}

          {currentStep === 1 && <section className="space-y-5 rounded-xl border bg-card p-6">
            <div><h2 className="text-lg font-bold">Rules & Regulations</h2><p className="text-sm text-muted-foreground">Add one participant rule per line. These will appear on the public event page.</p></div>
            <Textarea value={rules.join("\n")} onChange={(event) => setRules(event.target.value.split("\n"))} placeholder="Participants must check in at the venue.\nFollow organizer instructions and venue guidelines." className="min-h-32" />
          </section>}

          {currentStep === 3 && <section className="space-y-5 rounded-xl border bg-card p-6">
            <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-bold">Participant Information</h2><p className="text-sm text-muted-foreground">Choose the information participants must provide. Full name is always required, and email or phone must be required.</p></div><Button type="button" variant="outline" size="sm" onClick={addCustomField} disabled={fieldEditors.filter((field) => !field.predefined).length >= 5}><Plus className="mr-1 h-4 w-4" /> Custom field</Button></div>
            <div className="space-y-2">{PREDEFINED_FIELDS.filter((definition) => !(!supportsDistance && definition.id === "category_distance")).map((definition) => { const field = fieldEditors.find((item) => item.id === definition.id); return <div key={definition.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3"><input type="checkbox" checked={Boolean(field)} disabled={definition.id === "full_name"} onChange={() => togglePredefinedField(definition)} className="h-4 w-4" /><div className="min-w-48 flex-1"><p className="font-medium">{definition.label}</p><p className="text-xs text-muted-foreground">{definition.type === "select" ? (definition.id === "category_distance" ? `Options from categories: ${categoryDistances.join(", ") || "add distances below"}` : definition.options?.join(", ")) : definition.type}</p></div>{field && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={field.required} disabled={definition.id === "full_name"} onChange={(event) => updateField(definition.id, { required: event.target.checked })} /> Required</label>}</div>; })}</div>
            {fieldEditors.filter((field) => !field.predefined).map((field) => <div key={field.id} className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-[1fr_10rem_auto]"><div className="space-y-1"><Label>Custom field label *</Label><Input value={field.label} onChange={(event) => updateField(field.id, { label: event.target.value })} placeholder="College name" /></div><div className="space-y-1"><Label>Type</Label><Select value={field.type} onValueChange={(value) => updateField(field.id, { type: value as ParticipantFieldType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="text">Text</SelectItem><SelectItem value="number">Number</SelectItem><SelectItem value="dropdown">Dropdown</SelectItem><SelectItem value="yes_no">Yes / No</SelectItem></SelectContent></Select></div><Button type="button" variant="ghost" size="icon" className="self-end text-destructive" onClick={() => removeField(field.id)} aria-label="Remove custom field"><Trash2 className="h-4 w-4" /></Button>{field.type === "dropdown" && <div className="space-y-1 sm:col-span-2"><Label>Options (comma separated) *</Label><Input value={field.optionsText} onChange={(event) => updateField(field.id, { optionsText: event.target.value })} placeholder="Student, Professional" /></div>}<label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={field.required} onChange={(event) => updateField(field.id, { required: event.target.checked })} /> Required</label></div>)}
            <div className="rounded-xl border bg-background p-4 shadow-sm"><div className="mb-4 flex items-start justify-between gap-3"><div><p className="font-semibold">Participant form preview</p><p className="text-xs text-muted-foreground">This is how participants will see this step during registration.</p></div><span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">Preview</span></div><div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2">{participantConfigPayload().fields.map((field) => { const isSelect = field.type === "select" || field.type === "dropdown" || field.type === "yes_no"; const options = field.type === "yes_no" ? ["Yes", "No"] : field.options ?? []; return <div key={field.id} className={`space-y-2 ${field.id === "full_name" || field.id.startsWith("custom_") ? "sm:col-span-2" : ""}`}><Label>{field.label}{field.required ? " *" : ""}</Label>{isSelect ? <Select disabled><SelectTrigger><SelectValue placeholder="Select an option" /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select> : <Input disabled type={field.type === "email" ? "email" : field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} placeholder={field.type === "phone" ? "+91 98765 43210" : field.type === "yes_no" ? "Yes or No" : undefined} />}</div>; })}</div>{addonConfigPayload().addons.length > 0 && <div className="space-y-3 border-t pt-4"><p className="font-semibold">Add-ons</p>{addonConfigPayload().addons.map((addon) => <div key={addon.id} className="space-y-2"><Label>{addon.name}{addon.required ? " *" : ""} {addon.price_paise > 0 && <span className="text-muted-foreground">(+₹{(addon.price_paise / 100).toFixed(2)}{addon.type === "quantity" ? " each" : ""})</span>}</Label>{addon.type === "quantity" ? <Input disabled type="number" min={addon.required ? 1 : 0} max={addon.max_qty ?? undefined} placeholder="0" /> : <Select disabled><SelectTrigger><SelectValue placeholder="Select an option" /></SelectTrigger><SelectContent>{(addon.options ?? []).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select>}</div>)}<div className="flex justify-between border-t pt-3 font-bold"><span>Total</span><span>Ticket price + selected add-ons</span></div></div>}</div></div>
          </section>}

          {currentStep === 3 && <section className="space-y-5 rounded-xl border bg-card p-6">
            <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-bold">Add-ons</h2><p className="text-sm text-muted-foreground">Offer optional or required extras. Prices are added to the selected ticket only when the participant chooses them.</p></div><Button type="button" variant="outline" size="sm" onClick={addAddon}><Plus className="mr-1 h-4 w-4" /> Add-on</Button></div>
            {addonEditors.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No add-ons configured. Participants will pay only the ticket price.</p> : <div className="space-y-4">{addonEditors.map((addon) => <div key={addon.id} className="space-y-3 rounded-lg border p-4"><div className="flex items-center justify-between"><p className="font-semibold">{addon.name || "New add-on"}</p><Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removeAddon(addon.id)} aria-label="Remove add-on"><Trash2 className="h-4 w-4" /></Button></div><div className="grid gap-3 sm:grid-cols-4"><div className="space-y-1 sm:col-span-2"><Label>Name *</Label><Input value={addon.name} onChange={(event) => updateAddon(addon.id, { name: event.target.value })} placeholder="Breakfast pack" /></div><div className="space-y-1"><Label>Price (₹)</Label><Input type="number" min="0" step="0.01" value={addon.priceRupees} onChange={(event) => updateAddon(addon.id, { priceRupees: event.target.value })} /></div><div className="space-y-1"><Label>Type</Label><Select value={addon.type} onValueChange={(value) => updateAddon(addon.id, { type: value as AddonDefinition["type"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single_select">Single select</SelectItem><SelectItem value="quantity">Quantity</SelectItem></SelectContent></Select></div></div><div className="flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={addon.required} onChange={(event) => updateAddon(addon.id, { required: event.target.checked })} /> Required</label>{addon.type === "quantity" && <div className="flex items-center gap-2 text-sm"><Label>Max quantity</Label><Input className="w-24" type="number" min="1" max="100" value={addon.max_qty ?? ""} onChange={(event) => updateAddon(addon.id, { max_qty: event.target.value ? Number(event.target.value) : null })} placeholder="No max" /></div>}</div>{addon.type === "single_select" && <div className="space-y-1"><Label>Options (comma separated) *</Label><Input value={addon.optionsText} onChange={(event) => updateAddon(addon.id, { optionsText: event.target.value })} placeholder="S, M, L, XL" /></div>}</div>)}</div>}
            {addonEditors.length > 0 && <div className="rounded-lg border border-dashed p-4"><p className="mb-3 text-sm font-semibold">Add-on preview</p>{addonConfigPayload().addons.map((addon) => <div key={addon.id} className="flex items-center justify-between border-b py-2 last:border-0"><span>{addon.name}{addon.required ? " *" : ""}</span><span className="font-medium">{addon.type === "quantity" ? `₹${(addon.price_paise / 100).toFixed(2)} each` : addon.options?.join(" / ")}</span></div>)}<div className="mt-3 flex justify-between font-bold"><span>Estimated total</span><span>Ticket price + selected add-ons</span></div></div>}
          </section>}

          {currentStep === 2 && <section className="space-y-5 rounded-xl border bg-card p-6">
            <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Categories and Tickets</h2><p className="text-sm text-muted-foreground">Add one or more categories and ticket options for this event.</p></div><Button variant="outline" size="sm" onClick={addCategory}><Plus className="mr-1 h-4 w-4" /> Category</Button></div>
            {categories.map((category, categoryIndex) => <div key={category.id} className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between"><p className="font-semibold">Category #{categoryIndex + 1}</p>{categories.length > 1 && <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeCategory(category.id)}><Trash2 className="h-4 w-4" /></Button>}</div>
              <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Category name *</Label><Input value={category.name} onChange={(e) => updateCategory(category.id, "name", e.target.value)} placeholder="Open category" /></div>{supportsDistance && <div className="space-y-2"><Label>Distance *</Label><Input value={category.distance} onChange={(e) => updateCategory(category.id, "distance", e.target.value)} placeholder="10 km" /></div>}<div className="space-y-2"><Label>Entry format *</Label><Select value={category.entryType} onValueChange={(value) => updateEntryType(category.id, value as CategoryForm["entryType"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="singles">Singles · 1 participant</SelectItem><SelectItem value="doubles">Doubles · 2 participants</SelectItem><SelectItem value="team">Team</SelectItem></SelectContent></Select></div>{category.entryType === "team" && <div className="space-y-2"><Label>Team size *</Label><Select value={String(category.participantsPerEntry)} onValueChange={(value) => updateTeamSize(category.id, Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[3, 4, 5].map((size) => <SelectItem key={size} value={String(size)}>{size} participants</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">The ticket price and inventory count one complete team.</p></div>}</div>
              {category.tickets.map((ticket, ticketIndex) => <div key={ticket.id} className="space-y-3 rounded-md bg-muted/40 p-4"><div className="flex items-center justify-between"><p className="text-sm font-medium">Ticket #{ticketIndex + 1}</p>{category.tickets.length > 1 && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeTicket(category.id, ticket.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}</div><div className="grid gap-3 sm:grid-cols-3"><div className="space-y-1"><Label className="text-xs">Name *</Label><Input value={ticket.name} onChange={(e) => updateTicket(category.id, ticket.id, "name", e.target.value)} placeholder="Early Bird" /></div><div className="space-y-1"><Label className="text-xs">Price (₹; 0 = free) *</Label><Input type="number" min="0" step="0.01" value={ticket.price} onChange={(e) => updateTicket(category.id, ticket.id, "price", e.target.value)} placeholder="0 for free" /></div><div className="space-y-1"><Label className="text-xs">Places *</Label><Input type="number" min="1" value={ticket.quantity} onChange={(e) => updateTicket(category.id, ticket.id, "quantity", e.target.value)} placeholder="100" /></div></div></div>)}
              <Button variant="outline" size="sm" onClick={() => addTicket(category.id)}><Plus className="mr-1 h-4 w-4" /> Ticket tier</Button>
            </div>)}
          </section>}

          {currentStep === 4 && <section className="space-y-5 rounded-xl border bg-card p-6">
            <div><h2 className="text-lg font-bold">Payment details</h2><p className="text-sm text-muted-foreground">{hasPaidTickets ? "Paid ticket tiers use manual UPI. Participants submit a UTR and you approve payment." : "All ticket tiers are free. Participants can register without payment or UPI details."}</p></div>
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>UPI ID {hasPaidTickets ? "*" : "(optional)"}</Label><Input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="yourname@upi" /></div><div className="space-y-2"><Label>Payee name {hasPaidTickets ? "*" : "(optional)"}</Label><Input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} placeholder="Your club or organization" /></div><div className="space-y-2 sm:col-span-2"><Label>Payment instructions *</Label><Textarea value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} /></div><div className="space-y-2 sm:col-span-2"><Label htmlFor="qr-image">Organizer QR image (optional)</Label><Input id="qr-image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = validateImageFile(event.target.files?.[0], "Organizer QR image"); setQrImageFile(file); if (!file) event.currentTarget.value = ""; }} /><p className="text-xs text-muted-foreground">PNG, JPEG, or WebP. Maximum size: {formatFileSize(MAX_IMAGE_BYTES)}. SportPass also generates a QR from the UPI ID.</p>{qrImageFile && <p className="text-xs text-muted-foreground">Selected: {qrImageFile.name} ({formatFileSize(qrImageFile.size)})</p>}</div></div>
          </section>}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6">
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
