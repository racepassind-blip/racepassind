import type { SportConfig } from "./types";

export default {
  participant_label: "Team",
  supports_distance: false,
  supports_bib: false,
  supports_tournament: true,
  supports_checkin: true,
  supports_communications: true,
  numberEnabled: false,
  numberLabel: "Player ID",
  scope: "team_member",
  result_type: "none",
  event_setup: "cricket",
} as const satisfies SportConfig;
