/**
 * React Query hooks for race-time results (running / cycling events).
 *
 * These hooks are completely isolated from the match/tournament result hooks
 * in useEvents.ts — they must not be mixed with or affect those hooks.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResultStatus = "Finished" | "DNS" | "DNF" | "DSQ";
export type ResultSetStatus = "draft" | "published";

export interface OrganizerRaceResultEntry {
  id: string;
  registrationId: string | null;
  participantId: string;
  participantName: string;
  bibNumber: number | null;
  categoryId: string | null;
  categoryName: string | null;
  resultStatus: ResultStatus;
  finishTimeHhmmss: string | null; // "HH:MM:SS"
  rank: number | null;
  paceSecondsPerKm: number | null;
  speedKmhX100: number | null;
}

export interface OrganizerRaceResultsOut {
  eventId: string;
  eventName: string;
  sport: string;
  resultSetStatus: ResultSetStatus;           // overall: published only if ALL published
  categoryStatuses: Record<string, ResultSetStatus>; // categoryId|"__none__" → status
  entries: OrganizerRaceResultEntry[];
}

export interface RaceResultEntryIn {
  registrationId?: string;
  participantId?: string;
  categoryId?: string | null;
  resultStatus: ResultStatus;
  finishTimeHhmmss?: string | null;
}

export interface RaceResultBulkSaveIn {
  entries: RaceResultEntryIn[];
  categoryId?: string | null; // when set, only this category's rows are replaced
}

export interface PublicRaceResultEntry {
  rank: number | null;
  participantName: string;
  bibNumber: number | null;
  resultStatus: ResultStatus;
  finishTimeHhmmss: string | null;
  paceDisplay: string | null;   // e.g. "6:00 /km"
  speedDisplay: string | null;  // e.g. "35.00 km/h"
}

export interface PublicRaceCategoryResults {
  categoryId: string | null;
  categoryName: string;
  distance: string | null;      // e.g. "5 KM", "21.1 KM"
  participantCount: number;
  entries: PublicRaceResultEntry[];
}

export interface PublicRaceResultsOut {
  eventId: string;
  eventName: string;
  sport: string;
  resultSetStatus: ResultSetStatus;
  categories: PublicRaceCategoryResults[];
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

const ORGANIZER_KEY = (eventId: string) => ["organizer-race-results", eventId] as const;
const PUBLIC_KEY = (eventId: string) => ["public-race-results", eventId] as const;

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Organizer editor: load the current result set (draft + published). */
export function useOrganizerRaceResults(eventId: string | undefined) {
  return useQuery({
    queryKey: ORGANIZER_KEY(eventId ?? ""),
    enabled: Boolean(eventId),
    queryFn: () =>
      apiRequest<OrganizerRaceResultsOut>(
        `/organizer/events/${eventId}/race-results`,
      ),
  });
}

/** Organizer: bulk-save draft results (replaces all existing rows). */
export function useSaveRaceResultsDraft(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: RaceResultBulkSaveIn) =>
      apiRequest<OrganizerRaceResultsOut>(
        `/organizer/events/${eventId}/race-results`,
        { method: "POST", body: JSON.stringify(payload) },
      ),
    onSuccess: (data) => {
      qc.setQueryData(ORGANIZER_KEY(eventId), data);
    },
  });
}

/** Organizer: publish the current result set, optionally scoped to one category. */
export function usePublishRaceResults(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId?: string | null) => {
      const params = categoryId ? `?category_id=${categoryId}` : "";
      return apiRequest<OrganizerRaceResultsOut>(
        `/organizer/events/${eventId}/race-results/publish${params}`,
        { method: "POST" },
      );
    },
    onSuccess: (data) => {
      qc.setQueryData(ORGANIZER_KEY(eventId), data);
      qc.invalidateQueries({ queryKey: PUBLIC_KEY(eventId) });
    },
  });
}

/** Organizer: revert results back to draft, optionally scoped to one category. */
export function useUnpublishRaceResults(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId?: string | null) => {
      const params = categoryId ? `?category_id=${categoryId}` : "";
      return apiRequest<OrganizerRaceResultsOut>(
        `/organizer/events/${eventId}/race-results/unpublish${params}`,
        { method: "POST" },
      );
    },
    onSuccess: (data) => {
      qc.setQueryData(ORGANIZER_KEY(eventId), data);
      qc.invalidateQueries({ queryKey: PUBLIC_KEY(eventId) });
    },
  });
}

/** Public results page: load only published rows. */
export function usePublicRaceResults(eventId: string | undefined) {
  return useQuery({
    queryKey: PUBLIC_KEY(eventId ?? ""),
    enabled: Boolean(eventId),
    queryFn: () =>
      apiRequest<PublicRaceResultsOut>(`/events/${eventId}/race-results`),
  });
}
