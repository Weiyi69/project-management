import "reflect-metadata";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

const TEST_DATABASE_NAME = "orbit_test";
const password = "quality-suite-password-123";
const createdUserIds: string[] = [];
const createdWorkspaceIds: string[] = [];
let app: Awaited<ReturnType<typeof NestFactory.create>>;
let prisma: PrismaService;
let baseUrl = "";
const apiTimings = new Map<string, number[]>();

function requireIsolatedTestDatabase(): string {
  const connectionString = process.env.ORBIT_TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error("Set ORBIT_TEST_DATABASE_URL to a disposable local PostgreSQL database named orbit_test.");
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("ORBIT_TEST_DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (
    database !== TEST_DATABASE_NAME ||
    !["localhost", "127.0.0.1", "::1", "postgres"].includes(url.hostname)
  ) {
    throw new Error(
      `Integration tests only run against the local PostgreSQL database "${TEST_DATABASE_NAME}".`,
    );
  }
  return connectionString;
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "Expected the API to set an authenticated session cookie.");
  return setCookie.split(";")[0]!;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  await response.clone().arrayBuffer();
  const key = `${method} ${path.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ":id",
  )}`;
  const samples = apiTimings.get(key) ?? [];
  samples.push(performance.now() - startedAt);
  apiTimings.set(key, samples);
  return response;
}

before(async () => {
  process.env.DATABASE_URL = requireIsolatedTestDatabase();
  process.env.FRONTEND_URL = "http://127.0.0.1:5173";
  app = await NestFactory.create(AppModule, { logger: ["error"] });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, "127.0.0.1");

  const address = app.getHttpServer().address() as AddressInfo | null;
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  prisma = app.get(PrismaService);
});

