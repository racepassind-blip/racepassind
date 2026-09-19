import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";

export interface AllocationRegistration {
  id: string;
  registration_reference: string;
  status: string;
  participant_name: string;
  participant_email: string | null;
  participant_phone: string | null;
  category_name: string | null;
  ticket_name: string;
  team_name: string | null;
  gender: string | null;
  age: number | null;
  allocation_number: number | null;
  allocation_status: "unassigned" | "draft" | "published";
  allocation_assigned_at: string | null;
  allocation_updated_at: string | null;
  created_at: string;
}

export interface AllocationSummary {
  category_id: string;
  category_name: string;
  total_registrations: number;
  unassigned: number;
  draft: number;
  published: number;
}

export interface AllocationAssignment {
  registration_id: string;
  allocation_number: number;
}

export interface AllocationBatchRequest {
  assignments: AllocationAssignment[];
}

export interface AllocationBatchResult {
  total_processed: number;
  assigned: number;
  skipped: number;
  errors: string[];
}

export interface PublishRequest {
  notify_participants: boolean;
}

export interface PublishResult {
  total_published: number;
  previous_published_count: number;
  notify_sent: boolean;
}

export interface EditNumberRequest {
  new_number: number;
  notify_participant: boolean;
}

export interface AllocationHistoryEntry {
  id: string;
  registration_id: string;
  registration_reference: string;
  old_number: number | null;
  new_number: number | null;
  changed_by_user_id: string;
  changed_by_user_name: string | null;
  changed_at: string;
}

export interface SportAllocationConfig {
  number_enabled: boolean;
  number_label: string;
  scope: "individual" | "team_member";
}

// List all registrations with allocation info for an event
export function useAllocations(eventId: string) {
  return useQuery({
    queryKey: ["allocations", eventId],
    queryFn: () =>
      apiRequest<AllocationRegistration[]>(`/organizer/events/${eventId}/allocations`),
  });
}

// Get allocation summary by category
export function useAllocationSummary(eventId: string) {
  return useQuery({
    queryKey: ["allocation-summary", eventId],
    queryFn: () =>
      apiRequest<AllocationSummary[]>(`/organizer/events/${eventId}/allocations/summary`),
  });
}

// Bulk allocate numbers
export function useBatchAllocate(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AllocationBatchRequest) =>
      apiRequest<AllocationBatchResult>(`/organizer/events/${eventId}/allocations/batch`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["allocations", eventId],
      });
      queryClient.invalidateQueries({
        queryKey: ["allocation-summary", eventId],
      });
    },
  });
}

// Publish allocations
export function usePublishAllocations(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PublishRequest) =>
      apiRequest<PublishResult>(`/organizer/events/${eventId}/allocations/publish`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["allocations", eventId],
      });
      queryClient.invalidateQueries({
        queryKey: ["allocation-summary", eventId],
      });
    },
  });
}

// Edit a single registration's allocation
export function useEditAllocation(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ registrationId, payload }: { registrationId: string; payload: EditNumberRequest }) =>
      apiRequest<AllocationRegistration>(`/organizer/events/${eventId}/allocations/${registrationId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["allocations", eventId],
      });
      queryClient.invalidateQueries({
        queryKey: ["allocation-summary", eventId],
      });
      queryClient.invalidateQueries({
        queryKey: ["allocations-history", eventId],
      });
    },
  });
}

// Get allocation history
export function useAllocationHistory(eventId: string) {
  return useQuery({
    queryKey: ["allocations-history", eventId],
    queryFn: () =>
      apiRequest<AllocationHistoryEntry[]>(`/organizer/events/${eventId}/allocations/history`),
  });
}

// Get sport allocation config
export function useSportAllocationConfig(eventId: string) {
  return useQuery({
    queryKey: ["allocation-sport-config", eventId],
    queryFn: () =>
      apiRequest<SportAllocationConfig>(`/organizer/events/${eventId}/allocations/sport-config`),
  });
}

// Get allocation config (alias)
export function useAllocationConfig(eventId: string) {
  return useSportAllocationConfig(eventId);
}

// ---- Public (unauthenticated) number list ----

export interface PublicNumberEntry {
  allocationNumber: number;
  displayName: string;
  categoryName: string | null;
  teamName: string | null;
}

export interface PublicNumberList {
  event: {
    id: string;
    title: string;
    date: string;
    sport: string;
    location: string;
  };
  numberLabel: string;
  categories: { id: string; name: string }[];
  entries: PublicNumberEntry[];
}

// Public, read-only list of published number allocations. No auth required.
export function usePublicNumberList(eventId: string) {
  return useQuery({
    queryKey: ["public-number-list", eventId],
    enabled: Boolean(eventId),
    queryFn: () =>
      apiRequest<PublicNumberList>(`/events/${eventId}/number-list`),
  });
}
