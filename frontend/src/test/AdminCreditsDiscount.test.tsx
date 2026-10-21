import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AdminCredits from "@/pages/AdminCredits";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiRequest: request }));
vi.mock("@/components/AdminDashboardLayout", () => ({ AdminDashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
afterEach(cleanup);

it("retries a timed-out discount with the same key, refreshes totals and uses a new key for another discount", async () => {
  sessionStorage.clear();
  const posts: Record<string, unknown>[] = [];
  let discount = 0;
  request.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.startsWith("/admin/bills")) return { items: [], total: 0 };
    if (options?.method === "POST") {
      posts.push(JSON.parse(options.body as string));
      if (posts.length === 1) throw new Error("Timeout");
      discount += 10000;
      return {};
    }
    if (url.endsWith("/summary")) return { eventId: "event-a", eventName: "Run", registrationCount: 25, confirmedParticipantCount: 25, calculatedFeePaise: 50000, chargedPaise: 50000, discountPaise: discount, netFeePaise: 50000 - discount, availablePaise: 50000 + discount };
    if (url.includes("/ledger")) return { items: [], total: 0, organizerOptions: [], eventOptions: [{ id: "event-a", name: "Run" }] };
    if (url.includes("/topups")) return { items: [], total: 0, summary: { total: 0, pending: 0, approvedCreditsPaise: 100000 } };
    return { method: "UPI", payeeName: "Test", upiId: "test@upi" };
  });
  render(<MemoryRouter initialEntries={["/?event_id=event-a"]}><AdminCredits view="ledger" /></MemoryRouter>);
  await screen.findByRole("button", { name: "Give discount" });
  const fill = () => {
    fireEvent.change(screen.getByLabelText("Discount amount in rupees"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Discount reason"), { target: { value: "Courtesy" } });
  };
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Give discount" }));
  await screen.findByText("Timeout");
  fireEvent.click(screen.getByRole("button", { name: "Give discount" }));
  await screen.findByText("Discount returned to the organizer’s Credits.");
  await screen.findByText("₹400");
  expect(posts[0].idempotency_key).toBe(posts[1].idempotency_key);
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Give discount" }));
  await waitFor(() => expect(posts).toHaveLength(3));
  expect(posts[2].idempotency_key).not.toBe(posts[1].idempotency_key);
  await screen.findByText("₹300");
});
