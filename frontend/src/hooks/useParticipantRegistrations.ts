import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@/lib/api";

export interface ParticipantRegistration {
  id: string;
  registrationReference: string;
  event: {
    id: string;
    name: string;
    date: string;
    location: string;
  };
  participantName: string;
  ticketType: {
    name: string;
    category: string | null;
  };
  amountPaise: number;
  currency: string;
  status: string;
  checkInStatus: "checked_in" | "not_checked_in";
  checkedInAt: string | null;
  paymentStatus: string;
  ticket: {
    version: number;
    format: string;
    qrDataUrl: string;
  } | null;
}

export interface ClaimRegistrationInput {
  registration_reference: string;
  claim_code: string;
}

export const participantRegistrationsQueryKey = ["participant-registrations"] as const;

export function useParticipantRegistrations() {
  return useQuery({
    queryKey: participantRegistrationsQueryKey,
    queryFn: () => apiRequest<ParticipantRegistration[]>("/registrations/me"),
  });
}

export function useClaimParticipantRegistration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ClaimRegistrationInput) => apiRequest<ParticipantRegistration>("/registrations/claim", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: participantRegistrationsQueryKey });
    },
  });
}
