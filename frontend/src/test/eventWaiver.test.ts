import { eventSupportsWaiver, getSportConfig } from "@/data/sportConfig";

describe("generic event-level waiver capability", () => {
  it("is supported by every current event type (generic, not sport-specific)", () => {
    for (const sport of ["trekking", "running", "cycling", "badminton"]) {
      expect(eventSupportsWaiver(sport)).toBe(true);
      expect(getSportConfig(sport).supports_waiver).not.toBe(false);
    }
  });

  it("defaults to supported for unknown sports", () => {
    expect(eventSupportsWaiver("some_unknown_sport")).toBe(true);
    expect(eventSupportsWaiver(null)).toBe(true);
  });

  it("exposes the capability on the Trekking config", () => {
    expect(getSportConfig("trekking").supports_waiver).toBe(true);
  });
});
