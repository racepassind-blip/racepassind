import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TeamStandingsCard from "@/components/TeamStandingsCard";
import type { OrganizerEventCategory } from "@/hooks/useEvents";

vi.mock("@/hooks/useEvents", () => ({
  useOrganizerStandings: () => ({ data: [{ registrationId: "pair", displayName: "Asha / Meera", teamName: "Club", captainName: "Asha", matchesPlayed: 2, wins: 1, losses: 1, draws: 0, points: 2 }], isLoading: false }),
}));
afterEach(cleanup);

describe("League standings", () => {
  it.each(["singles", "doubles"] as const)("shows the simple table for %s", (entryType) => {
    render(<TeamStandingsCard eventId="event" categories={[{ id: "cat", name: "Open", entryType } as OrganizerEventCategory]} includeIndividualStandings />);
    for (const name of ["Player / Pair", "Played", "Won", "Lost", "Points"]) {
      expect(screen.getByRole("columnheader", { name })).toBeTruthy();
    }
    expect(screen.getByText("Asha / Meera")).toBeTruthy();
    expect(screen.queryByText(/Captain:/)).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "D" })).toBeNull();
  });
  it("hides individual standings when League support is not enabled", () => {
    render(<TeamStandingsCard eventId="event" categories={[{ id: "cat", name: "Open", entryType: "singles" } as OrganizerEventCategory]} />);
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("retains the team table and draws column", () => {
    render(<TeamStandingsCard eventId="event" categories={[{ id: "cat", name: "Teams", entryType: "team" } as OrganizerEventCategory]} />);
    expect(screen.getByRole("columnheader", { name: "Team" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "D" })).toBeTruthy();
    expect(screen.getByText("Captain: Asha")).toBeTruthy();
  });
});
