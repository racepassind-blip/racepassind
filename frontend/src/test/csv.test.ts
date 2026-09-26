import { describe, expect, it } from "vitest";

import { csvCell } from "@/lib/csv";

describe("csvCell", () => {
  it("neutralizes spreadsheet formulas in untrusted text", () => {
    expect(csvCell("=HYPERLINK(\"https://evil.example\")", true)).toBe('"\'=HYPERLINK(""https://evil.example"")"');
    expect(csvCell("+Organizer", true)).toBe('"\'+Organizer"');
    expect(csvCell("-Event", true)).toBe('"\'-Event"');
    expect(csvCell("@formula", true)).toBe('"\'@formula"');
  });

  it("keeps numeric cells numeric-looking", () => {
    expect(csvCell("-35.96")).toBe('"-35.96"');
  });
});
