# Mobile UI regression audit

Verified locally on 14 October 2026 using Playwright with Chrome.

## Coverage

- 61 public, participant, organizer and admin route scenarios at 320×844, 393×844, 430×844 and 844×390: **244 passing checks**.
- Guest ticket selection → checkout details → mocked payment-reference submission → confirmation, at 320, 393 and 844px: **3 passing flows**.
- All six organizer event-editor steps at the same widths: **3 passing flows**.
- Organizer overview, account menu and registration details at 320, 393, 768, 1024 and 1440px; participant/admin mobile navigation: **7 passing checks**.
- App TypeScript check and production build pass. Changed-source ESLint has no errors; Checkout retains its existing `feeConfig` hook-dependency warning.

The route suite asserts no page-wide horizontal overflow, clipped button labels, header/account overlap, unexpected redirects, browser runtime errors or unhandled fixture requests. Intentionally scrollable tables remain scrollable within their containers. Mobile overview and registration-card screenshots were also reviewed.

## Fixes

- Shared cards can shrink within flex/grid layouts instead of expanding the page.
- Dashboard headers reserve room for navigation/account controls and truncate titles safely.
- Organizer balance/name detail moves into the account menu on phones.
- Dropdowns are bounded to the viewport; drawer controls have larger touch targets.
- Organizer overview and registrations use mobile cards and a bounded detail sheet.
- Event detail and public results use explicit single-column grids on phones.
- Event-card actions, allocation actions and admin review pagination wrap when necessary.
- Organizer onboarding uses a compact mobile back control.

## Repeat

From `frontend` with Chrome installed:

```sh
PLAYWRIGHT_CHANNEL=chrome npm run test:mobile -- --workers=3
npx tsc -p tsconfig.app.json --noEmit
npm run build
```

The Playwright config starts the preview on port 8081, with Clerk disabled for deterministic local authentication fixtures. Reuse an existing preview only when it has the same configuration. Alternatively install Playwright Chromium and omit `PLAYWRIGHT_CHANNEL`.

API responses and writes are mocked. These checks cover the listed route states and flows, including populated registration/admin examples and empty states; they do not validate live payments, email delivery, camera hardware, third-party Clerk screens, every possible data combination, or physical iOS Safari/Android WebViews. Extend the fixtures when adding new states or endpoints. Failed tests save screenshots under `frontend/test-results`.
