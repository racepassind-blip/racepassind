import { expect, test } from "@playwright/test";

const event = {
  id: "mobile-event", name: "Trek to Chamundi Hills", description: "Trek to Chamundi Hills with the community.",
  sport: "trekking", eventDate: "2026-10-24", eventEndDate: null,
  location: { name: "Chamundi Hills", city: "Mysuru", state: "Karnataka" },
  status: "published", registrationStatus: "open", isArchived: false,
  categories: [{ id: "category", name: "Weekend trek", tickets: [{ id: "ticket", name: "Standard entry", pricePaise: 50000 }] }],
};
const registration = {
  id: "registration", registrationReference: "SP-2026-000123", event: { id: event.id, name: event.name },
  participant: { name: "Alex Participant", email: "alex.participant@example.com", phone: null },
  ticket: { id: "ticket", category: "Weekend trek", name: "Standard entry" }, amountPaise: 50000,
  receivedAmountPaise: null, status: "pending_verification", paymentStatus: "reference_submitted",
  createdAt: "2026-10-14T04:00:00Z", checkInStatus: "not_checked_in", utrReference: "123456789012",
  responses: {}, selections: {}, computedTotal: {}, source: "online", isManualEntry: false,
};
const dashboard = {
  event, inventory: { total: 100, sold: 20, reserved: 2, available: 78 },
  registrations: { total: 22, awaitingPayment: 0, pendingVerification: 2, confirmed: 20, checkedIn: 5 },
  overview: { confirmedParticipants: 20, totalRegistrationRecords: 22, approvedAmountPaise: 1000000,
    checkInRate: 25, signupsToday: 2, paymentSuccessRate: 90, visibility: {} },
  byCategory: [{ categoryId: "category", categoryName: "Weekend trek", capacity: 100, confirmedQuantity: 20, pendingQuantity: 2 }],
  signupTrend: [{ date: "2026-10-13", quantity: 2 }, { date: "2026-10-14", quantity: 4 }],
  recentRegistrations: [registration], byAddon: [],
};
const announcement = { id: "announcement", eventId: event.id, title: "Route update", body: "Use the north gate for check-in.", status: "PUBLISHED", scheduledFor: null, publishedAt: "2026-10-14T04:00:00Z", updatedAt: "2026-10-14T04:00:00Z", isPinned: true };
const participantRegistration = {
  id: "participant-registration", registrationReference: "SP-2026-000123", event: { id: event.id, name: event.name, date: event.eventDate, location: event.location.name, whatsappGroupUrl: null }, participantName: "Alex Participant", ticketType: { name: "Standard entry", category: "Weekend trek" }, amountPaise: 50000, currency: "INR", status: "confirmed", checkInStatus: "not_checked_in", checkedInAt: null, paymentStatus: "approved", ticket: null,
};

test.beforeEach(async ({ page }, testInfo) => {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = {};
    if (path === "/auth/me") body = { user: { id: "user", name: "Organizer Name", email: "organizer@example.com", role: testInfo.title.includes("admin") ? "admin" : testInfo.title.includes("participant") ? "participant" : "organizer" } };
    else if (path === "/registrations/me") body = [participantRegistration];
    else if (path === "/participant/announcements") body = { items: [{ event: { id: event.id, title: event.name, date: event.eventDate, location: event.location.name, organizer: "Chamundi Trail Club" }, announcement }] };
    else if (path === "/organizer/credits") body = { accounts: [{ organizationId: "organization", balancePaise: 586284 }] };
    else if (path.endsWith("/dashboard")) body = dashboard;
    else if (path === "/organizer/event-options" || path === "/organizer/events") body = [event];
    else if (path === `/organizer/events/${event.id}`) body = event;
    else if (path === `/events/${event.id}/announcements`) body = { event: { id: event.id, title: event.name, date: event.eventDate, category: event.sport }, items: [announcement], announcements: [announcement], page: 1, pageSize: 20, total: 1 };
    else if (path === `/organizer/events/${event.id}/announcements`) body = [announcement];
    else if (path === "/organizer/registrations") body = { items: [registration], nextCursor: null, hasMore: false, visibility: {} };
    else if (path.includes("/refund")) body = { refund: null };
    else if (path === "/admin/communication") body = { channel: "email", enabled: false, sender_name: "SportPass", gmail_address: "", gmail_api_configured: false };
    await route.fulfill({ json: body });
  });
});

for (const width of [320, 393, 768, 1024, 1440]) {
  test(`organizer overview and registrations fit at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [`/organizer/events/${event.id}`, `/organizer/registrations?event_id=${event.id}&status=all`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: event.name, exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const header = page.locator("header");
      const title = header.locator("p").first();
      const account = header.getByRole("button").last();
      const titleBox = await title.boundingBox();
      const accountBox = await account.boundingBox();
      expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(accountBox!.x);
      await account.click();
      await expect(page.getByRole("menuitem", { name: "All events" })).toBeVisible();
      const menuBox = await page.getByRole("menu").boundingBox();
      expect(menuBox!.x).toBeGreaterThanOrEqual(0);
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(width);
      await page.getByRole("menuitem", { name: "All events" }).focus();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      if (width === 393) await page.screenshot({ path: testInfo.outputPath(path.includes("?") ? "registrations.png" : "overview.png") });
      if (path.includes("?")) {
        if (width < 768) {
          await page.getByRole("button", { name: "View details", exact: true }).click();
        } else {
          await page.getByRole("button", { name: registration.participant.name, exact: true }).click();
        }
        await expect(page.getByRole("dialog", { name: "Registration detail" })).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        if (width === 393) await page.screenshot({ path: testInfo.outputPath("registration-card.png") });
      }
    }
  });
}

for (const width of [320, 393, 768, 1024]) {
  test(`announcement pages fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/event/${event.id}/announcements`);
    await expect(page.getByRole("heading", { name: event.name, exact: true })).toBeVisible();
    await expect(page.getByText(announcement.title, { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.goto(`/organizer/events/${event.id}/announcements`);
    await expect(page.getByRole("heading", { name: "Announcements", exact: true })).toBeVisible();
    await expect(page.getByText(announcement.title, { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

for (const role of ["participant", "admin"]) {
  test(`${role} shared header and menu fit mobile`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(role === "admin" ? "/admin/communication" : "/dashboard/profile");
    const account = page.getByRole("button", { name: "Open account menu" });
    await expect(account).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const title = await page.locator("header p").first().boundingBox();
    const button = await account.boundingBox();
    expect(title!.x + title!.width).toBeLessThanOrEqual(button!.x);
    await account.click();
    await expect(page.getByRole("menuitem", { name: "Log out" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Log out" }).focus();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("participant dashboard only presents their organizer update", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Updates for your events" })).toBeVisible();
  await expect(page.getByText("Message from Chamundi Trail Club")).toBeVisible();
  await expect(page.getByText(announcement.body, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Read all updates" })).toHaveAttribute("href", `/event/${event.id}/announcements`);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
});
