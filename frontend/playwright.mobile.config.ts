import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "mobile-*.spec.ts",
  use: {
    baseURL: "http://127.0.0.1:8081",
    channel: process.env.PLAYWRIGHT_CHANNEL,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 8081",
    url: "http://127.0.0.1:8081",
    env: { VITE_CLERK_PUBLISHABLE_KEY: "" },
    reuseExistingServer: !process.env.CI,
  },
});
