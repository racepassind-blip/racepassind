import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Checkout from "@/pages/Checkout";
import { OrganizerWaitlist } from "@/components/OrganizerWaitlist";
import { apiRequest } from "@/lib/api";

const event = { id: "event", title: "Trek", category: "trekking", date: "2026-10-10", tiers: [{ id: "ticket", name: "Trek ticket", price: 100, available: 0 }], registrationStatus: "open", paymentCollectionMethod: "DIRECT_UPI", fieldConfig: { fields: [{ id: "full_name", label: "Full name", type: "text", required: true }, { id: "email", label: "Email", type: "email", required: true }] } };
const refetch = vi.fn();
const queue = { items: [{ id: "first", name: "Walker", email: "walker@example.test", position: 1, status: "waiting" }] };
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: queue, refetch }) }));
vi.mock("@/components/Layout", () => ({ Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ eventId: "event" }), useLocation: () => ({ pathname: "/checkout/event", search: "", hash: "#waitlist=private-invitation-token" }), useNavigate: () => vi.fn() }));
vi.mock("@/hooks/useEvents", () => ({ useEvent: () => ({ data: event, isLoading: false, isError: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, isParticipant: false, isInitialized: true }) }));
vi.mock("@/lib/api", () => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/scroll", () => ({ scrollToTop: vi.fn() }));

beforeEach(() => { sessionStorage.clear(); vi.mocked(apiRequest).mockReset(); refetch.mockReset(); });
afterEach(cleanup);

it("loads a reserved sold-out ticket and explains a waived invitation", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ eventId: "event", ticketId: "ticket", name: "Walker", email: "walker@example.test", expiresAt: "2026-10-19T14:00:00Z", waivePayment: true });
  render(<Checkout />);
  expect(await screen.findByText(/organizer has waived all payment/i)).toBeInTheDocument();
  expect(apiRequest).toHaveBeenCalledWith("/waitlist/offer", expect.objectContaining({ method: "POST", body: JSON.stringify({ token: "private-invitation-token" }) }));
  expect(screen.queryByText("Event or ticket selection not found.")).not.toBeInTheDocument();
});

it("shows an expired invitation error without starting another checkout", async () => {
  vi.mocked(apiRequest).mockRejectedValue(new Error("This invitation has expired"));
  render(<Checkout />);
  expect(await screen.findByRole("alert")).toHaveTextContent("This invitation has expired");
  expect(apiRequest).toHaveBeenCalledTimes(1);
});

it("requires an explicit organizer choice to waive payment", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ status: "offered" });
  render(<OrganizerWaitlist eventId="event" />);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /Invite #1/ }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/organizer/waitlist/first/promote", { method: "POST", body: JSON.stringify({ waive_payment: true }) }));
  expect(refetch).toHaveBeenCalled();
});

it("charges the normal price by default", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ status: "offered" });
  render(<OrganizerWaitlist eventId="event" />);
  fireEvent.click(screen.getByRole("button", { name: /Invite #1/ }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/organizer/waitlist/first/promote", { method: "POST", body: JSON.stringify({ waive_payment: false }) }));
});
