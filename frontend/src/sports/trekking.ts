import type { SportConfig } from "./types";

// Canonical "trekking" sport configuration. A trek has one shared event route;
// distance/category are therefore not participant choices. It still uses the
// generic check-in and communication tooling, but never exposes bib/number
// allocation, tournament, court/match/draw, or race-time (pace/speed) functionality.
export default {
    participant_label: "Trekker",
    supports_distance: false,
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
