import type { SportConfig } from "./types";

export default {
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
} as const satisfies SportConfig;
