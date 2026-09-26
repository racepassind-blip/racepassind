import type { SportConfig } from "./types";

export default {
    race_metric: "speed",
    participant_label: "Rider",
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
