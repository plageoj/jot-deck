import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  // Increased timeout for demo tests
  timeout: 120000,
  use: {
    baseURL: "http://localhost:1420",
    trace: "on-first-retry",
    // Enable video recording for demos
    video: "on",
    // Slow down actions for better demo visibility
    launchOptions: {
      slowMo: process.env.DEMO ? 100 : 0,
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Run the dev server before tests
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
