import { defineConfig, devices } from "@playwright/test";

const testDatabaseUrl = process.env.ORBIT_TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("Set ORBIT_TEST_DATABASE_URL to the isolated orbit_test database before running browser tests.");
}

const databaseUrl = new URL(testDatabaseUrl);
if (
  decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, "")) !== "orbit_test" ||
  !["localhost", "127.0.0.1", "::1", "postgres"].includes(databaseUrl.hostname)
) {
  throw new Error("Browser tests may only use a local PostgreSQL database named orbit_test.");
}

const apiPort = 3001;
const webPort = 5174;
const baseURL = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./apps/web/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "corepack pnpm dev",
    url: `http://127.0.0.1:${apiPort}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: testDatabaseUrl,
      ORBIT_TEST_DATABASE_URL: testDatabaseUrl,
      FRONTEND_URL: baseURL,
      PORT: String(apiPort),
      VITE_PORT: String(webPort),
      VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
      NODE_ENV: "test",
    },
  },
});
