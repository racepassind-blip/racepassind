import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Checkout from "@/pages/Checkout";
import { apiRequest } from "@/lib/api";

const event = { id: "event", title: "Race", date: "2026-10-10", tiers: [], paymentCollectionMethod: "CASHFREE_MANAGED", registrationStatus: "closed" };
vi.mock("@/components/Layout", () => ({ Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ eventId: "event" }), useLocation: () => ({ pathname: "/checkout/event", search: "?cashfree_return=1" }), useNavigate: () => vi.fn() }));
vi.mock("@/hooks/useEvents", () => ({ useEvent: () => ({ data: event, isLoading: false, isError: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, isParticipant: false, isInitialized: true }) }));
vi.mock("@/lib/api", () => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/scroll", () => ({ scrollToTop: vi.fn() }));

beforeEach(() => { sessionStorage.clear(); vi.mocked(apiRequest).mockReset(); });
afterEach(cleanup);

it("does not offer another checkout when return credentials are lost", async () => {
  render(<Checkout />);
  expect(await screen.findByText("We could not restore this checkout")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Pay online" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "View my registrations" })).toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalled();
});

it.each(["pending", "failed", "user_dropped", "successful", "expired", "verification_pending", "paid_needs_review", "refund_pending", "refund_needs_review", "refunded"])("restores %s payment even with no cart and registration closed", async (status) => {
  const child = { registrationReference: "REG-1", confirmationToken: "private-confirmation-token", amountPaise: 12000, status: "awaiting_payment", paymentStatus: "pending", event: { name: "Race", date: "2026-10-10", location: "Mysuru" }, paymentSettings: null, paymentCollectionMethod: "CASHFREE_MANAGED" };
  sessionStorage.setItem("sportpass_cashfree_checkout_event", JSON.stringify({ ...child, registrations: [child] }));
  vi.mocked(apiRequest).mockResolvedValue({ status });
  render(<Checkout />);
  await waitFor(() => expect(apiRequest).toHaveBeenCalled());
  expect(await screen.findByRole("heading", { name: "Pay securely with Cashfree" })).toBeInTheDocument();
  if (["failed", "user_dropped"].includes(status)) {
    expect(await screen.findByRole("button", { name: "Try payment again" })).toBeInTheDocument();
  } else {
    await waitFor(() => expect(screen.queryByRole("button", { name: "Pay online" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Try payment again" })).not.toBeInTheDocument();
  }
  if (status === "successful") expect(screen.getByRole("button", { name: "View registration" })).toBeInTheDocument();
});
