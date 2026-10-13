import { defineConfig, devices } from "@playwright/test";

// End-to-end tests start in Phase 4 (seat picker → incident room → approve a decision).
export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:3000" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
