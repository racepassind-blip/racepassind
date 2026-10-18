import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import PaidVerification from "@/components/PaidVerification";
import { apiRequest } from "@/lib/api";

vi.mock("@/lib/api", () => ({ apiRequest: vi.fn() }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("does not offer a new submission when status cannot be loaded", async () => {
  vi.mocked(apiRequest).mockRejectedValue(new Error("Unavailable"));
  render(<MemoryRouter><PaidVerification organizationId="org-1" /></MemoryRouter>);
  expect(await screen.findByRole("button", { name: "Retry loading verification" })).toBeInTheDocument();
  expect(screen.queryByLabelText("PAN")).not.toBeInTheDocument();
});

it("allows suspended organizers to correct details for another admin review", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ paidVerificationStatus: "SUSPENDED", suspensionReason: "Update details" });
  render(<MemoryRouter><PaidVerification organizationId="org-1" /></MemoryRouter>);
  expect(await screen.findByText("Paid registration access is suspended.")).toBeInTheDocument();
  expect(screen.getByLabelText("PAN")).toBeEnabled();
});
