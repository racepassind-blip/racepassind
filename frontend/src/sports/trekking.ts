import type { SportConfig } from "./types";

// Canonical "trekking" sport configuration. Treks support distance/category and
// the generic check-in + communication tooling, but never expose bib/number
// allocation, tournament, court/match/draw, or race-time (pace/speed) functionality.
export default {
    participant_label: "Trekker",
    supports_distance: true,
    supports_bib: false,
    supports_tournament: false,
    team_tournament: false,
    supports_checkin: true,
    supports_communications: true,
    numberEnabled: false,
    numberLabel: "Bib Number",
    scope: "individual",
    result_type: "none",
    supports_waiver: true,
    supports_pickup_points: true,
} as const satisfies SportConfig;
