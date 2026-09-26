import { describe, expect, it } from "vitest";

import { getSafeRedirectPath } from "@/lib/navigation";

describe("getSafeRedirectPath", () => {
  it("accepts an internal application path", () => {
    expect(getSafeRedirectPath("/organizer/events/new?source=login")).toBe("/organizer/events/new?source=login");
  });

  it("rejects external and browser-normalized redirect targets", () => {
    expect(getSafeRedirectPath("https://evil.example")).toBeUndefined();
    expect(getSafeRedirectPath("//evil.example")).toBeUndefined();
    expect(getSafeRedirectPath("/\\\\evil.example")).toBeUndefined();
    expect(getSafeRedirectPath(null)).toBeUndefined();
  });
});
