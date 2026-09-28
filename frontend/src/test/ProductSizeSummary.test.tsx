import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { ProductSizeSummary } from "@/components/products/ProductSizeSummary";
it("shows unit counters separately for each product and includes zero-stock sizes", () => {
  render(<ProductSizeSummary summary={{ products: [{ id: "jersey", name: "Race jersey", variants: [{ id: "m", label: "M", available: 10, awaiting_payment: 2, under_review: 3, confirmed: 4, fulfilled: 5 }, { id: "l", label: "L", available: 0, awaiting_payment: 0, under_review: 0, confirmed: 0, fulfilled: 0 }] }, { id: "cap", name: "Race cap", variants: [{ id: "standard", label: "Standard", available: 20, awaiting_payment: 0, under_review: 0, confirmed: 1, fulfilled: 0 }] }] }} />);
  const jersey = screen.getByRole("table", { name: "Race jersey quantities by option or size" });
  expect(within(jersey).getByRole("cell", { name: "9", exact: true })).toBeInTheDocument();
  expect(within(jersey).getByText("0 · Sold out")).toBeInTheDocument();
  expect(screen.getByText("9 paid · 10 available")).toBeInTheDocument();
  expect(screen.getByText("1 paid · 20 available")).toBeInTheDocument();
});
