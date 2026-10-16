import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AdminPaymentReconciliation from "@/pages/AdminPaymentReconciliation";

const mocks = vi.hoisted(() => ({ request: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiRequest: mocks.request, downloadApiFile: mocks.download }));
vi.mock("@/components/AdminDashboardLayout", () => ({ AdminDashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
beforeEach(() => {
  mocks.request.mockReset(); mocks.download.mockReset(); mocks.download.mockResolvedValue(undefined);
  mocks.request.mockImplementation(async (url: string) => url.endsWith("/events")
    ? { items: [{ id: "event-one", name: "City run", organizer: "Run club" }] }
    : { items: [], total: 51, page: 1, pageSize: 25, summary: { collectedPaise: 10000, refundedPaise: 0, attentionCount: 0 } });
});
afterEach(cleanup);
function mount() {
  render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AdminPaymentReconciliation /></QueryClientProvider></MemoryRouter>);
}
it("exports all matching filters rather than just the current page", async () => {
  mount();
  await screen.findByRole("option", { name: "City run · Run club" });
  fireEvent.change(screen.getByLabelText("Event"), { target: { value: "event-one" } });
  fireEvent.change(screen.getByLabelText("From date (IST)"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("To date (IST)"), { target: { value: "2026-10-17" } });
  fireEvent.change(screen.getByLabelText("Payment status"), { target: { value: "needs_review" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Export CSV" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
  await waitFor(() => expect(mocks.download).toHaveBeenCalled());
  const url = new URL(mocks.download.mock.calls[0][0], "https://example.com");
  expect(url.searchParams.get("event_id")).toBe("event-one");
  expect(url.searchParams.get("date_from")).toBe("2026-10-01");
  expect(url.searchParams.get("date_to")).toBe("2026-10-17");
  expect(url.searchParams.get("status")).toBe("needs_review");
  expect(url.searchParams.get("environment")).toBe("production");
  expect(url.searchParams.has("page")).toBe(false);
});
it("rejects reversed date ranges and resets pagination on filter changes", async () => {
  mount();
  await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(mocks.request.mock.calls.some(([url]) => url.includes("page=2"))).toBe(true));
  fireEvent.change(screen.getByLabelText("Payment status"), { target: { value: "refunded" } });
  await waitFor(() => expect(mocks.request.mock.calls.some(([url]) => url.includes("status=refunded") && url.includes("page=1"))).toBe(true));
  fireEvent.change(screen.getByLabelText("From date (IST)"), { target: { value: "2026-10-18" } });
  fireEvent.change(screen.getByLabelText("To date (IST)"), { target: { value: "2026-10-17" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Choose an end date");
  expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
});
