import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { OrganizerFinanceRedirect } from "@/pages/OrganizerPayments";
import { OrganizerWorkspaceTabs } from "@/components/OrganizerWorkspaceTabs";

afterEach(cleanup);
function Destination() { const location = useLocation(); return <p>{location.pathname}{location.search}</p>; }
it("preserves the event when redirecting legacy finance and refunds links", () => {
  const { unmount } = render(<MemoryRouter initialEntries={["/organizer/events/event-one/finance"]}><Routes>
    <Route path="/organizer/events/:eventId/finance" element={<OrganizerFinanceRedirect />} />
    <Route path="/organizer/payments" element={<Destination />} />
  </Routes></MemoryRouter>);
  expect(screen.getByText("/organizer/payments?event_id=event-one")).toBeInTheDocument();
  unmount();
  render(<MemoryRouter initialEntries={["/organizer/events/event-one/refunds"]}><Routes>
    <Route path="/organizer/events/:eventId/refunds" element={<OrganizerFinanceRedirect refunds />} />
    <Route path="/organizer/payments" element={<Destination />} />
  </Routes></MemoryRouter>);
  expect(screen.getByText("/organizer/payments?event_id=event-one&tab=refunds")).toBeInTheDocument();
});
it("groups credits and payments under Transactions", () => {
  render(<MemoryRouter initialEntries={["/organizer/credits"]}><OrganizerWorkspaceTabs /></MemoryRouter>);
  expect(screen.getByRole("link", { name: "Transactions" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "SportPass Credits" })).toHaveAttribute("href", "/organizer/credits");
  expect(screen.getByRole("link", { name: "Payments & Settlements" })).toHaveAttribute("href", "/organizer/payments");
  expect(screen.queryByRole("link", { name: "Refunds" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Event finance" })).not.toBeInTheDocument();
});
