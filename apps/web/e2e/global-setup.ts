import { execFileSync } from "node:child_process";

export default async function globalSetup(): Promise<void> {
  const connectionString = process.env.ORBIT_TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error("Set ORBIT_TEST_DATABASE_URL to the isolated orbit_test database before running browser tests.");
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(connectionString);
  } catch {
    throw new Error("ORBIT_TEST_DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (
    decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, "")) !== "orbit_test" ||
    !["localhost", "127.0.0.1", "::1", "postgres"].includes(databaseUrl.hostname)
  ) {
    throw new Error("Browser-test setup may only clear rate limits in the local orbit_test database.");
  }

  execFileSync(
    "corepack pnpm exec prisma db execute --stdin --config ../../prisma.config.ts",
    {
      env: { ...process.env, DATABASE_URL: connectionString },
      input: 'DELETE FROM "RateLimitBucket";',
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}
