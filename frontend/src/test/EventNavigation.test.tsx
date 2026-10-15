import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { EventNavigation } from "@/components/EventNavigation";

const state = vi.hoisted(() => ({ category: "running" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, isParticipant: false, isInitialized: true }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock("@/hooks/useEvents", () => ({ useEvent: () => ({ data: { title: "City race", category: state.category } }) }));
afterEach(() => { cleanup(); state.category = "running"; });

it("keeps all supported destinations available before anything is published", () => {
  render(<MemoryRouter initialEntries={["/event/race/announcements"]}><EventNavigation /></MemoryRouter>);
  expect(screen.getByRole("link", { name: "Announcements" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Overview" }).getAttribute("href")).toBe("/event/race");
  expect(screen.getByRole("link", { name: /Bib/i }).getAttribute("href")).toBe("/event/race/number-list");
  expect(screen.getByRole("link", { name: "Results" }).getAttribute("href")).toBe("/event/race/results");
});

it("hides unsupported race features for trekking", () => {
  state.category = "trekking";
  render(<MemoryRouter initialEntries={["/event/trek"]}><EventNavigation /></MemoryRouter>);
  expect(screen.queryByRole("link", { name: "Results" })).toBeNull();
  expect(screen.getByRole("link", { name: "Announcements" })).toBeTruthy();
});

it("does not add event navigation to unrelated pages", () => {
  render(<MemoryRouter initialEntries={["/events"]}><EventNavigation /></MemoryRouter>);
  expect(screen.queryByRole("navigation")).toBeNull();
});
