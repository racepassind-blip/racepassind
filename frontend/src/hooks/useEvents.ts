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
  entryType: "singles" | "doubles" | "team";
  participantsPerEntry: number;
  teamSizeMin?: number | null;
  teamSizeMax?: number | null;
  tickets: OrganizerEventTicket[];
}

export interface OrganizerTournamentRound {
  id: string;
  eventId: string;
  categoryId: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizerCourt {
  id: string;
  eventId: string;
  name: string;
  createdAt: string;
}

export interface OrganizerMatchMember {
  regParticipantId: string;
  name: string;
}

export interface OrganizerMatchEntry {
  registrationId: string;
  registrationReference: string | null;
  participantName: string;
  participantNames?: string[];
  members?: OrganizerMatchMember[];
  participantCount?: number;
  teamName: string | null;
  displayName: string;
  ticketName: string;
  categoryId: string | null;
}

export interface MatchBout {
  id: string;
  matchId: string;
  eventId: string;
  courtId: string | null;
  court: { id: string; name: string } | null;
  playerARegParticipantId: string | null;
  playerBRegParticipantId: string | null;
  playerAName: string | null;
  playerBName: string | null;
  status: "scheduled" | "in_progress" | "completed";
  winner: "player_a" | "player_b" | "draw" | null;
  scoreA: number | null;
  scoreB: number | null;
  scheduledTime: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizerMatchPlayer {
  regParticipantId: string;
  name: string;
}

export interface OrganizerMatch {
  id: string;
  eventId: string;
  category: { id: string; name: string; entryType?: "singles" | "doubles" | "team" };
  entryA: OrganizerMatchEntry;
  entryB: OrganizerMatchEntry;
  matchType?: "singles" | "doubles" | null;
  playersA?: OrganizerMatchPlayer[] | null;
  playersB?: OrganizerMatchPlayer[] | null;
  court: { id: string; name: string };
  roundId: string | null;
  round: { id: string; name: string; position: number } | null;
  roundLabel: string;
  scheduledTime: string | null;
  status: "scheduled" | "in_progress" | "completed";
  winner: "entry_a" | "entry_b" | null;
  winnerBy?: "bouts" | "manual" | null;
  createdAt: string;
  updatedAt: string;
  gamesToWin: number;
  pointsPerGame: number;
  games: Array<{ gameNumber: number; scoreA: number; scoreB: number }>;
  bouts?: MatchBout[];
}

export interface TeamStanding {
  registrationId: string;
  teamName: string;
  captainName: string;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
}

export interface PublicMatchResult {
  id: string;
  category: { id: string; name: string };
  roundId?: string | null;
  round?: { id: string; name: string; position: number } | null;
  roundLabel: string;
  court: { name: string };
  scheduledTime: string | null;
  status: "scheduled" | "in_progress" | "completed";
  winner: "entry_a" | "entry_b" | null;
  entryA: { displayName: string };
  entryB: { displayName: string };
  gamesToWin: number;
  pointsPerGame: number;
  games: Array<{ gameNumber: number; scoreA: number; scoreB: number }>;
}

export interface PublicEventResults {
  event: { id: string; title: string; date: string; category: string };
  categories: Array<{ id: string; name: string; distance: string | null; entryType?: "singles" | "doubles" | "team" }>;
  matches: PublicMatchResult[];
}

export interface OrganizerScoringConfig {
  categoryId: string;
  categoryName: string;
  gamesToWin: number;
  pointsPerGame: number;
}

export interface OrganizerScoringConfigResponse {
  categories: OrganizerScoringConfig[];
}

export interface OrganizerEvent {
  id: string;
  organizationId: string;
  name: string;
  sport: string;
  description: string;
  eventDate: string;
  eventEndDate?: string | null;
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
  adminFeatureOverride?: boolean;
}

export interface RegistrationRefundInfo {
  refund: {
    id: string;
    status: string;
    requestedRefundAmount: number;
    approvedRefundAmount: number | null;
    refundUtr: string | null;
    organizerComments: string | null;
    requestedAt: string | null;
    refundedAt: string | null;
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
  byAddon: Array<{
    addonId: string;
    addonName: string;
    type: "single_select" | "quantity";
    pricePaise: number;
    totalQuantity: number;
    totalRevenuePaise: number;
    byOption: Array<{ option: string; count: number }>;
  }>;
}


export function useEvents() {
  return useQuery({
    queryKey: ["events"],
    queryFn: () => apiRequest<SportEvent[]>("/events"),
  });
}

export interface PublicEventSearchResponse {
  items: SportEvent[];
  page: number;
  pageSize: number;
  total: number;
  sports: string[];
  cities: string[];
}

export function useEventSearch(filters: { q: string; sport: string; city: string; timing: string; page: number; pageSize: number }) {
  const params = new URLSearchParams({ timing: filters.timing, page: String(filters.page), page_size: String(filters.pageSize) });
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.sport !== "ALL") params.set("sport", filters.sport);
  if (filters.city !== "ALL") params.set("city", filters.city);
  return useQuery({
    queryKey: ["event-search", filters.q, filters.sport, filters.city, filters.timing, filters.page, filters.pageSize],
    queryFn: () => apiRequest<PublicEventSearchResponse>(`/events/search?${params}`),
    placeholderData: (previous) => previous,
  });
}

export function useEvent(eventId: string | undefined) {
  return useQuery({
    queryKey: ["events", eventId],
    enabled: Boolean(eventId),
    queryFn: () => apiRequest<SportEvent>(`/events/${eventId}`),
  });
}

export function usePublicEventResults(eventId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["public-event-results", eventId],
    enabled: Boolean(eventId) && enabled,
    queryFn: () => apiRequest<PublicEventResults>(`/events/${eventId}/results`),
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

export function useOrganizerCourts(eventId: string | undefined, enabled = Boolean(eventId)) {
  return useQuery({
    queryKey: ["organizer-courts", eventId],
    enabled: Boolean(eventId) && enabled,
    queryFn: () => apiRequest<OrganizerCourt[]>(`/organizer/events/${eventId}/courts`),
  });
}

export function useOrganizerScoringConfig(eventId: string | undefined, enabled = Boolean(eventId)) {
  return useQuery({
    queryKey: ["organizer-scoring-config", eventId],
    enabled: Boolean(eventId) && enabled,
    queryFn: () => apiRequest<OrganizerScoringConfigResponse>(`/organizer/events/${eventId}/scoring-config`),
  });
}

export function useOrganizerMatchEntries(eventId: string | undefined, categoryId: string | undefined) {
  return useQuery({
    queryKey: ["organizer-match-entries", eventId, categoryId],
    enabled: Boolean(eventId && categoryId),
    queryFn: () => apiRequest<OrganizerMatchEntry[]>(`/organizer/events/${eventId}/match-entries?category_id=${categoryId}`),
  });
}

export function useOrganizerTournamentRounds(eventId: string | undefined, categoryId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["organizer-tournament-rounds", eventId, categoryId],
    enabled: enabled && Boolean(eventId && categoryId),
    queryFn: () => apiRequest<OrganizerTournamentRound[]>(`/organizer/events/${eventId}/tournament-rounds?category_id=${categoryId}`),
  });
}

export function useOrganizerMatches(eventId: string | undefined) {
  return useQuery({
    queryKey: ["organizer-matches", eventId],
    enabled: Boolean(eventId),
    queryFn: () => apiRequest<OrganizerMatch[]>(`/organizer/events/${eventId}/matches`),
  });
}

export function useOrganizerBouts(eventId: string | undefined, matchId: string | undefined) {
  return useQuery({
    queryKey: ["organizer-bouts", eventId, matchId],
    enabled: Boolean(eventId && matchId),
    queryFn: () => apiRequest<MatchBout[]>(`/organizer/events/${eventId}/matches/${matchId}/bouts`),
  });
}

export function useOrganizerStandings(eventId: string | undefined, categoryId: string | undefined) {
  return useQuery({
    queryKey: ["organizer-standings", eventId, categoryId],
    enabled: Boolean(eventId && categoryId),
    queryFn: () => apiRequest<TeamStanding[]>(`/organizer/events/${eventId}/categories/${categoryId}/standings`),
  });
}

export function usePublicStandings(eventId: string | undefined, categoryId: string | undefined) {
  return useQuery({
    queryKey: ["public-standings", eventId, categoryId],
    enabled: Boolean(eventId && categoryId),
    queryFn: () => apiRequest<TeamStanding[]>(`/events/${eventId}/categories/${categoryId}/standings`),
  });
}

export function useOrganizerEventDashboard(eventId: string | undefined) {
  return useQuery({
    queryKey: ["organizer-event-dashboard", eventId],
    enabled: Boolean(eventId),
    queryFn: () => apiRequest<OrganizerEventDashboard>(`/organizer/events/${eventId}/dashboard`),
  });
}

export function useRegistrationRefund(registrationId: string | undefined) {
  return useQuery({
    queryKey: ["registration-refund", registrationId],
    enabled: Boolean(registrationId),
    staleTime: 30_000,
    queryFn: () => apiRequest<{ refund: RegistrationRefundInfo | null }>(
      `/organizer/registrations/${registrationId}/refund`
    ),
  });
}
