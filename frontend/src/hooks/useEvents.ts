import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import type { EventAddonConfig, EventFieldConfig, SportEvent } from "@/data/mockEvents";

export interface OrganizerVisibility {
  plan: { code: string; name: string; maxConfirmedRegistrations: number | null; pricePaise: number; billingUnit: "per_event" | "per_registration" } | null;
  upgradePlan: { code: string; name: string; maxConfirmedRegistrations: number | null; pricePaise: number; billingUnit: "per_event" | "per_registration" } | null;
  planLimit: number | null;
  effectiveLimit: number | null;
  totalConfirmedQuantity: number;
  visibleConfirmedQuantity: number;
  lockedConfirmedQuantity: number;
  lockedConfirmedRecords: number;
  visibleConfirmedRecords: number;
  visibleCheckedInQuantity: number;
  visibleCheckedInRecords: number;
  visibleApprovedAmountPaise: number;
  graceActive: boolean;
  graceEndsAt: string | null;
  lockedSummary: { message: string; upgradePlan: OrganizerVisibility["upgradePlan"] } | null;
  isLocked: boolean;
}

export interface OrganizerEventOption {
  id: string;
  name: string;
  isArchived: boolean;
}

export interface OrganizerEventTicket {
  id: string;
  name: string;
  description: string;
  pricePaise: number;
  currency: string;
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
  available: number;
}

export interface OrganizerEventCategory {
  id: string;
  name: string;
  distance: string | null;
  description: string | null;
  tickets: OrganizerEventTicket[];
}

export interface OrganizerEvent {
  id: string;
  organizationId: string;
  name: string;
  sport: string;
  description: string;
  eventDate: string;
  location: {
    name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
  };
  bannerUrl: string | null;
  status: string;
  registrationOpen: string | null;
  registrationClose: string | null;
  registrationStatus: "open" | "closed";
  archivedAt: string | null;
  isArchived: boolean;
  participants: number;
  totalParticipants: number;
  lockedParticipants: number;
  visibility: OrganizerVisibility | null;
  maxParticipants: number;
  rules: string[];
  categories: OrganizerEventCategory[];
  fieldConfig: EventFieldConfig;
  addonConfig: EventAddonConfig;
  paymentSettings: {
    method: string;
    upiId: string;
    payeeName: string;
    instructions: string;
    qrImageUrl: string | null;
    qrImageExpiresAt: string | null;
  } | null;
}

export interface OrganizerEventDashboard {
  event: OrganizerEvent;
  inventory: { total: number; sold: number; reserved: number; available: number };
  registrations: {
    total: number;
    awaitingPayment: number;
    pendingVerification: number;
    confirmed: number;
    checkedIn: number;
    rejected: number;
    expired: number;
  };
  payments: {
    pending: number;
    referenceSubmitted: number;
    approved: number;
    notRequired: number;
    rejected: number;
    expired: number;
    approvedAmountPaise: number;
  };
  byTicket: Array<{
    ticketId: string;
    categoryId: string;
    categoryName: string;
    ticketName: string;
    pricePaise: number;
    quantityTotal: number;
    quantitySold: number;
    quantityReserved: number;
    available: number;
    confirmedQuantity: number;
    pendingQuantity: number;
    checkedInQuantity: number;
  }>;
  byCategory: Array<{
    categoryId: string;
    categoryName: string;
    distance: string | null;
    capacity: number;
    registrationCount: number;
    totalQuantity: number;
    confirmedQuantity: number;
    pendingQuantity: number;
    checkedInQuantity: number;
  }>;
  overview: {
    confirmedParticipants: number;
    totalConfirmedParticipants: number;
    lockedConfirmedParticipants: number;
    registrationLimit: number | null;
    visibility: OrganizerVisibility;
    totalRegistrationRecords: number;
    approvedAmountPaise: number;
    ticketsSold: number;
    checkInRate: number;
    signupsToday: number;
    paymentSuccessRate: number;
  };
  signupTrend: Array<{
    date: string;
    registrations: number;
    quantity: number;
    confirmedQuantity: number;
  }>;
  recentRegistrations: Array<{
    id: string;
    registrationReference: string;
    participant: { name: string; email: string | null; phone: string | null };
    ticket: { name: string; category: string | null };
    amountPaise: number;
    status: string;
    paymentStatus: string;
    checkInStatus: string;
    createdAt: string;
  }>;
}


export function useEvents() {
  return useQuery({
    queryKey: ["events"],
    queryFn: () => apiRequest<SportEvent[]>("/events"),
  });
}

export function useEvent(eventId: string | undefined) {
  return useQuery({
    queryKey: ["events", eventId],
    enabled: Boolean(eventId),
    queryFn: () => apiRequest<SportEvent>(`/events/${eventId}`),
  });
}

export function useOrganizerEvents() {
  return useQuery({
    queryKey: ["organizer-events"],
    queryFn: () => apiRequest<OrganizerEvent[]>("/organizer/events"),
  });
}

export function useOrganizerEventOptions() {
  return useQuery({
    queryKey: ["organizer-event-options"],
    staleTime: 30_000,
    queryFn: () => apiRequest<OrganizerEventOption[]>("/organizer/event-options"),
  });
}

export function useOrganizerEventDashboard(eventId: string | undefined) {
  return useQuery({
    queryKey: ["organizer-event-dashboard", eventId],
    enabled: Boolean(eventId),
    queryFn: () => apiRequest<OrganizerEventDashboard>(`/organizer/events/${eventId}/dashboard`),
  });
}
