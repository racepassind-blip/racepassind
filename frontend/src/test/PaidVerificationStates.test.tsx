import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import PaidVerification from "@/components/PaidVerification";
import { apiRequest } from "@/lib/api";

vi.mock("@/lib/api", () => ({ apiRequest: vi.fn() }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function renderVerification() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter><PaidVerification organizationId="org-1" /></MemoryRouter></QueryClientProvider>);
}

it("does not offer a new submission when status cannot be loaded", async () => {
  vi.mocked(apiRequest).mockRejectedValue(new Error("Unavailable"));
  renderVerification();
  expect(await screen.findByRole("button", { name: "Retry loading verification" })).toBeInTheDocument();
  expect(screen.queryByLabelText(/^PAN \(required for paid events\)$/)).not.toBeInTheDocument();
});

it("allows suspended organizers to correct details for another admin review", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ paidVerificationStatus: "SUSPENDED", suspensionReason: "Update details" });
  renderVerification();
  expect(await screen.findByText("Paid registration access is suspended.")).toBeInTheDocument();
  expect(screen.getByLabelText(/^PAN \(required for paid events\)$/)).toBeEnabled();
});
