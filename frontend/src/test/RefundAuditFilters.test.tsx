import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RefundAuditFilters } from "@/components/RefundAuditFilters";

const download = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/api", () => ({ downloadApiFile: download }));
afterEach(() => { cleanup(); download.mockClear(); });

it("exports selected refund date and event filters without page limits", async () => {
  render(<RefundAuditFilters value={{ date_from: "2026-10-01", date_to: "2026-10-17", date_field: "completed" }} onChange={vi.fn()} endpoint="/organizer/refunds" filters={{ event_id: "event-one", refund_status: "REFUNDED" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Export filtered refunds" }));
  await waitFor(() => expect(download).toHaveBeenCalled());
  const url = new URL(download.mock.calls[0][0], "https://example.test");
  expect(url.searchParams.get("date_field")).toBe("completed");
  expect(url.searchParams.get("date_from")).toBe("2026-10-01");
  expect(url.searchParams.get("date_to")).toBe("2026-10-17");
  expect(url.searchParams.get("event_id")).toBe("event-one");
  expect(url.searchParams.get("refund_status")).toBe("REFUNDED");
  expect(url.searchParams.get("export_csv")).toBe("true");
  expect(url.searchParams.has("cursor")).toBe(false);
});

it("blocks exporting an inverted date range", () => {
  render(<RefundAuditFilters value={{ date_from: "2026-10-17", date_to: "2026-10-01", date_field: "requested" }} onChange={vi.fn()} endpoint="/admin/refunds" filters={{}} />);
  expect(screen.getByRole("button", { name: "Export filtered refunds" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Start date");
});
