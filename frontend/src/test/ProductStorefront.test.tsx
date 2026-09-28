import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  fireEvent.click(screen.getByRole("button", { name: "View Size Chart" }));
  expect(screen.getByAltText("Race jersey — Size chart")).toHaveAttribute("src", "/actual-chart.png");
  view.unmount(); render(<ProductStorefront />);
  fireEvent.click(await screen.findByRole("button", { name: "View Size Chart" }));
  expect(screen.getByAltText("Race jersey — Size chart")).toHaveAttribute("src", "/actual-chart.png");
});
it("disables unavailable sizes and stops adding at variant stock", async () => {
  render(<ProductStorefront />);
  expect(await screen.findByRole("button", { name: "S — sold out" })).toBeDisabled();
  const add = screen.getByRole("button", { name: "Add Race jersey M" });
  fireEvent.click(add);
  expect(add).toBeDisabled();
  expect(screen.getByRole("button", { name: "Remove Race jersey M" })).toBeEnabled();
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
