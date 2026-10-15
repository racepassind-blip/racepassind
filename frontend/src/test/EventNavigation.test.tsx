import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { EventNavigation } from "@/components/EventNavigation";

const state = vi.hoisted(() => ({ category: "running" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, isParticipant: false, isInitialized: true }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock("@/hooks/useEvents", () => ({
  usePublicEventAnnouncements: () => ({ data: { event: { id: "race", title: "City race", date: "2026-10-01", category: state.category }, announcements: [] } }),
  usePublicEventResults: () => ({ data: { matches: [] }, isLoading: false }),
}));
vi.mock("@/hooks/useAllocations", () => ({ usePublicNumberList: () => ({ data: { entries: [], numberLabel: "Bib number" }, isLoading: false }) }));
vi.mock("@/hooks/useRaceTimeResults", () => ({ usePublicRaceResults: () => ({ data: { resultSetStatus: "draft" }, isLoading: false }) }));
afterEach(() => { cleanup(); state.category = "running"; });

it("keeps all supported destinations visible before anything is published", () => {
  render(<MemoryRouter><EventNavigation eventId="race" /></MemoryRouter>);
  expect(screen.getByRole("link", { name: /Announcements/i }).getAttribute("href")).toBe("/event/race/announcements");
  expect(screen.getByText("Bib Number not released")).toBeTruthy();
  expect(screen.getByText("Results are not released")).toBeTruthy();
});

it("hides unsupported race features for trekking", () => {
  state.category = "trekking";
  render(<MemoryRouter><EventNavigation eventId="trek" /></MemoryRouter>);
  expect(screen.queryByText("Results are not released")).toBeNull();
  expect(screen.getByRole("link", { name: /Announcements/i })).toBeTruthy();
});
