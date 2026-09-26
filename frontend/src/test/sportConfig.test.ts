import { describe, expect, it } from "vitest";
import { eventSupportsTournament, getSportConfig, sportConfig, sportOptions } from "@/data/sportConfig";

describe("sport policy isolation", () => {
  it.each(Object.keys(sportConfig))("%s satisfies the UI contract", (sport) => {
    const config = getSportConfig(sport);
    expect(config.participant_label).toBeTruthy();
    expect(config.numberLabel).toBeTruthy();
    expect(["none", "race_time", "match_score"]).toContain(config.result_type);
  });
  it("keeps returned configuration independent from other sports and subsequent calls", () => {
    const badminton = getSportConfig("badminton");
    badminton.supports_distance = true;
    badminton.scoringMax = 15;
    expect(getSportConfig("badminton").scoringMax).toBe(30);
    expect(getSportConfig("table-tennis").scoringMax).toBeUndefined();
    expect(getSportConfig("table_tennis").supports_distance).toBe(false);
    expect(getSportConfig("running").supports_distance).toBe(true);
  });
  it("selects independent race metrics", () => {
    expect(getSportConfig("running").race_metric).toBe("pace");
    expect(getSportConfig("cycling").race_metric).toBe("speed");
    expect(getSportConfig("badminton").race_metric).toBeUndefined();
  });
  it("supports legacy aliases and unknown event rendering", () => {
    expect(getSportConfig(" Table Tennis ")).toEqual(getSportConfig("table_tennis"));
    expect(getSportConfig("trekking")).toEqual(getSportConfig("hiking"));
    expect(getSportConfig("old_custom_sport").result_type).toBe("none");
    expect(getSportConfig(null).numberLabel).toBe("Bib Number");
  });
  it("selects tournament capabilities without leaking to ordinary race events", () => {
    expect(eventSupportsTournament("table-tennis")).toBe(true);
    expect(eventSupportsTournament("badminton")).toBe(true);
    expect(eventSupportsTournament("running")).toBe(false);
    expect(eventSupportsTournament("hiking")).toBe(false);
    expect(eventSupportsTournament("legacy", [{ entryType: "team" }])).toBe(true);
    expect(eventSupportsTournament("legacy")).toBe(false);
  });
  it("offers Table Tennis but does not add Cricket", () => {
    expect(sportOptions.some(({ value }) => value === "table_tennis")).toBe(true);
    expect(sportOptions.some(({ value }) => value === "cricket")).toBe(false);
  });
});
