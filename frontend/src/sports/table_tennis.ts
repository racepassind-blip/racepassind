import type { SportConfig } from "./types";

export default {
    participant_label: "Player",
    supports_distance: false,
    supports_bib: false,
    supports_tournament: true,
    supports_checkin: true,
    supports_communications: true,
    numberEnabled: true,
    numberLabel: "Player ID",
    scope: "individual",
    result_type: "match_score",
} as const satisfies SportConfig;
