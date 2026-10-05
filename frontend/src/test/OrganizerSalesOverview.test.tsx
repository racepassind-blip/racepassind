import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { OrderDashboard, StorefrontDirectory, type MerchandiseOrder } from "@/components/products/OrganizerSalesOverview";
afterEach(cleanup);
it("requires confirmation to cancel an awaiting-payment order", () => {
  const order = { ...orders[0], status: "awaiting_payment" };
  const decide = vi.fn().mockResolvedValue(undefined);
  render(<OrderDashboard orders={[order]} onDecision={decide} onRefresh={vi.fn()} busy={false} error="" />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
  expect(decide).not.toHaveBeenCalled();
  expect(screen.getByText(/refund the buyer separately/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  expect(decide).toHaveBeenCalledWith(order, "cancel");
});
it("allows an organizer to archive an expired order after confirmation", () => {
  const order = { ...orders[0], status: "expired" };
  const onDelete = vi.fn().mockResolvedValue(undefined);
  render(<OrderDashboard orders={[order]} onDecision={vi.fn()} onDelete={onDelete} onRefresh={vi.fn()} busy={false} error="" />);
  fireEvent.click(screen.getByRole("button", { name: "Archive order" }));
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Archive order" }));
  expect(onDelete).toHaveBeenCalledWith(order);
});
it("finds merchandise orders by the new number, legacy number, and full ID", () => {
  const order = { ...orders[0], id: "b899bc76-14f9-4c8e-975e-c0fcacc09dad" };
  render(<OrderDashboard orders={[order]} onDecision={vi.fn()} onRefresh={vi.fn()} busy={false} error="" />);
  for (const query of ["SPM-B899BC7614F9", "SP-B899BC7614F9", order.id]) {
    fireEvent.change(screen.getByLabelText("Search orders"), { target: { value: query } });
    expect(screen.getByText("SPM-B899BC7614F9")).toBeVisible();
    expect(screen.getByText(order.buyer_name)).toBeVisible();
  }
});
const orders: MerchandiseOrder[] = Array.from({ length: 12 }, (_, index) => ({ id: `order-${index}`, buyer_name: `Runner ${index}`, buyer_email: `runner${index}@test.com`, buyer_phone: "1234567890", status: index === 0 ? "under_review" : "confirmed", payment_reference: "UTR123", snapshot: { total_paise: 15000, lines: [{ product_name: "Race jersey", variant_label: "M", quantity: 1, customization: "Alex" }] } }));
it("filters and paginates orders, and confirms rejection before submitting", () => {
  const onDecision = vi.fn().mockResolvedValue(undefined);
  render(<OrderDashboard orders={orders} onDecision={onDecision} onRefresh={vi.fn()} busy={false} error="" />);
  expect(screen.getByText("SPM-ORDER0")).toBeInTheDocument();
  expect(screen.queryByText("Runner 11")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Runner 11")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Order status"), { target: { value: "under_review" } });
  expect(screen.getByText("Runner 0")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reject", exact: true }));
  expect(onDecision).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
  expect(onDecision).toHaveBeenCalledWith(orders[0], "reject");
  fireEvent.change(screen.getByLabelText("Search orders"), { target: { value: "missing" } });
  expect(screen.getByText("No orders match your filters.")).toBeInTheDocument();
});
it("searches and paginates many storefronts", () => {
  const stores = Array.from({ length: 12 }, (_, index) => ({ id: String(index), name: `Race store ${index}`, status: index === 11 ? "closed" : "published", catalog: { products: [{ variants: [{ stock: 5 }] }] } }));
  const onCreate = vi.fn();
  render(<MemoryRouter><StorefrontDirectory stores={stores} onCreate={onCreate} /></MemoryRouter>);
  expect(screen.queryByText("Race store 11")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Race store 11")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Storefront status"), { target: { value: "closed" } });
  expect(screen.getAllByText("Manage store →")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Search storefronts"), { target: { value: "missing" } });
  expect(screen.getByText("No storefronts match your search.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create storefront" }));
  expect(onCreate).toHaveBeenCalledOnce();
});

it("shows the next action and inventory for each storefront", () => {
  const stores = [
    { id: "draft", name: "New store", status: "draft", catalog: { products: [] } },
    { id: "orders", name: "Race shop", status: "published", catalog: { products: [{ variants: [{ stock: 8 }] }] }, order_summary: { payment_review: 2, ready_for_pickup: 1 } },
  ];
  render(<MemoryRouter><StorefrontDirectory stores={stores} onCreate={vi.fn()} /></MemoryRouter>);
  expect(screen.getByText("Add products to finish setting up this store")).toBeInTheDocument();
  expect(screen.getByText("2 payments to review")).toBeInTheDocument();
  expect(screen.getByText(/8 units available · 1 ready for pickup/)).toBeInTheDocument();
});
