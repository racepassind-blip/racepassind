import { CITIES_BY_DISTRICT, DISTRICTS_BY_STATE, getCitiesForDistrict, INDIA_STATES } from "@/data/indiaLocations";

describe("India event location selectors", () => {
  it("contains a state and district list for every configured state", () => {
    expect(INDIA_STATES.length).toBeGreaterThanOrEqual(28);
    expect(INDIA_STATES).toContain("Karnataka");
    expect(DISTRICTS_BY_STATE.Karnataka).toContain("Bengaluru Urban");
    expect(DISTRICTS_BY_STATE.Maharashtra).toContain("Pune");
  });

  it("returns mapped cities where available", () => {
    expect(getCitiesForDistrict("Mysuru")).toEqual(CITIES_BY_DISTRICT.Mysuru);
    expect(getCitiesForDistrict("Bengaluru Urban")).toEqual(["Bengaluru"]);
  });

  it("keeps every district selectable even when no city list is mapped yet", () => {
    expect(getCitiesForDistrict("Anantapur")).toEqual(["Anantapur"]);
    expect(getCitiesForDistrict("")).toEqual([]);
  });
});
