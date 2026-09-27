import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import TournamentSetupGuide, { dummyBracketPreview, knockoutSuggestion, leagueFixtureCount } from "@/components/TournamentSetupGuide";

const apiRequestMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiRequest: apiRequestMock }));

vi.stubGlobal("ResizeObserver", class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
});

afterEach(() => {
  cleanup();
  apiRequestMock.mockClear();
});

function openGuide(initialFormat: "league" | "knockout" = "knockout") {
  render(<MemoryRouter><TournamentSetupGuide eventId="event" initialFormat={initialFormat} /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: /How tournament setup works/ }));
  return screen.getByRole("dialog");
}

describe("tournament setup guide", () => {
  it("shows a short Knockout flow without implementation labels", () => {
    const dialog = openGuide();
    expect(within(dialog).getByText("Knockout flow")).toBeTruthy();
    expect(within(dialog).getByText("Choose Knockout")).toBeTruthy();
    expect(within(dialog).getByText("Create the first round")).toBeTruthy();
    expect(within(dialog).getByText("Complete paired matches")).toBeTruthy();
    expect(within(dialog).getByText("Schedule the next round")).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/\bV1\b/);
    expect(within(dialog).queryByText("Where each task lives")).toBeNull();
  });

  it("shows the League workflow in four steps", () => {
    const dialog = openGuide();
    fireEvent.click(within(dialog).getByRole("tab", { name: /League Everyone keeps playing/ }));
    expect(within(dialog).getByText("League flow")).toBeTruthy();
    expect(within(dialog).getByText("Choose League")).toBeTruthy();
    expect(within(dialog).getByText("Create matches")).toBeTruthy();
    expect(within(dialog).getByText("Schedule and score")).toBeTruthy();
    expect(within(dialog).getByText("Standings and results")).toBeTruthy();
    expect(within(dialog).getByText(/Publishing is a separate approval step/)).toBeTruthy();
  });

  it("updates League fixture counts from the round-robin formula", () => {
    const dialog = openGuide("league");
    const input = within(dialog).getByLabelText("Players, pairs or teams");
    expect(within(dialog).getByText("4 competitors need 6 matches")).toBeTruthy();
    fireEvent.change(input, { target: { value: "5" } });
    expect(within(dialog).getByText("5 competitors need 10 matches")).toBeTruthy();
    expect(leagueFixtureCount(5)).toBe(10);
  });

  it.each([
    [8, 8, 0, 4, [4, 2, 1]],
    [6, 8, 2, 2, [2, 2, 1]],
    [20, 32, 12, 4, [4, 8, 4, 2, 1]],
  ] as const)("suggests bracket structure for %i participants", (count, bracketSize, byes, firstRoundMatches, matches) => {
    const suggestion = knockoutSuggestion(count);
    expect(suggestion.bracketSize).toBe(bracketSize);
    expect(suggestion.byes).toBe(byes);
    expect(suggestion.firstRoundMatches).toBe(firstRoundMatches);
    expect(suggestion.rounds.map((round) => round.matches)).toEqual(matches);
  });

  it("shows 8 competitors as four Quarterfinals, two Semifinals and one Final", () => {
    const dialog = openGuide();
    fireEvent.change(within(dialog).getByLabelText("Players, pairs or teams"), { target: { value: "8" } });
    const plan = within(dialog).getByLabelText("Knockout stage plan");
    expect(within(plan).getByText("Quarterfinals")).toBeTruthy();
    expect(within(plan).getByText("4 matches")).toBeTruthy();
    expect(within(plan).getByText("2 matches")).toBeTruthy();
    expect(within(plan).getByText("1 match")).toBeTruthy();
    const preview = within(dialog).getByLabelText("Example bracket preview");
    expect(within(preview).getAllByText(/^Match [1-4]$/)).toHaveLength(4);
    expect(within(preview).getAllByText(/^Semifinal [1-2]$/)).toHaveLength(2);
    expect(within(preview).getAllByText("Final")).toHaveLength(2);
  });

  it("shows bracket size 8 and two dummy BYEs for 6 competitors", () => {
    const dialog = openGuide();
    fireEvent.change(within(dialog).getByLabelText("Players, pairs or teams"), { target: { value: "6" } });
    expect(within(within(dialog).getByText("Bracket size").parentElement!).getByText("8")).toBeTruthy();
    expect(within(within(dialog).getByText("Byes").parentElement!).getByText("2")).toBeTruthy();
    const preview = within(dialog).getByLabelText("Example bracket preview");
    expect(within(preview).getAllByText("BYE")).toHaveLength(2);
    expect(dummyBracketPreview(6)[0].matches.map((match) => [match.left, match.right])).toEqual([
      ["Competitor 1", "BYE"],
      ["Competitor 2", "Competitor 3"],
      ["Competitor 4", "BYE"],
      ["Competitor 5", "Competitor 6"],
    ]);
  });

  it("explains the playable first round and later stages for 20 competitors", () => {
    const dialog = openGuide();
    fireEvent.change(within(dialog).getByLabelText("Players, pairs or teams"), { target: { value: "20" } });
    const plan = within(dialog).getByLabelText("Knockout stage plan");
    const roundOf32 = within(plan).getByText("Round of 32").parentElement!;
    expect(within(roundOf32).getByText("4 matches played · 12 byes · 16 advance")).toBeTruthy();
    const roundOf16 = within(plan).getByText("Round of 16").parentElement!;
    expect(within(roundOf16).getByText("8 matches")).toBeTruthy();
    expect(within(dialog).getByText(/compact preview is shown for brackets larger than 16 places/)).toBeTruthy();
  });

  it("marks the preview as an example and never calls the tournament API", () => {
    const dialog = openGuide();
    fireEvent.change(within(dialog).getByLabelText("Players, pairs or teams"), { target: { value: "6" } });
    expect(within(dialog).getByText("Example only. Actual competitors, matches and byes are configured manually.")).toBeTruthy();
    expect(within(dialog).getByText("For planning only. Nothing is created or saved.")).toBeTruthy();
    expect(apiRequestMock).not.toHaveBeenCalled();
  });
});
