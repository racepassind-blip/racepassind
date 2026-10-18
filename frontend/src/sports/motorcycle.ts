import type { SportConfig } from "./types";

// Motorcycle V1 is an operational rider event: registration, meeting points,
// payments, communications, and check-in are enabled, while competition
// result, tournament, and bib-allocation tooling stays disabled.
export default {
  participant_label: "Rider",
  supports_distance: true,
  supports_bib: false,
  supports_tournament: false,
  team_tournament: false,
  supports_checkin: true,
  supports_communications: true,
  numberEnabled: false,
  numberLabel: "Ride Number",
  scope: "individual",
  result_type: "none",
  supports_waiver: true,
  supports_pickup_points: true,
  pickup_point_label: "Meeting point",
  registration_field_defaults: [
    { id: "custom_motorcycle_make_model", label: "Motorcycle make and model" },
    { id: "custom_motorcycle_registration_number", label: "Motorcycle registration number" },
  ],
} as const satisfies SportConfig;
