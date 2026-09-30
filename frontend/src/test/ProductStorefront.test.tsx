import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProductStorefront from "@/pages/ProductStorefront";
import { apiRequest } from "@/lib/api";
vi.mock("@/components/Layout", () => ({ Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ listingId: "store" }) }));
vi.mock("@/lib/api", () => ({ apiRequest: vi.fn() }));
const listing = { name: "Race store", status: "published", catalog: { max_units_per_order: 5, pickup_instructions: "Race village", products: [{ id: "jersey", name: "Race jersey", image_ids: ["front", "back"], size_chart_image_id: "chart", variants: [{ id: "s", label: "S", stock: 0, price_paise: 10000 }, { id: "m", label: "M", stock: 1, price_paise: 12000 }] }] }, images: { front: "/front.png", back: "/back.png", chart: "/actual-chart.png" } };
beforeEach(() => vi.mocked(apiRequest).mockResolvedValue(listing));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it.each(["ORGANIZER", "PARTICIPANT"])("shows a separate product fee only when the buyer pays (%s)", async (bearer) => {
  vi.mocked(apiRequest).mockResolvedValue({ ...listing, fee_bearer: bearer, price_previews: { m: { platformFeePaise: 2000, participantTotalPaise: bearer === "PARTICIPANT" ? 14000 : 12000 } } });
  render(<ProductStorefront />);
  await screen.findByText("Race jersey");
  if (bearer === "PARTICIPANT") {
    expect(screen.getByText("₹140 total for one item")).toBeInTheDocument();
    expect(screen.getByText("₹120 + ₹20 SportPass fee")).toBeInTheDocument();
  } else {
    expect(screen.queryByText(/SportPass fee/)).not.toBeInTheDocument();
    expect(screen.getByText("₹120")).toBeInTheDocument();
  }
});
it("shows all gallery photos and opens the persisted size chart after remount", async () => {
  const view = render(<ProductStorefront />);
  fireEvent.click(await screen.findByRole("button", { name: "View Race jersey photo 2" }));
  expect(screen.getByAltText("Race jersey")).toHaveAttribute("src", "/back.png");
  expect(screen.getByAltText("Race jersey")).toHaveAttribute("loading", "lazy");
  fireEvent.click(screen.getByRole("button", { name: "View Size Chart" }));
  expect(screen.getByAltText("Race jersey — Size chart")).toHaveAttribute("src", "/actual-chart.png");
  view.unmount(); render(<ProductStorefront />);
  fireEvent.click(await screen.findByRole("button", { name: "View Size Chart" }));
  expect(screen.getByAltText("Race jersey — Size chart")).toHaveAttribute("src", "/actual-chart.png");
});
it("paginates a large catalog without losing cart selections", async () => {
  const products = Array.from({ length: 25 }, (_, index) => ({
    id: `product-${index + 1}`,
    name: `Product ${index + 1}`,
    image_ids: ["front"],
    variants: [{ id: `variant-${index + 1}`, label: "One size", stock: 10, price_paise: 10000 }],
  }));
  vi.mocked(apiRequest).mockResolvedValue({ ...listing, catalog: { ...listing.catalog, products } });
  render(<ProductStorefront />);
  expect(await screen.findByText("Product 1")).toBeInTheDocument();
  expect(screen.getByText("Product 12")).toBeInTheDocument();
  expect(screen.queryByText("Product 13")).not.toBeInTheDocument();
  expect(screen.getByText("Showing 1–12 of 25 products")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add Product 1 One size" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Product 13")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add Product 1 One size" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "1 item selected" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Product 25")).toBeInTheDocument();
  expect(screen.getByText("Showing 25–25 of 25 products")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(screen.getByRole("button", { name: "Remove Product 1 One size" })).toBeEnabled();
});
it("disables unavailable sizes and stops adding at variant stock", async () => {
  render(<ProductStorefront />);
  expect(await screen.findByRole("button", { name: "S — sold out" })).toBeDisabled();
  expect(screen.getByRole("main")).toHaveClass("max-w-6xl");
  const add = screen.getByRole("button", { name: "Add Race jersey M" });
  fireEvent.click(add);
  expect(add).toBeDisabled();
  expect(screen.getByRole("button", { name: "Remove Race jersey M" })).toBeEnabled();
  expect(screen.getByRole("heading", { name: "1 item selected" })).toBeInTheDocument();
  expect(screen.getByText("1 of 5 items allowed in one order")).toBeInTheDocument();
});
it("provides a retry instead of an endless loading screen", async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error("Unavailable"));
  render(<ProductStorefront />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Race jersey")).toBeInTheDocument();
});
it("prevents purchases from a closed store", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ ...listing, status: "closed" });
  render(<ProductStorefront />);
  expect(await screen.findByRole("button", { name: "Add Race jersey M" })).toBeDisabled();
});
it("shows the generated order ID and asks the buyer to save it", async () => {
  const orderId = "a931e32d-b644-4dde-b992-5e10426a9f48";
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (path?.endsWith("/quote")) return { subtotal_paise: 12000, platform_fee_paise: 0, total_paise: 12000, fee_bearer: "organizer" };
    if (path?.endsWith("/orders")) return { id: orderId, status: "awaiting_payment", snapshot: { subtotal_paise: 12000, platform_fee_paise: 0, total_paise: 12000, fee_bearer: "organizer", payment: { qrDataUrl: "/qr.png", amountPaise: 12000 } } };
    return listing;
  });
  render(<ProductStorefront />);
  fireEvent.click(await screen.findByRole("button", { name: "Add Race jersey M" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Test Buyer" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
  fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "9876543210" } });
  await waitFor(() => expect(screen.getByRole("button", { name: /Continue to payment/ })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: /Continue to payment/ }));
  expect(await screen.findByText(orderId)).toBeInTheDocument();
  expect(screen.getByText("SPM-A931E32DB644")).toBeInTheDocument();
  const paymentReference = screen.getByLabelText("UTR / transaction reference (required)");
  expect(paymentReference).toBeRequired();
  expect(screen.getByRole("button", { name: "I’ve paid — submit reference" })).toBeDisabled();
  fireEvent.change(paymentReference, { target: { value: "    " } });
  expect(screen.getByRole("button", { name: "I’ve paid — submit reference" })).toBeDisabled();
  fireEvent.change(paymentReference, { target: { value: "UTR12345678" } });
  expect(screen.getByRole("button", { name: "I’ve paid — submit reference" })).toBeEnabled();
  expect(screen.getByText(/Save this number for order help or collection/)).toBeInTheDocument();
  const orderCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path?.endsWith("/orders"));
  expect(orderCall).toBeDefined();
  const body = JSON.parse(String(orderCall![1]?.body));
  expect(body).not.toHaveProperty("delivery_pincode");
  expect(body).not.toHaveProperty("delivery_address");
});