after(async () => {
  if (prisma) {
    if (createdWorkspaceIds.length) {
      await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  }
  if (app) await app.close();
});

test("authenticated core workflow persists data and enforces workspace boundaries", async () => {
  const emailSuffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const ownerEmail = `quality-owner-${emailSuffix}@example.test`;
  const outsiderEmail = `quality-outsider-${emailSuffix}@example.test`;

  const anonymousMe = await request("/auth/me");
  assert.equal(anonymousMe.status, 401);

  const invalidRegistration = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: " ", email: ownerEmail, password: "short" }),
  });
  assert.equal(invalidRegistration.status, 400, await invalidRegistration.clone().text());

  const registration = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Quality Owner", email: ownerEmail, password }),
  });
  assert.equal(registration.status, 201);
  const ownerCookie = cookieFrom(registration);
  const ownerData = (await registration.json()) as {
    user: { id: string; workspaceId: string; workspaceName: string };
  };
  createdUserIds.push(ownerData.user.id);
  createdWorkspaceIds.push(ownerData.user.workspaceId);
  assert.equal(ownerData.user.workspaceName, "Quality Owner's workspace");

  const me = await request("/auth/me", { headers: { cookie: ownerCookie } });
  assert.equal(me.status, 200);

  const invalidProject = await request("/projects", {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ name: " " }),
  });
  assert.equal(invalidProject.status, 400);

  const createdProjectResponse = await request("/projects", {
    method: "POST",
    headers: { cookie: ownerCookie, "x-workspace-id": ownerData.user.workspaceId },
    body: JSON.stringify({ name: "Quality integration project" }),
  });
  assert.equal(createdProjectResponse.status, 201);
  const projectData = (await createdProjectResponse.json()) as {
    project: { id: string; statuses: Array<{ id: string; name: string }> };
  };
  const projectId = projectData.project.id;
  const todoStatus = projectData.project.statuses.find((status) => status.name === "To do");
  const doneStatus = projectData.project.statuses.find((status) => status.name === "Done");
  assert.ok(todoStatus);
  assert.ok(doneStatus);

  const createdTaskResponse = await request(`/projects/${projectId}/tasks`, {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({
      title: "Verify persisted workflow",
      statusId: todoStatus.id,
      dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  });
  assert.equal(createdTaskResponse.status, 201);
  const taskData = (await createdTaskResponse.json()) as { task: { id: string } };

  const performanceCookieHeaders = { cookie: ownerCookie };
  const projectListHeaders = {
    cookie: ownerCookie,
    "x-workspace-id": ownerData.user.workspaceId,
  };
  for (let sample = 0; sample < 3; sample += 1) {
    const login = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: ownerEmail, password }),
    });
    assert.equal(login.status, 200);
  }
  for (let sample = 0; sample < 10; sample += 1) {
    assert.equal(
      (await request("/projects", { headers: projectListHeaders })).status,
      200,
    );
    assert.equal(
      (await request(`/projects/${projectId}`, { headers: performanceCookieHeaders })).status,
      200,
    );
    assert.equal(
      (await request(`/projects/${projectId}/tasks`, { headers: performanceCookieHeaders })).status,
      200,
    );
    assert.equal(
      (await request(`/tasks/${taskData.task.id}`, { headers: performanceCookieHeaders })).status,
      200,
    );
    assert.equal(
      (await request("/notifications", { headers: performanceCookieHeaders })).status,
      200,
    );
    assert.equal(
      (
        await request(`/analytics/workspaces/${ownerData.user.workspaceId}`, {
          headers: performanceCookieHeaders,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(`/analytics/projects/${projectId}`, {
          headers: performanceCookieHeaders,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(`/tasks/${taskData.task.id}`, {
          method: "PATCH",
          headers: performanceCookieHeaders,
          body: JSON.stringify({ statusId: sample % 2 === 0 ? doneStatus.id : todoStatus.id }),
        })
      ).status,
      200,
    );
  }

  const createdAnalyticsResponse = await request(
    `/analytics/workspaces/${ownerData.user.workspaceId}`,
    { headers: { cookie: ownerCookie } },
  );
  assert.equal(createdAnalyticsResponse.status, 200);
  const analytics = (await createdAnalyticsResponse.json()) as {
    summary: { totalProjects: number; totalTasks: number; completionRate: number };
    projects: Array<{ id: string; health: { status: string } }>;
  };
  assert.equal(analytics.summary.totalProjects, 1);
  assert.equal(analytics.summary.totalTasks, 1);
  assert.equal(analytics.summary.completionRate, 0);
  assert.equal(analytics.projects[0]?.id, projectId);

  const outsiderRegistration = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Quality Outsider", email: outsiderEmail, password }),
  });
  assert.equal(outsiderRegistration.status, 201);
  const outsiderCookie = cookieFrom(outsiderRegistration);
  const outsiderData = (await outsiderRegistration.json()) as {
    user: { id: string; workspaceId: string };
  };
  createdUserIds.push(outsiderData.user.id);
  createdWorkspaceIds.push(outsiderData.user.workspaceId);

  const outsiderWorkspaceAnalytics = await request(
    `/analytics/workspaces/${ownerData.user.workspaceId}`,
    { headers: { cookie: outsiderCookie } },
  );
  assert.equal(outsiderWorkspaceAnalytics.status, 404);
  const outsiderProjectAnalytics = await request(`/analytics/projects/${projectId}`, {
    headers: { cookie: outsiderCookie },
  });
  assert.equal(outsiderProjectAnalytics.status, 404);

  const csvResponse = await request(
    `/analytics/projects/${projectId}/export.csv`,
    { headers: { cookie: ownerCookie } },
  );
  assert.equal(csvResponse.status, 200);
  assert.match(csvResponse.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(await csvResponse.text(), /Verify persisted workflow/);

  const updateTaskResponse = await request(`/tasks/${taskData.task.id}`, {
    method: "PATCH",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ statusId: doneStatus.id }),
  });
  assert.equal(updateTaskResponse.status, 200);

  const completedAnalyticsResponse = await request(
    `/analytics/projects/${projectId}`,
    { headers: { cookie: ownerCookie } },
  );
  assert.equal(completedAnalyticsResponse.status, 200);
  const completedAnalytics = (await completedAnalyticsResponse.json()) as {
    project: { health: { completedTasks: number; completionRate: number; status: string } };
  };
  assert.equal(completedAnalytics.project.health.completedTasks, 1);
  assert.equal(completedAnalytics.project.health.completionRate, 100);
  assert.equal(completedAnalytics.project.health.status, "ON_TRACK");

  const logout = await request("/auth/logout", {
    method: "POST",
    headers: { cookie: ownerCookie },
  });
  assert.equal(logout.status, 200);
  const revokedMe = await request("/auth/me", { headers: { cookie: ownerCookie } });
  assert.equal(revokedMe.status, 401);

  const percentiles = (values: number[]) => {
    const sorted = [...values].sort((left, right) => left - right);
    const at = (percentile: number) => {
      const value = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1)];
      if (value === undefined) {
        throw new Error("Cannot calculate a performance percentile without samples.");
      }
      return value;
    };
    const max = sorted.at(-1);
    if (max === undefined) {
      throw new Error("Cannot calculate performance measurements without samples.");
    }
    return {
      samples: sorted.length,
      p50Ms: Math.round(at(0.5) * 100) / 100,
      p95Ms: Math.round(at(0.95) * 100) / 100,
      maxMs: Math.round(max * 100) / 100,
    };
  };
  const report = {
    source: "PostgreSQL-backed API integration test",
    database: TEST_DATABASE_NAME,
    generatedAt: new Date().toISOString(),
    measurements: Object.fromEntries(
      [...apiTimings.entries()].map(([key, samples]) => [key, percentiles(samples)]),
    ),
  };
  const resultsDirectory = resolve(__dirname, "../../../../test-results");
  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(
    join(resultsDirectory, "api-performance-baseline.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  console.log(`QUALITY_API_PERFORMANCE_BASELINE ${JSON.stringify(report)}`);
});
