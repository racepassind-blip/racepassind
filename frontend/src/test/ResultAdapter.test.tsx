import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ sport: "running" }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ id: "test-event" }) }));
vi.mock("@/hooks/useEvents", () => ({
  useEvent: () => ({ data: { category: state.sport } }),
  usePublicEventResults: () => { throw new Error("Race routing must not load matches"); },
}));
vi.mock("@/pages/PublicEventResults", () => ({ default: () => <div>Match results</div> }));
vi.mock("@/results/PublicRaceTimeResults", () => ({ default: () => <div>Race results</div> }));
vi.mock("@/results/RaceTimeResultsPlaceholder", () => ({ default: () => <div>No results</div> }));
import ResultAdapter from "@/results/ResultAdapter";

afterEach(cleanup);
describe("public result sport dispatch", () => {
  it.each([
    ["running", "Race results"], ["cycling", "Race results"],
    ["badminton", "Match results"], ["table-tennis", "Match results"],
    ["hiking", "No results"], ["unknown", "No results"],
  ])("routes %s from event metadata", (sport, label) => {
    state.sport = sport;
    render(<ResultAdapter />);
    expect(screen.getByText(label)).toBeTruthy();
  });
});
