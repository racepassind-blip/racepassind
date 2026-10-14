import type { Page } from "@playwright/test";

export const title = "Mysuru Community Sports Festival and Championship 2026";
const date = "2026-12-24";
const category = { id: "category", name: "Open championship category", distance: "10 km", description: "Community entry", entryType: "singles", participantsPerEntry: 1,
  tickets: [{ id: "ticket", name: "Standard entry with event kit", description: "Event entry", pricePaise: 50000, currency: "INR", quantityTotal: 100, quantitySold: 20, quantityReserved: 2, available: 78 }] };
export const organization = { id: "org", name: "Mysuru Community Sports Association", city: "Mysuru", state: "Karnataka", organizationType: "sports_club", description: "Community sports", website: "", logoUrl: null, status: "active", allowDirectUpi: true, allowCashfree: false };
const payment = { method: "UPI", upiId: "sports@example", payeeName: organization.name, instructions: "Pay the exact amount.", qrImageUrl: null };
const fields = [{ id: "full_name", label: "Full name", type: "text", required: true, predefined: true, order: 1 }, { id: "email", label: "Email", type: "email", required: true, predefined: true, order: 2 }];
export const event = { id: "audit", organizationId: "org", name: title, sport: "running", description: "Join our community for a day of sport and friendly competition.", eventDate: date, eventEndDate: null, location: { name: "Chamundi Hills community sports grounds", city: "Mysuru", state: "Karnataka", address: "Main entrance, community sports grounds", country: "India" }, bannerUrl: "/placeholder.svg", status: "published", registrationStatus: "open", isArchived: false, participants: 20, totalParticipants: 20, lockedParticipants: 0, maxParticipants: 100, rules: ["Please arrive before the start."], schedule: [{ time: "07:00", label: "Start" }], categories: [category], fieldConfig: { fields }, addonConfig: { addons: [] }, paymentSettings: payment, paymentCollectionMethod: "DIRECT_UPI", platformFeeBearer: "ORGANIZER", sportConfig: { tournament_format: "knockout" } };
export const publicEvent = { ...event, title, date, location: event.location.name, locationDetails: event.location, category: "running", image: "/placeholder.svg", distance: "10 km", organizer: organization.name, organizerInfo: { name: organization.name, logoUrl: null }, tiers: [{ id: "ticket", name: category.tickets[0].name, description: "Entry and event kit", price: 500, available: 78 }] };
export const registration = { id: "registration", registrationReference: "SP-2026-000123", event: { id: "audit", name: title, date, location: event.location.name }, participant: { name: "Alex Participant", email: "alex.participant@example.com", phone: "9876543210" }, participantName: "Alex Participant", participantCount: 1, ticket: { ...category.tickets[0], category: category.name }, ticketType: { name: category.tickets[0].name, category: category.name }, amountPaise: 50000, receivedAmountPaise: null, currency: "INR", status: "pending_verification", paymentStatus: "reference_submitted", checkInStatus: "not_checked_in", createdAt: "2026-10-14T04:00:00Z", utrReference: "123456789012", responses: {}, selections: {}, computedTotal: {}, source: "online", isManualEntry: false };
const visibility = { isLocked: false, totalConfirmedQuantity: 20, visibleConfirmedQuantity: 20, lockedConfirmedQuantity: 0, visibleConfirmedRecords: 20, visibleCheckedInRecords: 5, visibleCheckedInQuantity: 5, visibleApprovedAmountPaise: 1000000 };
const dashboard = { event, inventory: { total: 100, sold: 20, reserved: 2, available: 78 }, registrations: { total: 22, awaitingPayment: 0, pendingVerification: 2, confirmed: 20, checkedIn: 5, rejected: 0, expired: 0 }, payments: {}, overview: { confirmedParticipants: 20, totalRegistrationRecords: 22, approvedAmountPaise: 1000000, checkInRate: 25, signupsToday: 2, paymentSuccessRate: 90, visibility }, byCategory: [{ categoryId: "category", categoryName: category.name, capacity: 100, confirmedQuantity: 20, pendingQuantity: 2 }], byTicket: [], signupTrend: [{ date: "2026-10-13", quantity: 2 }, { date: "2026-10-14", quantity: 4 }], recentRegistrations: [registration], byAddon: [] };
export const listing = { id: "store", organization_id: "org", name: "Community event merchandise and meals", description: "Event-day essentials", status: "published", fee_bearer: "ORGANIZER", upi_id: payment.upiId, payee_name: payment.payeeName, organizer: { name: organization.name }, has_orders: false, images: {}, catalog: { listing_type: "products", fulfillment: "pickup", max_units_per_order: 10, pickup_instructions: "Collect at the main entrance.", products: [{ id: "product", name: "Community race jersey", description: "Event jersey", active: true, image_ids: [], size_chart_image_id: null, customization_label: null, variants: [{ id: "variant", label: "Medium", price_paise: 50000, stock: 20, options: {} }] }] } };
const pageData = { items: [], total: 0, page: 1, pageSize: 50, hasMore: false, nextCursor: null };
const organizerRow = { ...organization, organizationId: "org", organizationName: organization.name, responsiblePerson: "Alex Participant", email: "alex.participant@example.com", phone: "9876543210", createdAt: "2026-10-01", eventsTotal: 1, eventsPublished: 1, totalParticipants: 20, approvedRevenuePaise: 1000000, paidVerificationStatus: "UNDER_REVIEW", feeType: "fixed", feeValuePaise: 2000, feePercentageBasisPoints: 400, currency: "INR", collectionStatus: "not_collected", platformPricing: { mode: "DEFAULT", percentageBasisPoints: 400, minimumFeePaise: 2000, maximumFeePaise: 6000, fixedFeePaise: 2000 } };
const adminEvent = { ...event, organization, participantCount: 20, featuresUnlocked: true };

