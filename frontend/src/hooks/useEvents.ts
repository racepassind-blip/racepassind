import { useQuery } from "@tanstack/react-query";

import type { SportEvent } from "@/data/mockEvents";

const API_URL = `${(import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/$/, "")}/api/v1`;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function useEvents() {
  return useQuery({
    queryKey: ["events"],
    queryFn: () => fetchJson<SportEvent[]>(`${API_URL}/events`),
  });
}

export function useEvent(eventId: string | undefined) {
  return useQuery({
    queryKey: ["events", eventId],
    enabled: Boolean(eventId),
    queryFn: () => fetchJson<SportEvent>(`${API_URL}/events/${eventId}`),
  });
}
