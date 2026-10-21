import { expect, test } from "@playwright/test";

for (const width of [393, 1440]) {
  test(`admin issues and prints a professional bill at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => { window.print = () => {}; });
    const bills: Record<string, unknown>[] = [];
    await page.route("**/api/v1/**", async route => {
      const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
      let body: unknown = {};
      if (path === "/auth/me") body = { user: { id: "admin", name: "Admin", email: "admin@example.test", role: "admin", mfaEnabled: true }, csrfToken: "test" };
      else if (path === "/auth/csrf") body = { csrfToken: "test" };
      else if (path === "/admin/transactions/options") body = { organizers: [{ id: "org", name: "Example Athletics Club" }], events: [] };
      else if (path === "/admin/cashfree/payment-reviews") body = { items: [], total: 0 };
      else if (path === "/admin/credits/ledger") body = { items: [], total: 0, organizerOptions: [{ id: "org", name: "Example Athletics Club" }], eventOptions: [] };
      else if (path === "/admin/credits/topups") body = { items: [], total: 0, summary: { total: 0, pending: 0, approvedCreditsPaise: 0 } };
      else if (path === "/admin/credits/payment-settings") body = { method: "UPI", payeeName: "SportPass India", upiId: "" };
      else if (path === "/admin/bills/customer/org") body = { name: "Example Athletics Club", address: "24 Example Road, Mysuru, Karnataka 570001", events: [], issuer: {} };
      else if (path === "/admin/bills" && route.request().method() === "POST") {
        const data = route.request().postDataJSON();
        body = { id: 1, number: "SPI-2026-000001", details: data, totalPaise: 90000, status: data.status, paymentReference: data.payment_reference, paidOn: data.paid_on };
        bills.push(body as Record<string, unknown>);
      } else if (path === "/admin/bills") body = { items: bills, total: bills.length };
      await route.fulfill({ json: body });
    });
    await page.goto("/admin/credits");
    await page.getByRole("button", { name: "Raise bill" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Organizer", { exact: true }).selectOption("org");
    await expect(dialog.getByLabel("Client / billing name")).toHaveValue("Example Athletics Club");
    await dialog.getByLabel("Phone", { exact: true }).fill("+91 90000 00000");
    await dialog.getByLabel("Business address", { exact: true }).fill("Example business address, Mysuru, Karnataka");
    await dialog.getByLabel("Quantity", { exact: true }).fill("1000");
    await dialog.getByLabel("Rate (₹)", { exact: true }).fill("1");
    await dialog.getByLabel("Bill discount (₹)").fill("100");
    await dialog.getByRole("button", { name: "Review bill", exact: true }).click();
    await expect(dialog.getByText("DRAFT — NOT ISSUED")).toBeVisible();
    await expect(dialog.locator(".bill-due")).toContainText("₹900.00");
    await dialog.getByRole("button", { name: "Issue bill", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Bill SPI-2026-000001" })).toBeVisible();
    await expect(dialog.locator(".bill-brand img")).toBeVisible();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await dialog.screenshot({ path: testInfo.outputPath(`bill-${width}.png`) });
    await dialog.getByRole("button", { name: "Print / Save PDF" }).click();
    const frame = page.frameLocator('iframe[title="Print bill"]');
    await expect(frame.locator(".bill-heading")).toContainText("SPI-2026-000001");
    await expect(frame.locator(".bill-due")).toContainText("₹900.00");
  });
}
