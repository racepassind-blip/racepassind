import { eventSupportsTournament, getSportConfig, normalizeSport, sportOptions } from "@/data/sportConfig";

describe("trekking sport configuration", () => {
  it("resolves the canonical trekking configuration", () => {
    const config = getSportConfig("trekking");
    expect(config.participant_label).toBe("Trekker");
    expect(config.result_type).toBe("none");
    expect(normalizeSport("trekking")).toBe("trekking");
  });

  it("exposes only the capabilities that apply to a trek", () => {
    const config = getSportConfig("trekking");
    // Distance is supported; tournament/team-tournament and race results are not.
    expect(config.supports_distance).toBe(true);
    expect(config.supports_tournament).toBe(false);
    expect(config.team_tournament).toBe(false);
    expect(config.result_type).toBe("none");
    // No race metrics (pace/speed) and no match/draw/court scoring.
    expect(config.race_metric).toBeUndefined();
    expect(config.scoringMax).toBeUndefined();
    expect(eventSupportsTournament("trekking")).toBe(false);
  });

  it("disables bib / number allocation", () => {
    const config = getSportConfig("trekking");
    expect(config.supports_bib).toBe(false);
    expect(config.numberEnabled).toBe(false);
  });

  it("does not expose badminton or race capabilities", () => {
    const trekking = getSportConfig("trekking");
    const badminton = getSportConfig("badminton");
    const running = getSportConfig("running");
    expect(trekking.result_type).not.toBe("match_score");
    expect(trekking.result_type).not.toBe(running.result_type); // not race_time
    expect(trekking.supports_tournament).not.toBe(badminton.supports_tournament);
  });

  it("offers Trekking as a selectable event type", () => {
    const option = sportOptions.find(({ value }) => value === "trekking");
    expect(option).toBeDefined();
    expect(option?.label).toBe("Trekking");
    // Hiking is not presented anywhere as a Trekking option.
    expect(sportOptions.some(({ value }) => value === "hiking")).toBe(false);
    expect(getSportConfig("hiking").supports_pickup_points).toBe(true);
  });

  it("leaves running, cycling, and badminton configurations unchanged", () => {
    expect(getSportConfig("running").result_type).toBe("race_time");
    expect(getSportConfig("running").race_metric).toBe("pace");
    expect(getSportConfig("cycling").result_type).toBe("race_time");
    expect(getSportConfig("cycling").race_metric).toBe("speed");
    expect(getSportConfig("badminton").supports_tournament).toBe(true);
    expect(getSportConfig("badminton").result_type).toBe("match_score");
    expect(eventSupportsTournament("badminton")).toBe(true);
  });
});

// The event create/edit form (OrganizerEventCreate) is fully capability-driven:
// it renders the cricket setup block only when event_setup === "cricket", gates
// distance fields on supports_distance, and surfaces tournament/race tooling via
// eventSupportsTournament / result_type. These assertions lock in that a Trekking
// event uses the generic flow and never triggers a sport-specific control.
describe("trekking in the event creation/editing flow", () => {
  it("drives the generic form, not any sport-specific setup block", () => {
    const config = getSportConfig("trekking");
    expect(config.event_setup).toBeUndefined();       // no cricket setup block
    expect(config.supports_distance).toBe(true);        // generic distance fields show
    expect(eventSupportsTournament("trekking")).toBe(false); // no tournament setup
    expect(config.result_type).toBe("none");            // no race / match results
    expect(config.supports_bib).toBe(false);            // no bib configuration
    expect(config.numberEnabled).toBe(false);
  });

  it("keeps cricket as the only sport with a dedicated setup block", () => {
    expect(getSportConfig("cricket").event_setup).toBe("cricket");
    expect(getSportConfig("trekking").event_setup).toBeUndefined();
    expect(getSportConfig("running").event_setup).toBeUndefined();
  });
});
