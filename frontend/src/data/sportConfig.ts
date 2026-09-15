export interface SportConfig {
  participant_label: string;
  supports_distance: boolean;
  supports_bib: boolean;
  supports_tournament: boolean;
}

export const sportConfig = {
  running: {
    participant_label: "Runner",
    supports_distance: true,
    supports_bib: true,
    supports_tournament: false,
  },
  cycling: {
    participant_label: "Rider",
    supports_distance: true,
    supports_bib: true,
    supports_tournament: false,
  },
  badminton: {
    participant_label: "Player",
    supports_distance: false,
    supports_bib: false,
    supports_tournament: true,
  },
} as const satisfies Record<string, SportConfig>;

export type ConfiguredSport = keyof typeof sportConfig;

const DEFAULT_SPORT_CONFIG: SportConfig = {
  participant_label: "Participant",
  supports_distance: true,
  supports_bib: true,
  supports_tournament: false,
};

export function getSportConfig(sport: string | null | undefined): SportConfig {
  const normalizedSport = sport?.trim().toLowerCase();
  if (!normalizedSport) return DEFAULT_SPORT_CONFIG;
  return sportConfig[normalizedSport as ConfiguredSport] ?? DEFAULT_SPORT_CONFIG;
}
