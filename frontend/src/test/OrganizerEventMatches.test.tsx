import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OrganizerEventMatches from "@/components/OrganizerEventMatches";
import type { OrganizerCourt, OrganizerEventCategory } from "@/hooks/useEvents";

const mockState = vi.hoisted(() => ({ rounds: [] as Array<{ id: string; name: string; position: number }>, matches: null as null | Array<Record<string, unknown>> }));
vi.stubGlobal("ResizeObserver", class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
});

vi.mock("@/hooks/useEvents", () => {
  const entry = (id: string, name: string) => ({ registrationId: id, displayName: name, participantName: name, members: [], teamName: null });
  const defaultMatches = [
    { id: "1", category: { id: "cat", name: "Open" }, roundId: null, roundLabel: "Final", entryA: entry("a", "Asha"), entryB: entry("b", "Ravi"), court: { id: "court", name: "Court 1" }, scheduledTime: null, status: "scheduled", games: [] },
    { id: "2", category: { id: "cat", name: "Open" }, roundId: null, roundLabel: "Semifinal", entryA: entry("c", "Meera"), entryB: entry("d", "Dev"), court: { id: "court", name: "Court 1" }, scheduledTime: "2026-10-10T10:00:00Z", status: "completed", games: [] },
  ];
  return {
    useOrganizerMatchEntries: () => ({ data: [entry("a", "Asha"), entry("b", "Ravi")] }),
    useOrganizerTournamentRounds: () => ({ data: mockState.rounds }),
    useOrganizerMatches: () => ({ data: mockState.matches ?? defaultMatches }),
  };
});
afterEach(() => {
  cleanup();
  mockState.rounds = [];
  mockState.matches = null;
});
function setup(tournamentFormat: "league" | "knockout" | "league_knockout" = "knockout", entryType = "individual") {
  render(<QueryClientProvider client={new QueryClient()}><OrganizerEventMatches eventId="event" categories={[{ id: "cat", name: "Open", entryType } as OrganizerEventCategory]} courts={[{ id: "court", name: "Court 1" } as OrganizerCourt]} supportsTournament tournamentFormat={tournamentFormat} /></QueryClientProvider>);
}
function configureHistory() {
  const entry = (id: string, name: string) => ({ registrationId: id, displayName: name, participantName: name, members: [], teamName: null });
  mockState.rounds = [0, 1, 2].map((position) => ({ id: `r${position + 1}`, name: `Round ${position + 1}`, position }));
  const match = { id: "r1-match", category: { id: "cat", name: "Open" }, roundId: "r1", roundLabel: "Round 1", entryA: entry("a", "Asha"), entryB: entry("b", "Ravi"), court: { id: "court", name: "Court 1" }, scheduledTime: null, status: "completed", winner: "entry_a", games: [] };
  mockState.matches = [match];
  return match;
}
function selectRound(id: string) {
  fireEvent.click(screen.getByRole("tab", { name: /Schedule a match/ }));
  fireEvent.change(screen.getByLabelText("Round"), { target: { value: id } });
}
describe("match scheduling usability", () => {
  it.each(["singles", "doubles", "team"])("blocks an earlier loser in Round 3 for %s entries", (entryType) => {
    configureHistory();
    setup("knockout", entryType);
    selectRound("r3");
    const sideA = screen.getByLabelText(entryType === "team" ? "Team A" : "Player / pair A");
    const sideB = screen.getByLabelText(entryType === "team" ? "Team B" : "Player / pair B");
    expect(within(sideA).getByRole("option", { name: /Ravi — Eliminated/ })).toBeDisabled();
    expect(within(sideB).getByRole("option", { name: /Ravi — Eliminated/ })).toBeDisabled();
    expect(within(sideA).getByRole("option", { name: /Asha — No advancement recorded/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /View Round 3 player status/ }));
    expect(within(screen.getByRole("dialog")).getByText("Eliminated")).toBeTruthy();
  });
  it.each(["scheduled", "in_progress", "completed"])("blocks a %s previous match without a winner", (status) => {
    const match = configureHistory();
    mockState.matches = [{ ...match, roundId: "r2", status, winner: null }];
    setup();
    selectRound("r3");
    expect(within(screen.getByLabelText("Player / pair A")).getByRole("option", { name: /Asha — Awaiting result/ })).toBeDisabled();
  });
  it("allows existing manual placements but never overrides an earlier loss", () => {
    const match = configureHistory();
    mockState.matches!.push({ ...match, id: "r3-match", roundId: "r3", roundLabel: "Round 3", status: "scheduled", winner: null });
    setup();
    selectRound("r3");
    const select = screen.getByLabelText("Player / pair A");
    expect(within(select).getByRole("option", { name: /Asha — Needs time/ })).not.toBeDisabled();
    expect(within(select).getByRole("option", { name: /Ravi — Eliminated/ })).toBeDisabled();
  });
  it("blocks saving stale selections after changing to a later round", () => {
    configureHistory();
    setup();
    selectRound("r1");
    fireEvent.change(screen.getByLabelText("Player / pair A"), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText("Player / pair B"), { target: { value: "b" } });
    fireEvent.change(screen.getByLabelText("Round"), { target: { value: "r3" } });
    expect(screen.getByRole("button", { name: "Add matchup" })).toBeDisabled();
  });
  it("keeps both entries selectable in League despite losses and missing rounds", () => {
    configureHistory();
    setup("league");
    selectRound("r3");
    const select = screen.getByLabelText("Player / pair A");
    expect(within(select).getByRole("option", { name: /Asha/ })).not.toBeDisabled();
    expect(within(select).getByRole("option", { name: /Ravi/ })).not.toBeDisabled();
  });
  it("filters by name and missing time, and lets organizers clear filters", () => {
    setup();
    const schedule = screen.getByRole("region", { name: "Match schedule" });
    fireEvent.change(screen.getByLabelText("Find a match"), { target: { value: "Meera" } });
    expect(within(schedule).getByText(/Meera/)).toBeTruthy();
    expect(within(schedule).queryByText(/Asha/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Match status"), { target: { value: "unscheduled" } });
    expect(within(schedule).getByText(/No matches found/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(within(schedule).getByText("2 of 2 matches")).toBeTruthy();
  });
  it("prevents selecting the same opponent on both sides", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: /Schedule a match/ }));
    fireEvent.change(screen.getByLabelText("Player / pair A"), { target: { value: "a" } });
    const sideB = screen.getByLabelText("Player / pair B");
    expect(within(sideB).queryByRole("option", { name: "Asha" })).toBeNull();
    expect(within(sideB).getByRole("option", { name: "Ravi" })).toBeTruthy();
  });
  it("shows every player's status for the selected round", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: /Schedule a match/ }));
    fireEvent.change(screen.getByLabelText("Round name"), { target: { value: "Final" } });
    fireEvent.click(screen.getByRole("button", { name: /View Final player status/ }));
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText("Asha")).toBeTruthy();
    expect(within(drawer).getByText("Ravi")).toBeTruthy();
    expect(within(drawer).getAllByText("Needs time")).toHaveLength(2);
  });
  it("does not count previous-round losers as needing a later-round schedule", () => {
    const entry = (id: string, name: string) => ({ registrationId: id, displayName: name, participantName: name, members: [], teamName: null });
    mockState.rounds = [{ id: "r1", name: "Round 1", position: 0 }, { id: "r2", name: "Round 2", position: 1 }];
    mockState.matches = [{ id: "r1-match", category: { id: "cat", name: "Open" }, roundId: "r1", roundLabel: "Round 1", entryA: entry("a", "Asha"), entryB: entry("b", "Ravi"), court: { id: "court", name: "Court 1" }, scheduledTime: "2026-10-10T10:00:00Z", status: "completed", winner: "entry_a", games: [{ gameNumber: 1, scoreA: 21, scoreB: 12 }] }];
    setup();
    fireEvent.click(screen.getByRole("tab", { name: /Schedule a match/ }));
    fireEvent.change(screen.getByLabelText("Round"), { target: { value: "r2" } });
    expect(within(screen.getByLabelText("Player / pair A")).getByRole("option", { name: /Asha/ })).not.toBeDisabled();
    expect(within(screen.getByLabelText("Player / pair B")).getByRole("option", { name: /Ravi/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /View Round 2 player status/ }));
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText("1 qualified player still needs to be scheduled")).toBeTruthy();
    expect(within(drawer).getByText("Eliminated")).toBeTruthy();
    expect(within(drawer).getByText(/Previous: Lost vs Asha · 21-12/)).toBeTruthy();
  });
  it("keeps previous-round losers eligible in a league", () => {
    const entry = (id: string, name: string) => ({ registrationId: id, displayName: name, participantName: name, members: [], teamName: null });
    mockState.rounds = [{ id: "r1", name: "League Round 1", position: 0 }, { id: "r2", name: "League Round 2", position: 1 }];
    mockState.matches = [{ id: "r1-match", category: { id: "cat", name: "Open" }, roundId: "r1", roundLabel: "League Round 1", entryA: entry("a", "Asha"), entryB: entry("b", "Ravi"), court: { id: "court", name: "Court 1" }, scheduledTime: "2026-10-10T10:00:00Z", status: "completed", winner: "entry_a", games: [{ gameNumber: 1, scoreA: 21, scoreB: 12 }] }];
    setup("league");
    fireEvent.click(screen.getByRole("tab", { name: /Schedule a match/ }));
    fireEvent.change(screen.getByLabelText("Round"), { target: { value: "r2" } });
    fireEvent.click(screen.getByRole("button", { name: /View League Round 2 player status/ }));
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText("2 players still need to be scheduled")).toBeTruthy();
    expect(within(drawer).queryByText("Eliminated")).toBeNull();
    expect(within(drawer).getByText(/Previous: Lost vs Asha · 21-12/)).toBeTruthy();
  });
});