export async function installAuditData(page: Page, role: "guest" | "participant" | "organizer" | "admin", sport = "running") {
  const missing: string[] = [];
  await page.addInitScript(() => sessionStorage.setItem("sportpass_confirmation_token", "audit-confirmation"));
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    const currentEvent = { ...event, sport };
    let body: unknown;
    if (path === "/auth/me") {
      if (role === "guest") { await route.fulfill({ status: 401, json: { detail: "Not signed in" } }); return; }
      body = { user: { id: "user", name: "Alex Participant", email: "alex.participant@example.com", role, mfaEnabled: false, mfaRequired: false } };
    } else if (path === "/auth/csrf") body = { csrfToken: "test" };
    else if (path === "/events/search") body = { items: [publicEvent], total: 1, page: 1, pageSize: 12, sports: ["running"], cities: ["Mysuru"] };
    else if (path === "/events") body = [publicEvent];
    else if (path === "/events/audit") body = { ...publicEvent, category: sport };
    else if (path === "/events/audit/number-list") body = { event: { ...publicEvent, sport }, numberLabel: "Bib", categories: [category], entries: [{ allocationNumber: 101, displayName: "Alex Participant", categoryName: category.name }] };
    else if (path === "/events/audit/race-results") body = { eventId: "audit", eventName: title, sport, resultSetStatus: "published", categories: [{ categoryId: "category", categoryName: category.name, distance: "10 km", participantCount: 1, entries: [{ rank: 1, participantName: "Alex Participant", bibNumber: 101, resultStatus: "Finished", finishTimeHhmmss: "00:45:00", paceDisplay: "4:30 /km" }] }] };
    else if (path === "/products" || path === "/organizer/product-listings") body = [listing];
    else if (path === "/products/store") body = listing;
    else if (path === "/products/store/quote") body = { subtotal_paise: 50000, platform_fee_paise: 0, total_paise: 50000, fee_bearer: "ORGANIZER" };
    else if (path.endsWith("/product-fee-preview")) body = { amountPaise: 50000, platformFeePaise: 2000, customerPaysPaise: 50000, organizerNetPaise: 48000, feeBearer: "ORGANIZER" };
    else if (path === "/registrations/me") body = [{ ...registration, ticket: null }];
    else if (path === "/registrations/confirmation") body = { ...registration, ticket: null, paymentSettings: payment };
    else if (path === "/cashfree/availability") body = { enabled: false };
    else if (path === "/organizer/organizations") body = [organization];
    else if (path === "/organizer/organizations/org") body = organization;
    else if (path === "/organizer/organizations/org/paid-verification") body = { status: "NOT_SUBMITTED", organizationId: "org", documents: [] };
    else if (path === "/organizer/events" || path === "/organizer/event-options") body = [currentEvent];
    else if (path === "/organizer/events/audit") body = currentEvent;
    else if (path === "/organizer/events/audit/payment-settings") body = { paymentDestinationStatus: "VERIFIED" };
    else if (path === "/organizer/events/audit/dashboard") body = { ...dashboard, event: currentEvent };
    else if (path === "/organizer/registrations") body = { ...pageData, items: [registration], visibility };
    else if (path === "/organizer/events/audit/pickup-summary") body = { enabled: false, required: false, points: [], unassignedParticipants: 0 };
    else if (path === "/organizer/events/audit/checkpoints") body = { eventId: "audit", eventName: title, checkpoints: [{ id: "checkpoint", name: "Main entrance", type: "entry", isActive: true, sortOrder: 0 }], suggestedAddons: [] };
    else if (path === "/organizer/events/audit/check-in-matrix") body = { eventName: title, checkpoints: [{ id: "checkpoint", name: "Main entrance", position: 1 }], counts: [{ checkpointId: "checkpoint", scanned: 0, total: 1 }], items: [{ registrationId: "registration", registrationReference: registration.registrationReference, participantName: registration.participantName, participantNames: [registration.participantName], participantCount: 1, scans: {}, timeline: [] }], totalParticipants: 1 };
    else if (path === "/organizer/events/audit/race-results") body = { eventId: "audit", eventName: title, sport, resultSetStatus: "draft", categoryStatuses: {}, entries: [] };
    else if (path.endsWith("/allocations/sport-config")) body = { numberEnabled: true, numberLabel: "Bib", allocationMode: "per_participant", prefix: "", minNumber: 1, maxNumber: 9999 };
    else if (/\/(allocations|summary|history|courts|matches|tournament-rounds|match-entries|standings|orders)$/.test(path)) body = [];
    else if (path.endsWith("/scoring-config")) body = { categories: [{ categoryId: "category", categoryName: category.name, gamesToWin: 2, pointsPerGame: 21 }] };
    else if (path.endsWith("/inventory-summary")) body = { products: [], totals: { ordered: 0, approved: 0, pending: 0 } };
    else if (path === "/organizer/credits") body = { accounts: [{ organizationId: "org", balancePaise: 586284 }], paymentSettings: { configured: true, ...payment } };
    else if (path === "/organizer/credits/transactions") body = { ...pageData, eventOptions: [event] };
    else if (path === "/organizer/credits/topups") body = { ...pageData, pending: 0 };
    else if (path === "/organizer/refunds" || path === "/admin/refunds") body = { refunds: [], hasMore: false, nextCursor: null };
    else if (path === "/admin/refunds/filter-options") body = { organizers: [], events: [] };
    else if (path.includes("/registrations/") && path.endsWith("/refund")) body = { refund: null };
    else if (path === "/admin/communication") body = { channel: "email", enabled: false, sender_name: "SportPass", gmail_address: "", gmail_api_configured: false };
    else if (path === "/admin/dashboard") body = { generatedAt: "2026-10-14", period: { label: "October" }, metrics: { pendingOrganizerApplications: 0, incompleteOnboardingOrganizations: 0, activeRaces: 1, racesPublishedThisMonth: 1, registrationsThisMonth: 20, participantSalesThisMonthPaise: 1000000 }, pendingApplications: [], incompleteOrganizations: [], monthlyTrend: [], emailUsage: { used: 0, warningLimit: 500, hardLimit: 1000, status: "normal", sent: 0, pending: 0, failed: 0 }, topEventsByEmail: [], marketingAttribution: { periodDays: 30, sources: [], campaigns: [], daily: [], region: { india: 0, outsideIndia: 0, unknown: 0 } } };
    else if (path === "/admin/organizers") body = [organizerRow];
    else if (path === "/admin/organizers/overview") body = { ...pageData, items: [organizerRow], total: 1, summary: { organizers: 1, pendingVerification: 1, participants: 20, approvedRevenuePaise: 1000000 } };
    else if (path === "/admin/organizations/org/events") body = { ...pageData, items: [adminEvent], total: 1, organization, summary: { events: 1, participants: 20, openEvents: 1, archivedEvents: 0 } };
    else if (path === "/admin/events") body = { ...pageData, items: [adminEvent], total: 1, summary: { participants: 20, organizations: 1, featuresUnlocked: 1 } };
    else if (path === "/admin/organizer-applications") body = { ...pageData, total: 1, items: [{ id: "application", organizationName: organization.name, applicantName: "Alex Participant", email: "alex.participant@example.com", phone: "9876543210", message: "We organize community sports events.", status: "pending", createdAt: "2026-10-14" }] };
    else if (path === "/admin/settlement-events" || path === "/admin/cashfree/payment-reviews") body = pageData;
    else if (path === "/admin/credits/topups") body = { ...pageData, items: [{ id: "topup", organizationName: organization.name, amountPaise: 500000, utrReference: "123456789012", requestedAt: "2026-10-14" }], total: 1, summary: { total: 1, pending: 1, approvedCreditsPaise: 0 } };
    else if (path === "/admin/credits/ledger") body = { ...pageData, items: [{ id: "transaction", organizationName: organization.name, type: "TOPUP", amountPaise: 500000, balanceAfterPaise: 586284, eventName: title, registrationReference: registration.registrationReference, description: "Credits added", createdAt: "2026-10-14" }], total: 1, truncated: false, organizerOptions: [organization], eventOptions: [event] };
    else if (path === "/admin/credits/payment-settings") body = payment;
    else if (path === "/auth/admin/mfa/setup") body = { secret: "TESTSECRET", otpauthUri: "otpauth://totp/test", qrDataUrl: "/placeholder.svg" };
    else { missing.push(`${route.request().method()} ${path}`); await route.fulfill({ status: 501, json: { detail: "Missing audit fixture" } }); return; }
    await route.fulfill({ json: body });
  });
  return missing;
}
