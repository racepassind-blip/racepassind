import { eventSupportsPickupPoints, getSportConfig } from "@/data/sportConfig";

describe("generic event-level pickup-points capability", () => {
  it("is supported by Trekking", () => {
    expect(eventSupportsPickupPoints("trekking")).toBe(true);
    expect(getSportConfig("trekking").supports_pickup_points).toBe(true);
  });

  it("is available as a generic event feature across other sports", () => {
    for (const sport of ["running", "cycling", "badminton"]) {
      expect(eventSupportsPickupPoints(sport)).toBe(true);
    }
  });

  it("defaults to unsupported for unknown or empty sports", () => {
    expect(eventSupportsPickupPoints("some_unknown_sport")).toBe(true);
    expect(eventSupportsPickupPoints(null)).toBe(true);
    expect(eventSupportsPickupPoints(undefined)).toBe(true);
  });
});
