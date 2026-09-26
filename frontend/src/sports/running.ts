import type { SportConfig } from "./types";

export default {
    race_metric: "pace",
    participant_label: "Runner",
    supports_distance: true,
    supports_bib: true,
    supports_tournament: false,
    supports_checkin: true,
    supports_communications: true,
    numberEnabled: true,
    numberLabel: "Bib Number",
    scope: "individual",
    result_type: "race_time",
} as const satisfies SportConfig;
