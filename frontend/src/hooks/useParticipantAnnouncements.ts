import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "@/lib/api";

export type ParticipantAnnouncement = {
  event: {
    id: string;
    title: string;
    date: string;
    location: string;
    organizer: string;
  };
  announcement: {
    id: string;
    title: string;
    body: string;
    publishedAt: string | null;
    updatedAt: string | null;
    isPinned: boolean;
  };
};

export function useParticipantAnnouncements(limit = 6) {
  return useQuery({
    queryKey: ["participant-announcements", limit],
    queryFn: () => apiRequest<{ items: ParticipantAnnouncement[] }>(`/participant/announcements?limit=${limit}`),
  });
}
