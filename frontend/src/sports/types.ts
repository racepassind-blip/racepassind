export type ResultType = "match_score" | "race_time" | "none";

export interface SportConfig {
  participant_label: string;
  message?: string;
  race_metric?: "pace" | "speed";
  scoringMax?: number;
  team_tournament?: boolean;
  supports_distance: boolean;
  supports_bib: boolean;
  supports_tournament: boolean;
  supports_checkin: boolean;
  supports_communications: boolean;
  // Allocation / number configuration
  numberEnabled: boolean;
  numberLabel: string;
  scope: "individual" | "team_member";
  /**
   * Determines which result UI adapter is used for this sport.
   * match_score  – per-game scores tracked via Match/Bout tables (badminton, tennis, squash)
   * race_time    – finish-time / bib-based results (running, cycling)
   * none         – no result UI defined yet
   */
  result_type: ResultType;
}
