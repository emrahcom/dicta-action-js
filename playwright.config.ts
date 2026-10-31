import { defineConfig, devices } from "@playwright/test";

// The test server's port, see test/browser/server.ts.
const PORT = 4174;

export default defineConfig({
  testDir: "test/browser",
  webServer: {
    command: "node test/browser/server.ts",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
  },
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
