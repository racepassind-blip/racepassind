import { expect, test } from "@playwright/test";
import { installAuditData } from "./mobile-audit.fixtures";

const routes = {
  guest: ["/", "/events", "/merchandise", "/login", "/signup", "/forgot-password", "/reset-password", "/organizers", "/federations-associations", "/event/audit", "/event/audit/results", "/event/audit/number-list", "/checkout/audit/ticket", "/confirmation", "/products/store", "/terms-and-conditions", "/privacy-policy", "/terms-of-service", "/our-story", "/missing-page"],
  participant: ["/dashboard", "/dashboard/registrations", "/dashboard/upcoming", "/dashboard/past", "/dashboard/profile"],
  organizer: ["/organizer", "/organizer/check-in?event_id=audit", "/organizer/registrations?event_id=audit&status=all", "/organizer/events/new", "/organizer/products", "/organizer/products/store", "/organizer/events/audit", "/organizer/events/audit/edit", "/organizer/events/audit/checkpoints", "/organizer/events/audit/check-in", "/organizer/events/audit/communications", "/organizer/events/audit/participants/new", "/organizer/events/audit/allocations", "/organizer/events/audit/race-results", "/organizer/setup", "/organizer/refunds", "/organizer/credits", "/organizer/events/audit/refunds", ...["", "/matches", "/scoring", "/results", "/bracket"].map(suffix => `/organizer/events/audit/tournament${suffix}`)],
  admin: ["/admin/mfa", "/admin", "/admin/communication", "/admin/events", "/admin/event-features", "/admin/organizer-fees", "/admin/organizer-applications", "/admin/organizers", "/admin/organizers/org/events", "/admin/refunds", "/admin/credits", "/admin/organizer-pricing", "/admin/settlements"],
} as const;

for (const width of [320, 393, 430, 844]) {
  for (const [role, paths] of Object.entries(routes)) {
    for (const path of paths) {
      test(`${width}px ${role} ${path}`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const missing = await installAuditData(page, role as keyof typeof routes, path.includes("tournament") ? "badminton" : "running");
        await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await expect(page.locator("body")).not.toHaveText("");
        expect(errors, "Browser runtime errors").toEqual([]);
        expect(missing, "Every requested endpoint must have an explicit fixture").toEqual([]);
        expect(new URL(page.url()).pathname, "Page must not redirect to a login or locked screen").toBe(path.split("?")[0]);
        // Record the source of overflowing content, rather than masking it with overflow:hidden.
        const overflow = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          elements: [...document.querySelectorAll("body *")].filter((element) => {
            const rect = element.getBoundingClientRect();
            if (!rect.width || rect.right <= innerWidth + 1) return false;
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
              if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(parent).overflowX)) return false;
            }
            return true;
          }).slice(0, 12).map(element => ({ tag: element.tagName, class: element.className, text: element.textContent?.slice(0, 70) })),
        }));
        if (overflow.width > width) await testInfo.attach("overflow", { body: JSON.stringify(overflow, null, 2), contentType: "application/json" });
        expect(overflow.width, JSON.stringify(overflow.elements)).toBeLessThanOrEqual(width);
        const clippedButtons = await page.locator("button").evaluateAll(buttons => buttons.filter(button => {
          if (!button.getBoundingClientRect().width || button.getAttribute("role") === "combobox") return false;
          return button.scrollWidth > button.clientWidth + 2;
        }).map(button => button.textContent?.trim()));
        expect(clippedButtons, "Button labels must fit their touch targets").toEqual([]);
        const header = page.locator("header").first();
        if (await header.isVisible()) {
          const account = header.getByRole("button", { name: "Open account menu" });
          if (await account.count()) {
            const title = await header.locator("p").first().boundingBox();
            const button = await account.boundingBox();
            expect(title!.x + title!.width).toBeLessThanOrEqual(button!.x);
          }
        }
      });
    }
  }
}
