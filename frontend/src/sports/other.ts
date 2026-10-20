import type { SportConfig } from "./types";

/** Generic event type for sports or activities without a dedicated workflow. */
const other: SportConfig = {
  participant_label: "Participant",
  supports_distance: false,
  supports_bib: false,
  supports_tournament: false,
  supports_checkin: true,
  supports_communications: true,
  numberEnabled: false,
  numberLabel: "Participant number",
  scope: "individual",
  result_type: "none",
  supports_waiver: true,
  supports_pickup_points: true,
};

export default other;
