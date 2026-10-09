import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CashfreePaymentReviews } from "@/components/CashfreePaymentReviews";
import { apiRequest } from "@/lib/api";

vi.mock("@/lib/api", () => ({ apiRequest: vi.fn() }));
const review = { id: "payment", orderId: "booking", providerOrderId: "cf-order", environment: "sandbox", eventName: "Race",
  organizerName: "Club", amountPaise: 12000, status: "NEEDS_DECISION", resolution: null, history: [] };
beforeEach(() => { vi.mocked(apiRequest).mockReset(); });
afterEach(cleanup);

it("requires a reason and deliberate confirmation before issuing a refund", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ items: [review], total: 1 });
  render(<CashfreePaymentReviews reloadKey={0} />);
  fireEvent.click(await screen.findByRole("button", { name: "Review full refund" }));
  const confirm = screen.getByRole("button", { name: /Confirm full refund/ });
  expect(confirm).toBeDisabled();
  expect(apiRequest).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Reason for this decision"), { target: { value: "Event cannot fulfill this booking" } });
  fireEvent.click(confirm);
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/admin/cashfree/payment-reviews/payment/resolve", {
    method: "POST", body: JSON.stringify({ action: "REFUND", reason: "Event cannot fulfill this booking" }),
  }));
});

it("shows a pending refund and only offers its existing recovery action", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ items: [{ ...review, status: "PENDING",
    resolution: { action: "REFUND", reason: "Booking failed", initiatedBy: "Admin", providerRefundId: "refund-1", providerStatus: "PENDING" } }], total: 1 });
  render(<CashfreePaymentReviews reloadKey={0} />);
  expect(await screen.findByText("Full refund authorized by Admin")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Review full refund" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Review booking confirmation" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Resume / check refund" }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/admin/cashfree/payment-reviews/payment/reconcile", { method: "POST" }));
});
