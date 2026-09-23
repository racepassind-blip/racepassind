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
    whatsappGroupUrl: string | null;
  };
  participantName: string;
  participants?: Array<{ index: number; participant: { name: string; email?: string | null; phone?: string | null } }>;
  participantCount?: number;
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
  // Refund info (populated alongside registration)
  refund?: {
    id: string;
    status: string;
    requestedRefundAmount: number;
    approvedRefundAmount: number | null;
    refundUtr: string | null;
    refundedAt: string | null;
    confirmedAt: string | null;
  } | null;
  refundEligible?: boolean;
  refundIneligibleReason?: string | null;
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
