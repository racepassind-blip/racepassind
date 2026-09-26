import type { SportConfig } from "@/sports/types";
export type { SportConfig, ResultType } from "@/sports/types";
import running from "@/sports/running";
import cycling from "@/sports/cycling";
import badminton from "@/sports/badminton";
import table_tennis from "@/sports/table_tennis";
import tennis from "@/sports/tennis";
import squash from "@/sports/squash";
import hiking from "@/sports/hiking";
import cricket from "@/sports/cricket";

export const sportConfig = { running, cycling, badminton, table_tennis, tennis, squash, hiking, cricket } as const satisfies Record<string, SportConfig>;


export type ConfiguredSport = keyof typeof sportConfig;

const DEFAULT_SPORT_CONFIG: SportConfig = {
  participant_label: "Participant",
  supports_distance: true,
  supports_bib: true,
  supports_tournament: false,
  supports_checkin: true,
  supports_communications: true,
  numberEnabled: true,
  numberLabel: "Bib Number",
  scope: "individual",
  result_type: "none",
};

export function normalizeSport(sport: string | null | undefined): string {
  const key = (sport ?? "").trim().toLowerCase().replace(/[- ]/g, "_");
  return key === "trekking" ? "hiking" : key;
}

export const sportOptions = [
  { value: "running", label: "Running" },
  { value: "cycling", label: "Cycling" },
  { value: "badminton", label: "Badminton" },
  { value: "table_tennis", label: "Table Tennis" },
  { value: "triathlon", label: "Triathlons/Duathlons" },
  { value: "swimming", label: "Swimming (open water/mass swims)" },
  { value: "hiking", label: "Trekking/Hiking events" },
  { value: "obstacle_course", label: "Obstacle course races (Spartan-style, mud runs)" },
  { value: "walkathon", label: "Walkathons/charity walks" },
  { value: "cricket", label: "Cricket" },
];

export function getSportConfig(
  sport: string | null | undefined,
  options?: { hasTeamCategories?: boolean },
): SportConfig {
  const normalizedSport = normalizeSport(sport);
  const base: SportConfig = (!normalizedSport ? DEFAULT_SPORT_CONFIG : sportConfig[normalizedSport as ConfiguredSport] ?? DEFAULT_SPORT_CONFIG);
  // Team-format events (any sport) unlock the tournament tooling.
  if (options?.hasTeamCategories && base.team_tournament !== false) {
    return { ...base, supports_tournament: true };
  }
  return { ...base };
}

/** Select tournament tooling from sport capabilities and category format. */
export function eventSupportsTournament(
  sport: string | null | undefined,
  categories?: Array<{ entryType?: string }> | null,
): boolean {
  const hasTeam = Boolean(categories?.some((category) => category.entryType === "team"));
  return getSportConfig(sport, { hasTeamCategories: hasTeam }).supports_tournament;
}

/**
 * True when an event is a "free event": every ticket across every category is priced at ₹0.
 * Free events only get the core workflow (overview + registrations); paid-only tooling is locked.
 * Returns false when categories/tickets are unknown so we never lock a paid event by mistake.
 *
 * Admin override: when `adminFeatureOverride` is set on the event, all features are unlocked
 * regardless of pricing, so this returns false.
 */
export function isFreeEvent(
  event?: {
    adminFeatureOverride?: boolean;
    categories?: Array<{ tickets?: Array<{ pricePaise?: number }> }>;
  } | null,
): boolean {
  if (!event) return false;
  // Admin has explicitly unlocked all features for this event.
  if (event.adminFeatureOverride) return false;
  const categories = event.categories;
  if (!categories || categories.length === 0) return false;
  const tickets = categories.flatMap((category) => category.tickets ?? []);
  if (tickets.length === 0) return false;
  return tickets.every((ticket) => (ticket.pricePaise ?? 0) === 0);
}
