export interface SportConfig {
  participant_label: string;
  supports_distance: boolean;
  supports_bib: boolean;
  supports_tournament: boolean;
  // Allocation / number configuration
  numberEnabled: boolean;
  numberLabel: string;
  scope: "individual" | "team_member";
}

export const sportConfig = {
  running: {
    participant_label: "Runner",
    supports_distance: true,
    supports_bib: true,
    supports_tournament: false,
    numberEnabled: true,
    numberLabel: "Bib Number",
    scope: "individual",
  },
  cycling: {
    participant_label: "Rider",
    supports_distance: true,
    supports_bib: true,
    supports_tournament: false,
    numberEnabled: true,
    numberLabel: "Bib Number",
    scope: "individual",
  },
  badminton: {
    participant_label: "Player",
    supports_distance: false,
    supports_bib: false,
    supports_tournament: true,
    numberEnabled: true,
    numberLabel: "Jersey Number",
    scope: "team_member",
  },
  tennis: {
    participant_label: "Player",
    supports_distance: false,
    supports_bib: false,
    supports_tournament: true,
    numberEnabled: true,
    numberLabel: "Player ID",
    scope: "individual",
  },
  squash: {
    participant_label: "Player",
    supports_distance: false,
    supports_bib: false,
    supports_tournament: true,
    numberEnabled: true,
    numberLabel: "Jersey Number",
    scope: "team_member",
  },
} as const satisfies Record<string, SportConfig>;

export type ConfiguredSport = keyof typeof sportConfig;

const DEFAULT_SPORT_CONFIG: SportConfig = {
  participant_label: "Participant",
  supports_distance: true,
  supports_bib: true,
  supports_tournament: false,
  numberEnabled: true,
  numberLabel: "Bib Number",
  scope: "individual",
};

export function getSportConfig(
  sport: string | null | undefined,
  options?: { hasTeamCategories?: boolean },
): SportConfig {
  const normalizedSport = sport?.trim().toLowerCase();
  const base = (!normalizedSport ? DEFAULT_SPORT_CONFIG : sportConfig[normalizedSport as ConfiguredSport] ?? DEFAULT_SPORT_CONFIG);
  // Team-format events (any sport) unlock the tournament tooling.
  if (options?.hasTeamCategories) {
    return { ...base, supports_tournament: true };
  }
  return base;
}

/** True when an event should expose tournament tooling: badminton, or any event with a team category. */
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
 */
export function isFreeEvent(
  categories?: Array<{ tickets?: Array<{ pricePaise?: number }> }> | null,
): boolean {
  if (!categories || categories.length === 0) return false;
  const tickets = categories.flatMap((category) => category.tickets ?? []);
  if (tickets.length === 0) return false;
  return tickets.every((ticket) => (ticket.pricePaise ?? 0) === 0);
}
