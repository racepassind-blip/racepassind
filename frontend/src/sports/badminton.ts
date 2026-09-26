import type { SportConfig } from "./types";

export default {
    scoringMax: 30,
    participant_label: "Player",
    supports_distance: false,
    supports_bib: false,
    supports_tournament: true,
    supports_checkin: true,
    supports_communications: true,
    numberEnabled: true,
    numberLabel: "Jersey Number",
    scope: "team_member",
    result_type: "match_score",
    message: "Organize singles, doubles, and mixed doubles tournaments with ease. Track matches, scores, and results with built-in tournament management.",
} as const satisfies SportConfig;
