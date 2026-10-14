import { expect, test, type Page } from "@playwright/test";
import { installAuditData, registration } from "./mobile-audit.fixtures";

async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}

for (const width of [320, 393, 844]) {
  test(`event editor all six steps at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
    const missing = await installAuditData(page, "organizer");
    await page.goto("/organizer/events/audit/edit");
    for (const next of ["Schedule & rules", "Categories & tickets", "Registration form", "Add-ons", "Payment & review"]) {
      const button = page.getByRole("button", { name: `Next: ${next}`, exact: true });
      await expect(button).toBeVisible();
      await fits(page);
      await button.click();
    }
    await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeVisible();
    await fits(page);
    expect(missing).toEqual([]);
  });

  test(`guest checkout details and payment at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
    const missing = await installAuditData(page, "guest");
    await page.route(/\/api\/v1\/registrations\/(batch|payment-reference)$/, route => route.fulfill({ json: {
      ...registration,
      confirmationToken: "audit-confirmation", registrations: [registration], amountPaise: 50000,
      status: "awaiting_payment", paymentCollectionMethod: "DIRECT_UPI",
      paymentSettings: { method: "UPI", upiId: "sports@example", payeeName: "Mysuru Community Sports Association", instructions: "Pay the exact amount.", qrDataUrl: "/placeholder.svg" },
    } }));
    await page.goto("/event/audit");
    await page.getByRole("button", { name: "Add one Standard entry with event kit", exact: true }).click();
    await page.getByRole("button", { name: "Continue to registration", exact: true }).click();
    await expect(page).toHaveURL(/\/checkout\/audit$/);
    await page.getByRole("button", { name: "Continue as guest", exact: true }).click();
    await fits(page);
    // Legacy field labels currently have no associated IDs; select their adjacent input.
    await page.locator("div.space-y-2").filter({ has: page.locator("label", { hasText: /^Full name/ }) }).locator("input").fill("Alex Participant");
    await page.locator("input[type=email]").fill("alex.participant@example.com");
    await page.getByRole("checkbox", { name: "I have reviewed the event, organizer and refund details." }).check();
    await page.getByRole("button", { name: "Continue to payment", exact: true }).click();
    await expect(page.getByText("Total amount to pay", { exact: true })).toBeVisible();
    await fits(page);
    await expect(page.getByRole("button", { name: "Submit reference / continue" })).toBeVisible();
    await page.getByPlaceholder("Enter it after paying in your UPI app").fill("123456789012");
    await page.getByRole("button", { name: "Submit reference / continue" }).click();
    await expect(page).toHaveURL(/\/confirmation$/);
    await expect(page.getByText(registration.registrationReference, { exact: true }).first()).toBeVisible();
    await fits(page);
    expect(missing).toEqual([]);
  });
}
