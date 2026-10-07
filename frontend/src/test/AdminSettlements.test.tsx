import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AdminSettlements, { parsePaise } from "@/pages/AdminSettlements";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiRequest: request }));
vi.mock("@/components/AdminDashboardLayout", () => ({ AdminDashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const summary = { eventId: "event-a", eventName: "Race A", organizerName: "Organizer A", paymentMode: "CASHFREE_MANAGED",
  paidRegistrationCount: 2, paidParticipantCount: 2, refundedRegistrationCount: 0, grossCollectionsPaise: 100000,
  grossOrganizerPayablePaise: 100000, refundsPaise: 0, adjustmentsPaise: 0, organizerPayablePaise: 100000,
  settledAmountPaise: 0, pendingSettlementPaise: 0, outstandingAmountPaise: 100000, availableToSettlePaise: 100000,
  recoverablePaise: 0, reservationShortfallPaise: 0 };
beforeEach(() => {
  sessionStorage.clear(); request.mockReset();
  request.mockImplementation(async (url: string) => {
    if (url.startsWith("/admin/settlement-events")) return { items: [summary, { ...summary, eventId: "event-b", eventName: "Race B" }], total: 2 };
    if (url.endsWith("settlement-summary")) return url.includes("event-b") ? { ...summary, eventId: "event-b", eventName: "Race B" } : summary;
    return { items: [], total: 0 };
  });
});
afterEach(cleanup);

it("parses exact paise and rejects rounding, exponents and overflow", () => {
  expect(parsePaise("123.45")).toBe(12345); expect(parsePaise("-0.01")).toBe(-1);
  for (const input of ["1.001", "1e3", "Infinity", "", "99999999999"]) expect(() => parsePaise(input)).toThrow();
});

it("keeps the same request key on a timeout retry and binds the selected event", async () => {
  render(<AdminSettlements />);
  fireEvent.click((await screen.findAllByRole("button", { name: "Open ledger" }))[0]);
  await screen.findByRole("button", { name: "Record settlement" });
  fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "100" } });
  const posts: { url: string; body: { idempotency_key: string } }[] = [];
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") { posts.push({ url, body: JSON.parse(options.body as string) }); throw new Error("Timeout"); }
    return original(url, options);
  });
  fireEvent.click(screen.getByRole("button", { name: "Record settlement" }));
  await screen.findByText("Timeout");
  fireEvent.click(screen.getByRole("button", { name: "Record settlement" }));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[0].body.idempotency_key).toBe(posts[1].body.idempotency_key);
  expect(posts[0].url).toBe("/admin/events/event-a/settlements");
});

it("discards pending edits when selecting another event", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === "/admin/events/event-a/settlements") return { items: [{ id: "transfer-a", version: 1, amountPaise: 10000,
      method: "UPI", referenceNumber: "ABC", settlementDate: "2026-10-07", status: "PENDING", notes: null }] };
    return original(url, options);
  });
  render(<AdminSettlements />);
  fireEvent.click((await screen.findAllByRole("button", { name: "Open ledger" }))[0]);
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText("Amount (₹)")).toHaveValue("100");
  fireEvent.click(screen.getByRole("button", { name: "Back to events" }));
  fireEvent.click((await screen.findAllByRole("button", { name: "Open ledger" }))[1]);
  await screen.findByText("Race B");
  expect(screen.getByLabelText("Amount (₹)")).toHaveValue("");
  expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
});
