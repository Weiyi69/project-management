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
import { takeTestEmails } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { RateLimitService } from "../rate-limits/rate-limit.service";
import { hashRateLimitKey } from "../auth/auth-crypto";

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

function codeFromTestEmail(email: string): string {
  const message = takeTestEmails(email).find((item) => item.subject.includes("code"));
  assert.ok(message, "Expected the test email transport to capture an authentication code.");
  const match = message.text.match(/code is (\d{6})/);
  assert.ok(match, "Expected a six-digit code in the captured test message.");
  return match[1]!;
}

async function getUserRowLockWaiterCount(database: PrismaService): Promise<number> {
  const rows = await database.$queryRaw<Array<{ waiting: number }>>`
    SELECT COUNT(*)::int AS "waiting"
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND wait_event_type = 'Lock'
      AND query LIKE '%FOR UPDATE%'
  `;
  return rows[0]?.waiting ?? 0;
}

async function waitForUserRowLockWaiters(
  database: PrismaService,
  minimumWaiters: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await getUserRowLockWaiterCount(database)) >= minimumWaiters) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${minimumWaiters} PostgreSQL user-row lock waiter(s).`);
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
  process.env.NODE_ENV = "test";
  process.env.ORBIT_EMAIL_MODE = "memory";
  process.env.ORBIT_TEST_OTP = "123456";
  process.env.OTP_PEPPER ??= "integration-test-only-otp-pepper-32-bytes-minimum";
  app = await NestFactory.create(AppModule, { logger: ["error"] });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, "127.0.0.1");

  const address = app.getHttpServer().address() as AddressInfo | null;
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  prisma = app.get(PrismaService);
  await prisma.rateLimitBucket.deleteMany();
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
  assert.equal(registration.headers.get("set-cookie"), null);
  const registrationData = (await registration.json()) as {
    email: string;
    verificationRequired: boolean;
    resendCooldownSeconds: number;
  };
  assert.equal(registrationData.email, ownerEmail);
  assert.equal(registrationData.verificationRequired, true);
  assert.equal(registrationData.resendCooldownSeconds, 60);
  const ownerRecord = await prisma.user.findUniqueOrThrow({
    where: { email: ownerEmail },
    include: { workspaceMemberships: { include: { workspace: true } } },
  });
  const ownerWorkspace = ownerRecord.workspaceMemberships[0]?.workspace;
  assert.ok(ownerWorkspace);
  createdUserIds.push(ownerRecord.id);
  createdWorkspaceIds.push(ownerWorkspace.id);
  assert.equal(ownerRecord.emailVerifiedAt, null);
  assert.equal(await prisma.refreshSession.count({ where: { userId: ownerRecord.id } }), 0);
  assert.equal(await prisma.authCode.count({ where: { userId: ownerRecord.id } }), 1);
  const initialCode = codeFromTestEmail(ownerEmail);
  const storedInitialCode = await prisma.authCode.findFirstOrThrow({
    where: { userId: ownerRecord.id, purpose: "EMAIL_VERIFICATION" },
  });
  assert.notEqual(storedInitialCode.codeHash, initialCode);
  assert.equal(storedInitialCode.codeHash.includes(initialCode), false);

  const unverifiedLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: ownerEmail, password }),
  });
  assert.equal(unverifiedLogin.status, 403);
  const immediateResend = await request("/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify({ email: ownerEmail }),
  });
  assert.equal(immediateResend.status, 429);

  const invalidCodeResponse = await request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ email: ownerEmail, code: "000000" }),
  });
  assert.equal(invalidCodeResponse.status, 400);
  await prisma.authCode.update({
    where: { id: storedInitialCode.id },
    data: {
      createdAt: new Date(Date.now() - 2 * 60 * 1000),
      expiresAt: new Date(Date.now() - 60 * 1000),
    },
  });
  const expiredCodeResponse = await request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ email: ownerEmail, code: initialCode }),
  });
  assert.equal(expiredCodeResponse.status, 400);

  const verificationResend = await request("/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify({ email: ownerEmail }),
  });
  assert.equal(verificationResend.status, 200);
  const verificationCode = codeFromTestEmail(ownerEmail);
  const verifiedResponse = await request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ email: ownerEmail, code: verificationCode }),
  });
  assert.equal(verifiedResponse.status, 200);
  assert.equal(await prisma.user.findUniqueOrThrow({ where: { id: ownerRecord.id } }).then(
    (user) => user.emailVerifiedAt !== null,
  ), true);
  const reusedVerificationCode = await request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ email: ownerEmail, code: verificationCode }),
  });
  assert.equal(reusedVerificationCode.status, 400);

  const duplicateVerifiedRegistration = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Quality Owner", email: ownerEmail, password }),
  });
  assert.equal(duplicateVerifiedRegistration.status, registration.status);
  assert.deepEqual(await duplicateVerifiedRegistration.json(), registrationData);
  assert.deepEqual(takeTestEmails(ownerEmail), []);

  const ownerLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: ownerEmail, password }),
  });
  assert.equal(ownerLogin.status, 200);
  const ownerCookie = cookieFrom(ownerLogin);
  const ownerData = {
    user: {
      id: ownerRecord.id,
      workspaceId: ownerWorkspace.id,
      workspaceName: ownerWorkspace.name,
    },
  };

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
  assert.equal(outsiderRegistration.headers.get("set-cookie"), null);
  const outsiderData = await prisma.user.findUniqueOrThrow({
    where: { email: outsiderEmail },
    include: { workspaceMemberships: { include: { workspace: true } } },
  });
  createdUserIds.push(outsiderData.id);
  createdWorkspaceIds.push(outsiderData.workspaceMemberships[0]!.workspace.id);
  const outsiderCode = codeFromTestEmail(outsiderEmail);
  assert.equal(
    (
      await request("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ email: outsiderEmail, code: outsiderCode }),
      })
    ).status,
    200,
  );
  const outsiderLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: outsiderEmail, password }),
  });
  assert.equal(outsiderLogin.status, 200);
  const outsiderCookie = cookieFrom(outsiderLogin);

  const outsiderWorkspaceAnalytics = await request(
    `/analytics/workspaces/${ownerData.user.workspaceId}`,
    { headers: { cookie: outsiderCookie } },
  );
  assert.equal(outsiderWorkspaceAnalytics.status, 404);
  const outsiderProjectAnalytics = await request(`/analytics/projects/${projectId}`, {
    headers: { cookie: outsiderCookie },
  });
  assert.equal(outsiderProjectAnalytics.status, 404);

  const attemptsEmail = `quality-attempts-${emailSuffix}@example.test`;
  const attemptsRegistration = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Quality Attempts",
      email: attemptsEmail,
      password,
    }),
  });
  assert.equal(attemptsRegistration.status, 201);
  const attemptsUser = await prisma.user.findUniqueOrThrow({
    where: { email: attemptsEmail },
    include: { workspaceMemberships: { include: { workspace: true } } },
  });
  createdUserIds.push(attemptsUser.id);
  createdWorkspaceIds.push(attemptsUser.workspaceMemberships[0]!.workspace.id);
  const attemptsCode = codeFromTestEmail(attemptsEmail);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(
      (
        await request("/auth/verify-email", {
          method: "POST",
          body: JSON.stringify({ email: attemptsEmail, code: "000000" }),
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await request("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ email: attemptsEmail, code: attemptsCode }),
      })
    ).status,
    400,
  );
  const exhaustedVerificationCode = await prisma.authCode.findFirstOrThrow({
    where: { userId: attemptsUser.id, purpose: "EMAIL_VERIFICATION" },
  });
  assert.equal(exhaustedVerificationCode.attempts, 5);
  assert.ok(exhaustedVerificationCode.consumedAt);
  assert.equal(
    (
      await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: attemptsEmail, password }),
      })
    ).status,
    403,
  );

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

  const invitationEmail = `quality-invite-${emailSuffix}@example.test`;
  const invitationResponse = await request(
    `/workspaces/${ownerWorkspace.id}/invitations`,
    {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        "x-workspace-id": ownerWorkspace.id,
      },
      body: JSON.stringify({ email: invitationEmail, role: "MEMBER" }),
    },
  );
  assert.equal(invitationResponse.status, 201);
  const invitationMessage = takeTestEmails(invitationEmail).find((item) =>
    item.subject.includes("invited"),
  );
  assert.ok(invitationMessage);
  const invitationLink = invitationMessage.text.match(/Accept your invitation: (\S+)/);
  assert.ok(invitationLink);
  const invitationToken = new URL(invitationLink[1]!).searchParams.get("token");
  assert.ok(invitationToken);
  const invitationPreview = await request(
    `/invitations/preview/${encodeURIComponent(invitationToken)}`,
  );
  assert.equal(invitationPreview.status, 200);

  const invitedRegistration = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Quality Invitee",
      email: invitationEmail,
      password,
    }),
  });
  assert.equal(invitedRegistration.status, 201);
  assert.equal(invitedRegistration.headers.get("set-cookie"), null);
  const invitedUser = await prisma.user.findUniqueOrThrow({
    where: { email: invitationEmail },
    include: { workspaceMemberships: { include: { workspace: true } } },
  });
  createdUserIds.push(invitedUser.id);
  createdWorkspaceIds.push(invitedUser.workspaceMemberships[0]!.workspace.id);
  const inviteeVerificationCode = codeFromTestEmail(invitationEmail);
  assert.equal(
    (
      await request("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ email: invitationEmail, code: inviteeVerificationCode }),
      })
    ).status,
    200,
  );
  const inviteeLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: invitationEmail, password }),
  });
  assert.equal(inviteeLogin.status, 200);
  const inviteeCookie = cookieFrom(inviteeLogin);
  const acceptedInvitation = await request("/invitations/accept", {
    method: "POST",
    headers: { cookie: inviteeCookie },
    body: JSON.stringify({ token: invitationToken }),
  });
  assert.equal(acceptedInvitation.status, 200);
  const acceptedData = (await acceptedInvitation.json()) as {
    workspace: { id: string };
  };
  assert.equal(acceptedData.workspace.id, ownerWorkspace.id);

  const resetRequest = await request("/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email: ownerEmail }),
  });
  assert.equal(resetRequest.status, 200);
  assert.match((await resetRequest.json()).message, /If an account exists/);
  const resetCode = codeFromTestEmail(ownerEmail);
  const resetCodeRow = await prisma.authCode.findFirstOrThrow({
    where: { userId: ownerRecord.id, purpose: "PASSWORD_RESET", consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(resetCodeRow.codeHash.includes(resetCode), false);
  const invalidReset = await request("/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({
      email: ownerEmail,
      code: "000000",
      newPassword: "quality-suite-password-updated-456",
    }),
  });
  assert.equal(invalidReset.status, 400);

  await prisma.authCode.update({
    where: { id: resetCodeRow.id },
    data: {
      createdAt: new Date(Date.now() - 2 * 60 * 1000),
      expiresAt: new Date(Date.now() - 60 * 1000),
    },
  });
  assert.equal(
    (
      await request("/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({
          email: ownerEmail,
          code: resetCode,
          newPassword: "quality-suite-password-updated-456",
        }),
      })
    ).status,
    400,
  );
  const exhaustedResetRequest = await request("/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email: ownerEmail }),
  });
  assert.equal(exhaustedResetRequest.status, 200);
  const exhaustedResetCode = codeFromTestEmail(ownerEmail);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(
      (
        await request("/auth/password-reset/confirm", {
          method: "POST",
          body: JSON.stringify({
            email: ownerEmail,
            code: "000000",
            newPassword: "quality-suite-password-updated-456",
          }),
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await request("/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({
          email: ownerEmail,
          code: exhaustedResetCode,
          newPassword: "quality-suite-password-updated-456",
        }),
      })
    ).status,
    400,
  );
  const exhaustedResetRow = await prisma.authCode.findFirstOrThrow({
    where: { userId: ownerRecord.id, purpose: "PASSWORD_RESET" },
    orderBy: { createdAt: "desc" },
  });
  await prisma.authCode.update({
    where: { id: exhaustedResetRow.id },
    data: { createdAt: new Date(Date.now() - 2 * 60 * 1000) },
  });
  const finalResetRequest = await request("/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email: ownerEmail }),
  });
  assert.equal(finalResetRequest.status, 200);
  const resetCodeForConcurrentUse = codeFromTestEmail(ownerEmail);

  const otherOwnerSession = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: ownerEmail, password }),
  });
  assert.equal(otherOwnerSession.status, 200);
  const otherOwnerCookie = cookieFrom(otherOwnerSession);
  const resetResults = await Promise.all([
    request("/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({
        email: ownerEmail,
        code: resetCodeForConcurrentUse,
        newPassword: "quality-suite-password-updated-456",
      }),
    }),
    request("/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({
        email: ownerEmail,
        code: resetCodeForConcurrentUse,
        newPassword: "quality-suite-password-updated-456",
      }),
    }),
  ]);
  assert.deepEqual(
    resetResults.map((result) => result.status).sort(),
    [200, 400],
  );
  assert.equal(
    (
      await request("/auth/me", {
        headers: { cookie: ownerCookie },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/auth/me", {
        headers: { cookie: otherOwnerCookie },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: ownerEmail,
          password: "quality-suite-password-updated-456",
        }),
      })
    ).status,
    200,
  );

  const raceEmail = `quality-reset-race-${emailSuffix}@example.test`;
  const raceRegistration = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Quality Reset Race", email: raceEmail, password }),
  });
  assert.equal(raceRegistration.status, 201);
  const raceUser = await prisma.user.findUniqueOrThrow({
    where: { email: raceEmail },
    include: { workspaceMemberships: { include: { workspace: true } } },
  });
  createdUserIds.push(raceUser.id);
  createdWorkspaceIds.push(raceUser.workspaceMemberships[0]!.workspace.id);
  const raceVerificationCode = codeFromTestEmail(raceEmail);
  assert.equal(
    (
      await request("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ email: raceEmail, code: raceVerificationCode }),
      })
    ).status,
    200,
  );
  const raceExistingLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: raceEmail, password }),
  });
  assert.equal(raceExistingLogin.status, 200);
  const raceExistingCookie = cookieFrom(raceExistingLogin);
  assert.equal(
    (
      await request("/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: raceEmail }),
      })
    ).status,
    200,
  );
  const raceResetCode = codeFromTestEmail(raceEmail);
  const rowLockPrisma = new PrismaService();
  await rowLockPrisma.$connect();
  let releaseUserLock!: () => void;
  let signalUserLockAcquired!: () => void;
  const releaseGate = new Promise<void>((resolve) => {
    releaseUserLock = resolve;
  });
  const userLockAcquired = new Promise<void>((resolve) => {
    signalUserLockAcquired = resolve;
  });
  const rowLockHolder = rowLockPrisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id" FROM "User" WHERE "id" = ${raceUser.id}::uuid FOR UPDATE
    `;
    signalUserLockAcquired();
    await releaseGate;
  });
  await userLockAcquired;

  let resetRaceRequest: Promise<Response> | undefined;
  let loginRaceRequest: Promise<Response> | undefined;
  let loginStayedBlocked = false;
  let lockWaitersAfterLogin = 0;
  try {
    resetRaceRequest = request("/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({
        email: raceEmail,
        code: raceResetCode,
        newPassword: "quality-suite-password-raced-789",
      }),
    });
    await waitForUserRowLockWaiters(rowLockPrisma, 1);
    loginRaceRequest = request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: raceEmail, password }),
    });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      lockWaitersAfterLogin = await getUserRowLockWaiterCount(rowLockPrisma);
      if (lockWaitersAfterLogin >= 2) {
        loginStayedBlocked = true;
        break;
      }
      const loginCompleted = await Promise.race([
        loginRaceRequest.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10)),
      ]);
      if (loginCompleted) break;
    }
  } finally {
    releaseUserLock();
    await rowLockHolder;
    await Promise.allSettled(
      [resetRaceRequest, loginRaceRequest].filter(
        (pending): pending is Promise<Response> => pending !== undefined,
      ),
    );
    await rowLockPrisma.$disconnect();
  }
  const [racingReset, racingLogin] = await Promise.all([
    resetRaceRequest,
    loginRaceRequest,
  ]);
  assert.equal(loginStayedBlocked, true);
  assert.ok(lockWaitersAfterLogin >= 2);
  assert.equal(racingReset.status, 200);
  assert.equal(
    (
      await request("/auth/me", {
        headers: { cookie: raceExistingCookie },
      })
    ).status,
    401,
  );
  assert.equal(
    await prisma.refreshSession.count({
      where: { userId: raceUser.id, revokedAt: null },
    }),
    0,
  );
  if (racingLogin.status === 200) {
    const racingLoginCookie = cookieFrom(racingLogin);
    assert.equal(
      (
        await request("/auth/me", {
          headers: { cookie: racingLoginCookie },
        })
      ).status,
      401,
    );
  }
  assert.equal(
    (
      await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: raceEmail, password }),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: raceEmail,
          password: "quality-suite-password-raced-789",
        }),
      })
    ).status,
    200,
  );

  const unknownResetRequest = await request("/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email: `unknown-${emailSuffix}@example.test` }),
  });
  assert.equal(unknownResetRequest.status, resetRequest.status);
  assert.deepEqual(await unknownResetRequest.json(), await Promise.resolve({
    message: "If an account exists for that email, a reset code has been sent.",
  }));

  const rateLimits = app.get(RateLimitService);
  const secondPrisma = new PrismaService();
  await secondPrisma.$connect();
  try {
    const secondInstanceLimiter = new RateLimitService(secondPrisma);
    const limitScope = `integration-concurrency-${emailSuffix}`;
    const limitSubject = "shared-client";
    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 === 0 ? rateLimits : secondInstanceLimiter).enforce(
          limitScope,
          limitSubject,
          7,
          60_000,
        ),
      ),
    );
    assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 7);
    assert.equal(outcomes.filter(({ status }) => status === "rejected").length, 13);
    await assert.rejects(
      secondInstanceLimiter.enforce(limitScope, limitSubject, 7, 60_000),
    );
    await prisma.rateLimitBucket.deleteMany({
      where: { key: hashRateLimitKey(limitScope, limitSubject) },
    });
  } finally {
    await secondPrisma.$disconnect();
  }

  const logout = await request("/auth/logout", {
    method: "POST",
    headers: { cookie: inviteeCookie },
  });
  assert.equal(logout.status, 200);
  const revokedMe = await request("/auth/me", { headers: { cookie: inviteeCookie } });
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
