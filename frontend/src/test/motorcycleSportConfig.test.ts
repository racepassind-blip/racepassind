import { eventSupportsPickupPoints, eventSupportsTournament, getSportConfig, meetingPointLabel, normalizeSport, sportOptions } from "@/data/sportConfig";

describe("motorcycle sport configuration", () => {
  it("uses the canonical motorcycle key and operational capabilities", () => {
    const config = getSportConfig("motorcycle");
    expect(normalizeSport("motorcycle")).toBe("motorcycle");
    expect(config.participant_label).toBe("Rider");
    expect(config.supports_distance).toBe(true);
    expect(config.supports_bib).toBe(false);
    expect(config.numberEnabled).toBe(false);
    expect(config.result_type).toBe("none");
    expect(config.supports_tournament).toBe(false);
    expect(eventSupportsTournament("motorcycle")).toBe(false);
    expect(eventSupportsPickupPoints("motorcycle")).toBe(true);
  });

  it("does not alias motorcycle to another configured sport", () => {
    expect(getSportConfig("motorcycle")).not.toBe(getSportConfig("cycling"));
    expect(getSportConfig("motorcycle")).not.toBe(getSportConfig("trekking"));
  });

  it("uses meeting-point wording only for motorcycle events", () => {
    expect(meetingPointLabel("motorcycle")).toBe("Meeting point");
    expect(meetingPointLabel("trekking")).toBe("Pickup point");
    expect(sportOptions.some(({ value }) => value === "motorcycle")).toBe(true);
  });
});
