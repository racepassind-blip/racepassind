import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminBills, BillDocument, type Bill } from "@/components/AdminBills";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiRequest: request }));
afterEach(cleanup);
beforeEach(() => { sessionStorage.clear(); request.mockReset(); });
const fixture: Bill = { id: 1, number: "SPI-2026-000001", totalPaise: 9000, status: "PENDING", paymentReference: null, paidOn: null,
  details: { organization_id: "org", event_id: null, kind: "CREDITS", issuer_name: "SportPass India", issuer_email: "billing@example.test", issuer_phone: "+919000000000", issuer_address: "Business address", customer_name: "Client", customer_address: "Client address", issue_date: "2026-01-01", due_date: null, lines: [{ description: "Credits", quantity: 100, unit_paise: 100 }], discount_paise: 1000, notes: "" } };

it("shows amount due for pending bills and zero due for paid bills; escapes supplied text", () => {
  const bill = { ...fixture, details: { ...fixture.details, customer_name: '<script>alert("x")</script>' } };
  const { container, rerender } = render(<BillDocument bill={bill} />);
  expect(container.querySelector(".bill-due")).toHaveTextContent("₹90.00");
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByText('<script>alert("x")</script>')).toBeVisible();
  expect(screen.getByRole("img", { name: "SportPass India" })).toHaveAttribute("src", expect.stringContaining("/sportpass-mark.svg"));
  rerender(<BillDocument bill={{ ...bill, status: "PAID", paymentReference: "BANK-1", paidOn: "2026-01-02" }} />);
  expect(container.querySelector(".bill-due")).toHaveTextContent("₹0.00");
  expect(screen.getByText(/Reference: BANK-1/)).toBeVisible();
});

it("previews before issuing and retries the same bill safely without touching Credits", async () => {
  const posts: Record<string, unknown>[] = [];
  request.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (opts?.method === "POST") {
      expect(url).toBe("/admin/bills"); posts.push(JSON.parse(opts.body as string));
      if (posts.length === 1) throw new Error("Request timed out");
      return fixture;
    }
    if (url.includes("/customer/")) return { name: "Client", address: "Client address", events: [], issuer: { issuer_phone: "+919000000000", issuer_address: "Business address" } };
    return { items: [], total: 0 };
  });
  render(<AdminBills organizers={[{ id: "org", name: "Client" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Raise bill" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Organizer"), { target: { value: "org" } });
  await waitFor(() => expect(dialog.getByLabelText("Client / billing name")).toHaveValue("Client"));
  fireEvent.change(dialog.getByLabelText("Quantity"), { target: { value: "100" } });
  fireEvent.change(dialog.getByLabelText("Rate (₹)"), { target: { value: "1" } });
  fireEvent.click(dialog.getByRole("button", { name: "Review bill" }));
  expect(dialog.getByText("DRAFT — NOT ISSUED")).toBeVisible();
  expect(posts).toHaveLength(0);
  fireEvent.click(dialog.getByRole("button", { name: "Issue bill" }));
  await dialog.findByText("Request timed out");
  fireEvent.click(dialog.getByRole("button", { name: "Issue bill" }));
  await screen.findByRole("button", { name: "Print / Save PDF" });
  expect(posts).toHaveLength(2);
  expect(posts[0].idempotency_key).toBe(posts[1].idempotency_key);
  expect(posts[0].status).toBe("PENDING");
  expect(posts[0].lines).toEqual([{ description: "SportPass Credits supplied", quantity: 100, unit_paise: 100 }]);
  expect(request.mock.calls.some(([url]) => String(url).includes("/credits/"))).toBe(false);
});

it("collects payment date and reference before marking a pending bill paid", async () => {
  request.mockImplementation(async (_url: string, opts?: RequestInit) => opts?.method === "PATCH" ? { ...fixture, status: "PAID", paymentReference: "BANK-1", paidOn: "2026-01-02" } : { items: [fixture], total: 1 });
  render(<AdminBills organizers={[]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Mark paid" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Payment reference"), { target: { value: "BANK-1" } });
  fireEvent.change(dialog.getByLabelText("Payment date"), { target: { value: "2026-01-02" } });
  fireEvent.click(dialog.getByRole("button", { name: "Mark paid" }));
  await screen.findByRole("button", { name: "Print / Save PDF" });
  expect(request).toHaveBeenCalledWith("/admin/bills/1", { method: "PATCH", body: JSON.stringify({ status: "PAID", payment_reference: "BANK-1", paid_on: "2026-01-02" }) });
});
