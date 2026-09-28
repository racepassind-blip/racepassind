import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MerchQrDownload } from "@/components/products/MerchQrDownload";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("downloads the supplied order QR as PNG without opening a UPI link", async () => {
  const sources: string[] = [];
  vi.stubGlobal("Image", class {
    onload = () => {};
    set src(value: string) { sources.push(value); this.onload(); }
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  const blob = new Blob(["png"], { type: "image/png" });
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(blob));
  const create = vi.fn().mockReturnValue("blob:qr");
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
  const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe("sportpass-merch-qr-order-123.png");
    expect(this.href).toBe("blob:qr");
  });
  render(<MerchQrDownload qrDataUrl="data:image/svg+xml;base64,order-specific" orderId="order-123" />);
  fireEvent.click(screen.getByRole("button", { name: "Download QR image" }));
  await screen.findByRole("status");
  expect(sources).toEqual(["data:image/svg+xml;base64,order-specific"]);
  expect(download).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledWith(blob);
  expect(screen.queryByRole("link", { name: "Open UPI app" })).not.toBeInTheDocument();
});

it("shows a retryable error when the browser cannot create a QR image", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  render(<MerchQrDownload qrDataUrl="data:image/svg+xml;base64,qr" orderId="order-123" />);
  fireEvent.click(screen.getByRole("button", { name: "Download QR image" }));
  await screen.findByRole("alert");
  await waitFor(() => expect(screen.getByRole("button", { name: "Download QR image" })).toBeEnabled());
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
