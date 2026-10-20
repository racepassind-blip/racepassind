import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import AdminTransactions from "@/pages/AdminTransactions";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiRequest: request }));
afterEach(cleanup);

it("keeps payment provenance visible and opens reference history without leaving the list", async () => {
  request.mockImplementation(async (url: string) => {
    if (url.endsWith("/options")) return { organizers: [], events: [] };
    if (url.includes("/registration/")) return { history: [{ date: "2026-10-20T10:00:00Z", label: "Payment review: approved", reference: "UTR1234", note: null }] };
    return { total: 1, counts: { successful: 1 }, items: [{ id: "reg", kind: "registration", reference: "SPE-1", customer: "Runner", event: "City Run", event_id: "event", organizer: "Club", organization_id: "org", method: "direct_upi", status: "successful", amount: 10000, fee: 500, refunded: 0, payment_reference: "UTR1234", created_at: "2026-10-20T10:00:00Z", confirmation: "Confirmed by organizer" }] };
  });
  render(<MemoryRouter initialEntries={["/?tab=transactions&organization_id=org"]}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AdminTransactions /></QueryClientProvider></MemoryRouter>);
  await screen.findByText("Runner");
  expect(screen.getByText("Direct to organizer")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  await screen.findByText("Payment review: approved");
  expect(screen.getByText("Confirmed by organizer")).toBeInTheDocument();
  expect(request.mock.calls.some(([url]) => url.includes("organization_id=org"))).toBe(true);
});

it("rejects reversed date ranges", async () => {
  render(<MemoryRouter initialEntries={["/?date_from=2026-10-21&date_to=2026-10-20"]}><QueryClientProvider client={new QueryClient()}><AdminTransactions /></QueryClientProvider></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Choose an end date"));
  expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
});
