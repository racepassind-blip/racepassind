export type CommunicationEvent = {
  id: string;
  name: string;
  eventDate: string;
  eventEndDate?: string | null;
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

export function buildResultsUrl(eventId: string, origin = window.location.origin): string {
  return new URL(`/event/${encodeURIComponent(eventId)}/results`, origin).toString();
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

export type MessageTemplateKey =
  | "announcement"
  | "reminder"
  | "last_call"
  | "day_of"
  | "results";

export const MESSAGE_TEMPLATES: Array<{ key: MessageTemplateKey; label: string; description: string }> = [
  { key: "announcement",  label: "Registration open",    description: "Initial announcement when registration launches" },
  { key: "reminder",      label: "Registration reminder", description: "Mid-way reminder to people who haven't signed up" },
  { key: "last_call",     label: "Last call",             description: "Urgent nudge when spots or time is running out" },
  { key: "day_of",        label: "Day-of reminder",       description: "Morning of the event with venue and timing details" },
  { key: "results",       label: "Results published",     description: "Let participants know results are live" },
];

export function buildMessageFromTemplate(
  key: MessageTemplateKey,
  event: CommunicationEvent,
  registrationUrl = buildRegistrationUrl(event.id),
): string {
  const date = event.eventEndDate && event.eventEndDate !== event.eventDate
    ? `${formatCommunicationDate(event.eventDate)} – ${formatCommunicationDate(event.eventEndDate)}`
    : formatCommunicationDate(event.eventDate);
  const location  = formatCommunicationLocation(event);
  const name      = event.name;
  const categories =
    event.categories
      ?.map((c) => (c.distance ? `${c.name} (${c.distance})` : c.name))
      .filter(Boolean)
      .join(", ") ?? "";

  switch (key) {
    case "announcement":
      return [
        `${name}`,
        "",
        "Registrations are now open.",
        "",
        `Date: ${date}`,
        `Venue: ${location}`,
        `Sport: ${event.sport}`,
        categories ? `Categories: ${categories}` : null,
        "",
        "Register here:",
        registrationUrl,
        "",
        "Complete your registration using the link above. Share this with anyone who wants to participate.",
      ].filter((l): l is string => l !== null).join("\n");

    case "reminder":
      return [
        `${name} — Registration reminder`,
        "",
        "Spots are still available. If you haven't registered yet, now is a good time.",
        "",
        `Date: ${date}`,
        `Venue: ${location}`,
        "",
        "Register here:",
        registrationUrl,
        "",
        "Registrations close soon. Don't miss out.",
      ].join("\n");

    case "last_call":
      return [
        `${name} — Last call for registrations`,
        "",
        "This is the final reminder. Registrations close very soon and remaining spots are limited.",
        "",
        `Date: ${date}`,
        `Venue: ${location}`,
        "",
        "Register now:",
        registrationUrl,
        "",
        "After registrations close, no further entries will be accepted.",
      ].join("\n");

    case "day_of":
      return [
        `${name} — Today is the day`,
        "",
        `Event date: ${date}`,
        `Venue: ${location}`,
        "",
        "A few things to keep in mind:",
        "- Arrive at least 30 minutes before your start time.",
        "- Carry your registration QR or reference number for check-in.",
        "- Follow all instructions from the event team on the ground.",
        "",
        "See you there. All the best.",
      ].join("\n");

    case "results":
      return [
        `${name} — Results are now live`,
        "",
        "Thank you to everyone who participated. Results have been published.",
        "",
        `View results: ${buildResultsUrl(event.id)}`,
        "",
        "We hope to see you at the next event.",
      ].join("\n");

    default:
      return buildMessageFromTemplate("announcement", event, registrationUrl);
  }
}

/** @deprecated use buildMessageFromTemplate("announcement", ...) */
export function buildWhatsAppMessage(event: CommunicationEvent, registrationUrl = buildRegistrationUrl(event.id)): string {
  return buildMessageFromTemplate("announcement", event, registrationUrl);
}
