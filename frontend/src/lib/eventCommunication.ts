export type CommunicationEvent = {
  id: string;
  name: string;
  eventDate: string;
  sport: string;
  registrationStatus?: "open" | "closed";
  location: {
    name?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
  };
  categories?: Array<{
    name: string;
    distance: string | null;
    tickets: Array<{ name: string; pricePaise: number }>;
  }>;
};

export function buildRegistrationUrl(eventId: string, origin = window.location.origin): string {
  return new URL(`/event/${encodeURIComponent(eventId)}`, origin).toString();
}

export function formatCommunicationDate(value: string): string {
  const parsed = new Date(`${value.length === 10 ? `${value}T00:00:00` : value}`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function formatCommunicationLocation(event: CommunicationEvent): string {
  const values = [event.location.name, event.location.address, event.location.city, event.location.state, event.location.country]
    .filter((value): value is string => Boolean(value?.trim()));
  return values.length > 0 ? [...new Set(values)].join(", ") : "Location details will be shared by the organizer.";
}

export function buildWhatsAppMessage(event: CommunicationEvent, registrationUrl = buildRegistrationUrl(event.id)): string {
  const categories = event.categories?.map((category) => category.distance ? `${category.name} (${category.distance})` : category.name).filter(Boolean) ?? [];
  const statusLine = event.registrationStatus === "closed"
    ? "Registration is currently closed. Please use the link below for updates."
    : "Registration is now open.";
  return [
    `🏃 ${event.name}`,
    "",
    statusLine,
    `📅 Date: ${formatCommunicationDate(event.eventDate)}`,
    `📍 Location: ${formatCommunicationLocation(event)}`,
    `🏅 Sport: ${event.sport}`,
    categories.length > 0 ? `🎟️ Categories: ${categories.join(", ")}` : null,
    "",
    "Register here:",
    registrationUrl,
    "",
    "Please complete your registration using the link above. Share this with anyone who wants to participate!",
  ].filter((line): line is string => line !== null).join("\n");
}
