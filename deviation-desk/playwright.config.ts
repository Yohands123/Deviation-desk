import { defineConfig, devices } from "@playwright/test";

// Needs the local stack (npm run db:start). The fixture seeds its own company, so runs never touch
// the demo data. The dev server is started unless one is already running on :3000.
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  // Tests share one fixture company; run them one at a time.
  workers: 1,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
