import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import sharp from "sharp";
import { AppModule } from "../app.module";
import { EmailDeliveryError, EmailService, takeTestEmails } from "../email/email.service";
import { NotificationsService, type CreatedNotification } from "../notifications/notifications.service";
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
      ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  await response.clone().arrayBuffer();
  const normalizedPath = path
    .replace(/\/invitations\/preview\/[^/?]+/g, "/invitations/preview/:token")
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ":id",
    );
  const key = `${method} ${normalizedPath}`;
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
  assert.equal((await request("/search?q=anything")).status, 401);

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
    body: JSON.stringify({
      name: "Quality integration project",
      description: "SearchableProjectDescriptionMarker",
    }),
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
      description: "SearchableTaskDescriptionMarker",
      statusId: todoStatus.id,
      assigneeId: ownerRecord.id,
      dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  });
  assert.equal(createdTaskResponse.status, 201);
  const taskData = (await createdTaskResponse.json()) as {
    task: { id: string; dueDate: string | null };
  };
  assert.ok(taskData.task.dueDate);

  const projectNameSearch = await request("/search?q=QUALITY%20INTEGRATION", {
    headers: { cookie: ownerCookie },
  });
  assert.equal(projectNameSearch.status, 200);
  const projectNameResults = (await projectNameSearch.json()) as {
    projects: Array<{ id: string }>;
  };
  assert.deepEqual(projectNameResults.projects.map(({ id }) => id), [projectId]);
  const projectDescriptionSearch = await request(
    "/search?q=searchableprojectdescriptionmarker",
    { headers: { cookie: ownerCookie } },
  );
  assert.equal(projectDescriptionSearch.status, 200);
  assert.deepEqual(
    ((await projectDescriptionSearch.json()) as { projects: Array<{ id: string }> }).projects.map(
      ({ id }) => id,
    ),
    [projectId],
  );
  const taskTitleSearch = await request("/search?q=workflow", {
    headers: { cookie: ownerCookie },
  });
  assert.equal(taskTitleSearch.status, 200);
  const taskTitleResults = (await taskTitleSearch.json()) as {
    tasks: Array<{ id: string; projectId: string; project: { id: string; name: string } }>;
  };
  assert.deepEqual(taskTitleResults.tasks.map(({ id }) => id), [taskData.task.id]);
  assert.equal(taskTitleResults.tasks[0]?.projectId, projectId);
  assert.equal(taskTitleResults.tasks[0]?.project.id, projectId);
  const taskDescriptionSearch = await request(
    "/search?q=searchabletaskdescriptionmarker",
    { headers: { cookie: ownerCookie } },
  );
  assert.equal(taskDescriptionSearch.status, 200);
  assert.deepEqual(
    ((await taskDescriptionSearch.json()) as { tasks: Array<{ id: string }> }).tasks.map(
      ({ id }) => id,
    ),
    [taskData.task.id],
  );
  assert.deepEqual(
    await (
      await request("/search?q=%20x%20", { headers: { cookie: ownerCookie } })
    ).json(),
    { projects: [], tasks: [] },
  );
  assert.equal(
    (await request(`/search?q=${"x".repeat(101)}`, { headers: { cookie: ownerCookie } })).status,
    400,
  );
  await prisma.project.createMany({
    data: Array.from({ length: 10 }, (_unused, index) => ({
      workspaceId: ownerWorkspace.id,
      name: `SearchLimitProject ${index}`,
      createdBy: ownerRecord.id,
    })),
  });
  await prisma.task.createMany({
    data: Array.from({ length: 10 }, (_unused, index) => ({
      projectId,
      title: `SearchLimitTask ${index}`,
      statusId: todoStatus.id,
      reporterId: ownerRecord.id,
    })),
  });
  try {
    const limitedSearch = await request("/search?q=searchlimit", {
      headers: { cookie: ownerCookie },
    });
    assert.equal(limitedSearch.status, 200);
    const limitedResults = (await limitedSearch.json()) as {
      projects: Array<{ id: string }>;
      tasks: Array<{ id: string }>;
    };
    assert.equal(limitedResults.projects.length, 8);
    assert.equal(limitedResults.tasks.length, 8);
  } finally {
    await prisma.task.deleteMany({
      where: { projectId, title: { startsWith: "SearchLimitTask " } },
    });
    await prisma.project.deleteMany({
      where: { workspaceId: ownerWorkspace.id, name: { startsWith: "SearchLimitProject " } },
    });
  }

  const undatedTaskResponse = await request(`/projects/${projectId}/tasks`, {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({
      title: "Task without a calendar date",
      statusId: todoStatus.id,
    }),
  });
  assert.equal(undatedTaskResponse.status, 201);
  const undatedTaskData = (await undatedTaskResponse.json()) as { task: { id: string } };
  const exactCalendarDate = taskData.task.dueDate.slice(0, 10);
  const calendarResponse = await request(
    `/workspaces/${ownerWorkspace.id}/calendar/tasks?startDate=${exactCalendarDate}&endDate=${exactCalendarDate}`,
    { headers: { cookie: ownerCookie } },
  );
  assert.equal(calendarResponse.status, 200);
  const calendarData = (await calendarResponse.json()) as {
    tasks: Array<{ id: string; dueDate: string; project: { id: string; name: string } }>;
    projects: Array<{ id: string; statuses: Array<{ id: string; name: string }> }>;
    members: Array<{ id: string }>;
  };
  assert.deepEqual(calendarData.tasks.map(({ id }) => id), [taskData.task.id]);
  assert.equal(calendarData.tasks[0]?.dueDate, exactCalendarDate);
  assert.equal(calendarData.tasks[0]?.project.id, projectId);
  assert.equal(calendarData.projects[0]?.id, projectId);
  assert.ok(calendarData.projects[0]?.statuses.some(({ id }) => id === todoStatus.id));
  assert.ok(calendarData.members.some(({ id }) => id === ownerRecord.id));
  const previousCalendarDate = new Date(`${exactCalendarDate}T00:00:00.000Z`);
  previousCalendarDate.setUTCDate(previousCalendarDate.getUTCDate() - 1);
  const outsideCalendarResponse = await request(
    `/workspaces/${ownerWorkspace.id}/calendar/tasks?startDate=${previousCalendarDate.toISOString().slice(0, 10)}&endDate=${previousCalendarDate.toISOString().slice(0, 10)}`,
    { headers: { cookie: ownerCookie } },
  );
  assert.equal(outsideCalendarResponse.status, 200);
  assert.deepEqual((await outsideCalendarResponse.json()).tasks, []);
  const undatedCalendarResponse = await request(
    `/workspaces/${ownerWorkspace.id}/calendar/tasks?startDate=${exactCalendarDate}&endDate=${exactCalendarDate}`,
    { headers: { cookie: ownerCookie } },
  );
  assert.equal(undatedCalendarResponse.status, 200);
  assert.equal(
    ((await undatedCalendarResponse.json()) as { tasks: Array<{ id: string }> }).tasks.some(
      ({ id }) => id === undatedTaskData.task.id,
    ),
    false,
  );
  assert.equal(
    (
      await request(`/tasks/${undatedTaskData.task.id}`, {
        method: "DELETE",
        headers: { cookie: ownerCookie },
      })
    ).status,
    204,
  );
  assert.equal(
    (
      await request(
        `/workspaces/${ownerWorkspace.id}/calendar/tasks?startDate=2026-02-30&endDate=2026-03-01`,
        { headers: { cookie: ownerCookie } },
      )
    ).status,
    400,
  );

  const firstWorkspaceActivityResponse = await request(
    `/workspaces/${ownerWorkspace.id}/activity`,
    { headers: { cookie: ownerCookie } },
  );
  assert.equal(firstWorkspaceActivityResponse.status, 200);
  const firstWorkspaceActivity = (await firstWorkspaceActivityResponse.json()) as {
    activities: Array<{ action: string; workspaceId?: string }>;
  };
  assert.ok(firstWorkspaceActivity.activities.some(({ action }) => action === "PROJECT_CREATED"));
  assert.ok(firstWorkspaceActivity.activities.some(({ action }) => action === "TASK_CREATED"));
  assert.ok(firstWorkspaceActivity.activities.some(({ action }) => action === "TASK_ASSIGNED"));
  const ownerPendingInvitations = await request("/invitations/pending", {
    headers: { cookie: ownerCookie },
  });
  assert.equal(ownerPendingInvitations.status, 200);
  assert.deepEqual((await ownerPendingInvitations.json()).invitations, []);

  const secondWorkspaceResponse = await request("/workspaces", {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ name: "Quality second workspace" }),
  });
  assert.equal(secondWorkspaceResponse.status, 201);
  const secondWorkspaceData = (await secondWorkspaceResponse.json()) as {
    workspace: { id: string; name: string };
  };
  createdWorkspaceIds.push(secondWorkspaceData.workspace.id);
  const secondProjectResponse = await request("/projects", {
    method: "POST",
    headers: { cookie: ownerCookie, "x-workspace-id": secondWorkspaceData.workspace.id },
    body: JSON.stringify({ name: "Quality second workspace project" }),
  });
  assert.equal(secondProjectResponse.status, 201);
  const secondProjectData = (await secondProjectResponse.json()) as {
    project: { id: string; statuses: Array<{ id: string; name: string }> };
  };
  const secondTodoStatus = secondProjectData.project.statuses.find(
    (status) => status.name === "To do",
  );
  assert.ok(secondTodoStatus);
  const secondTaskResponse = await request(`/projects/${secondProjectData.project.id}/tasks`, {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({
      title: "Review second workspace plan",
      statusId: secondTodoStatus.id,
      assigneeId: ownerRecord.id,
    }),
  });
  assert.equal(secondTaskResponse.status, 201);
  const secondTaskData = (await secondTaskResponse.json()) as { task: { id: string } };
  const secondWorkspaceSearch = await request("/search?q=second%20workspace%20plan", {
    headers: { cookie: ownerCookie },
  });
  assert.equal(secondWorkspaceSearch.status, 200);
  assert.deepEqual(
    ((await secondWorkspaceSearch.json()) as { tasks: Array<{ id: string }> }).tasks.map(
      ({ id }) => id,
    ),
    [secondTaskData.task.id],
  );

  const focusToday = new Date();
  const focusTodayKey = focusToday.toISOString().slice(0, 10);
  const focusTodayStart = new Date(`${focusTodayKey}T00:00:00.000Z`);
  await prisma.task.update({
    where: { id: taskData.task.id },
    data: { dueDate: focusTodayStart },
  });
  await prisma.task.update({
    where: { id: secondTaskData.task.id },
    data: { dueDate: new Date(focusTodayStart.getTime() - 24 * 60 * 60 * 1000) },
  });
  const firstWorkspaceCalendar = await request(
    `/workspaces/${ownerWorkspace.id}/calendar/tasks?startDate=${focusTodayKey}&endDate=${focusTodayKey}`,
    { headers: { cookie: ownerCookie } },
  );
  assert.equal(firstWorkspaceCalendar.status, 200);
  assert.deepEqual(
    ((await firstWorkspaceCalendar.json()) as { tasks: Array<{ id: string }> }).tasks.map(
      ({ id }) => id,
    ),
    [taskData.task.id],
  );
  const secondWorkspaceDate = new Date(focusTodayStart.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const secondWorkspaceCalendar = await request(
    `/workspaces/${secondWorkspaceData.workspace.id}/calendar/tasks?startDate=${secondWorkspaceDate}&endDate=${secondWorkspaceDate}`,
    { headers: { cookie: ownerCookie } },
  );
  assert.equal(secondWorkspaceCalendar.status, 200);
  assert.deepEqual(
    ((await secondWorkspaceCalendar.json()) as { tasks: Array<{ id: string }> }).tasks.map(
      ({ id }) => id,
    ),
    [secondTaskData.task.id],
  );
  const taskFocusResponse = await request(
    `/tasks/assigned/focus?today=${focusTodayKey}`,
    { headers: { cookie: ownerCookie } },
  );
  assert.equal(taskFocusResponse.status, 200);
  const taskFocus = (await taskFocusResponse.json()) as {
    openCount: number;
    dueTodayCount: number;
    overdueCount: number;
    upcomingTasks: Array<{ id: string; projectId: string; workspace: { id: string } }>;
  };
  assert.equal(taskFocus.openCount, 2);
  assert.equal(taskFocus.dueTodayCount, 1);
  assert.equal(taskFocus.overdueCount, 1);
  assert.deepEqual(taskFocus.upcomingTasks.map(({ id }) => id), [taskData.task.id]);
  assert.equal(taskFocus.upcomingTasks[0]?.projectId, projectId);
  assert.equal(taskFocus.upcomingTasks[0]?.workspace.id, ownerWorkspace.id);

  const myTasksResponse = await request("/tasks/assigned", {
    headers: { cookie: ownerCookie },
  });
  assert.equal(myTasksResponse.status, 200);
  const myTasksData = (await myTasksResponse.json()) as {
    tasks: Array<{
      id: string;
      project: { id: string; workspace: { id: string; name: string } };
      statusIsCompleted: boolean;
    }>;
  };
  assert.deepEqual(
    myTasksData.tasks.map((task) => task.id).sort(),
    [taskData.task.id, secondTaskData.task.id].sort(),
  );
  assert.ok(myTasksData.tasks.every((task) => task.statusIsCompleted === false));
  assert.ok(myTasksData.tasks.some(
    (task) => task.project.workspace.id === secondWorkspaceData.workspace.id,
  ));

  const completeTaskResponse = await request(`/tasks/${taskData.task.id}`, {
    method: "PATCH",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ statusId: doneStatus.id }),
  });
  assert.equal(completeTaskResponse.status, 200);
  const openTasksResponse = await request("/tasks/assigned", {
    headers: { cookie: ownerCookie },
  });
  const openTasksData = (await openTasksResponse.json()) as { tasks: Array<{ id: string }> };
  assert.ok(openTasksData.tasks.every((task) => task.id !== taskData.task.id));
  const allTasksResponse = await request("/tasks/assigned?includeCompleted=true", {
    headers: { cookie: ownerCookie },
  });
  assert.equal(allTasksResponse.status, 200);
  const allTasksData = (await allTasksResponse.json()) as {
    tasks: Array<{ id: string; statusIsCompleted: boolean }>;
  };
  assert.ok(allTasksData.tasks.some(
    (task) => task.id === taskData.task.id && task.statusIsCompleted,
  ));
  const reopenTaskResponse = await request(`/tasks/${taskData.task.id}`, {
    method: "PATCH",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ statusId: todoStatus.id }),
  });
  assert.equal(reopenTaskResponse.status, 200);

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
  const outsiderSearch = await request("/search?q=searchableprojectdescriptionmarker", {
    headers: { cookie: outsiderCookie },
  });
  assert.equal(outsiderSearch.status, 200);
  assert.deepEqual(await outsiderSearch.json(), { projects: [], tasks: [] });
  const outsiderTaskSearch = await request("/search?q=searchabletaskdescriptionmarker", {
    headers: { cookie: outsiderCookie },
  });
  assert.equal(outsiderTaskSearch.status, 200);
  assert.deepEqual(await outsiderTaskSearch.json(), { projects: [], tasks: [] });

  const outsiderCalendar = await request(
    `/workspaces/${ownerWorkspace.id}/calendar/tasks?startDate=${focusTodayKey}&endDate=${focusTodayKey}`,
    { headers: { cookie: outsiderCookie } },
  );
  assert.equal(outsiderCalendar.status, 404);
  const outsiderActivity = await request(
    `/workspaces/${ownerWorkspace.id}/activity`,
    { headers: { cookie: outsiderCookie } },
  );
  assert.equal(outsiderActivity.status, 404);
  const outsiderInvitations = await request("/invitations/pending", {
    headers: { cookie: outsiderCookie },
  });
  assert.equal(outsiderInvitations.status, 200);
  assert.deepEqual((await outsiderInvitations.json()).invitations, []);
  const outsiderFocus = await request(
    `/tasks/assigned/focus?today=${new Date().toISOString().slice(0, 10)}`,
    { headers: { cookie: outsiderCookie } },
  );
  assert.equal(outsiderFocus.status, 200);
  assert.equal((await outsiderFocus.json()).openCount, 0);

  const outsiderMyTasks = await request("/tasks/assigned", {
    headers: { cookie: outsiderCookie },
  });
  assert.equal(outsiderMyTasks.status, 200);
  assert.deepEqual((await outsiderMyTasks.json()) as { tasks: unknown[] }, { tasks: [] });

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
  const invitationResponseData = (await invitationResponse.json()) as {
    invitation: { id: string };
  };
  const invitationId = invitationResponseData.invitation.id;
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

  await prisma.workspaceInvitation.update({
    where: { id: invitationId },
    data: { role: "OWNER" },
  });
  const invalidManagerInvitationList = await request(
    `/workspaces/${ownerWorkspace.id}/invitations`,
    {
      headers: {
        cookie: ownerCookie,
        "x-workspace-id": ownerWorkspace.id,
      },
    },
  );
  assert.equal(invalidManagerInvitationList.status, 200);
  assert.deepEqual((await invalidManagerInvitationList.json()).invitations, []);
  const invalidRecipientInvitationList = await request("/invitations/pending", {
    headers: { cookie: inviteeCookie },
  });
  assert.equal(invalidRecipientInvitationList.status, 200);
  assert.deepEqual((await invalidRecipientInvitationList.json()).invitations, []);
  assert.equal(
    (
      await request(`/invitations/preview/${encodeURIComponent(invitationToken)}`)
    ).status,
    409,
  );
  const membershipsBeforeInvalidAccept = await prisma.workspaceMember.count({
    where: { workspaceId: ownerWorkspace.id, userId: invitedUser.id },
  });
  assert.equal(membershipsBeforeInvalidAccept, 0);
  assert.equal(
    (
      await request("/invitations/accept", {
        method: "POST",
        headers: { cookie: inviteeCookie },
        body: JSON.stringify({ token: invitationToken }),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(`/invitations/${invitationId}/accept`, {
        method: "POST",
        headers: { cookie: inviteeCookie },
      })
    ).status,
    409,
  );
  assert.equal(
    await prisma.workspaceMember.count({
      where: { workspaceId: ownerWorkspace.id, userId: invitedUser.id },
    }),
    membershipsBeforeInvalidAccept,
  );
  assert.equal(
    (await prisma.workspace.findUniqueOrThrow({ where: { id: ownerWorkspace.id } })).ownerId,
    ownerRecord.id,
  );
  await prisma.workspaceInvitation.update({
    where: { id: invitationId },
    data: { role: "MEMBER" },
  });

  const pendingInvitationsResponse = await request("/invitations/pending", {
    headers: { cookie: inviteeCookie },
  });
  assert.equal(pendingInvitationsResponse.status, 200);
  const pendingInvitations = (await pendingInvitationsResponse.json()) as {
    invitations: Array<{
      id: string;
      workspaceId: string;
      workspaceName: string;
      inviterName: string;
    }>;
  };
  const recipientInvitation = pendingInvitations.invitations.find(
    ({ workspaceId }) => workspaceId === ownerWorkspace.id,
  );
  assert.ok(recipientInvitation);
  assert.equal(recipientInvitation.workspaceName, ownerWorkspace.name);
  assert.equal(recipientInvitation.inviterName, ownerRecord.name);
  assert.equal("token" in recipientInvitation, false);
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
  const invitedMemberSearch = await request("/search?q=searchableprojectdescriptionmarker", {
    headers: { cookie: inviteeCookie },
  });
  assert.equal(invitedMemberSearch.status, 200);
  assert.deepEqual(
    ((await invitedMemberSearch.json()) as { projects: Array<{ id: string }> }).projects.map(
      ({ id }) => id,
    ),
    [projectId],
  );

  const secondWorkspaceInvitationResponse = await request(
    `/workspaces/${secondWorkspaceData.workspace.id}/invitations`,
    {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        "x-workspace-id": secondWorkspaceData.workspace.id,
      },
      body: JSON.stringify({ email: invitationEmail, role: "MEMBER" }),
    },
  );
  assert.equal(secondWorkspaceInvitationResponse.status, 201);
  const secondWorkspaceInvitation = (await secondWorkspaceInvitationResponse.json()) as {
    invitation: { id: string };
  };
  const acceptedFromInbox = await request(
    `/invitations/${secondWorkspaceInvitation.invitation.id}/accept`,
    { method: "POST", headers: { cookie: inviteeCookie } },
  );
  assert.equal(acceptedFromInbox.status, 200);
  const inboxAcceptedData = (await acceptedFromInbox.json()) as {
    workspace: { id: string };
  };
  assert.equal(inboxAcceptedData.workspace.id, secondWorkspaceData.workspace.id);

  const thirdWorkspaceResponse = await request("/workspaces", {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ name: "Quality decline workspace" }),
  });
  assert.equal(thirdWorkspaceResponse.status, 201);
  const thirdWorkspace = (await thirdWorkspaceResponse.json()) as {
    workspace: { id: string };
  };
  createdWorkspaceIds.push(thirdWorkspace.workspace.id);
  const declineInvitationResponse = await request(
    `/workspaces/${thirdWorkspace.workspace.id}/invitations`,
    {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        "x-workspace-id": thirdWorkspace.workspace.id,
      },
      body: JSON.stringify({ email: invitationEmail, role: "MEMBER" }),
    },
  );
  assert.equal(declineInvitationResponse.status, 201);
  const declineInvitation = (await declineInvitationResponse.json()) as {
    invitation: { id: string };
  };
  const declinedResponse = await request(
    `/invitations/${declineInvitation.invitation.id}/decline`,
    { method: "POST", headers: { cookie: inviteeCookie } },
  );
  assert.equal(declinedResponse.status, 204);
  assert.equal(
    await prisma.workspaceMember.count({
      where: { workspaceId: thirdWorkspace.workspace.id, userId: invitedUser.id },
    }),
    0,
  );

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

  await prisma.workspaceMember.delete({
    where: { workspaceId_userId: { workspaceId: ownerWorkspace.id, userId: invitedUser.id } },
  });
  const removedMemberSearch = await request(
    "/search?q=searchableprojectdescriptionmarker",
    { headers: { cookie: inviteeCookie } },
  );
  assert.equal(removedMemberSearch.status, 200);
  assert.deepEqual(await removedMemberSearch.json(), { projects: [], tasks: [] });
  const removedTaskMemberSearch = await request(
    "/search?q=searchabletaskdescriptionmarker",
    { headers: { cookie: inviteeCookie } },
  );
  assert.equal(removedTaskMemberSearch.status, 200);
  assert.deepEqual(await removedTaskMemberSearch.json(), { projects: [], tasks: [] });

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

test("personal account settings protect profiles, preferences, photos, and sessions", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `account-owner-${suffix}@example.test`;
  const newEmail = `account-owner-new-${suffix}@example.test`;
  const targetEmail = `account-target-${suffix}@example.test`;
  const newPassword = "quality-suite-password-updated-456";
  const anonymousProfile = await request("/account");
  assert.equal(anonymousProfile.status, 401);

  async function createVerifiedUser(userEmail: string, name: string) {
    const registration = await request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email: userEmail, password }),
    });
    assert.equal(registration.status, 201);
    const user = await prisma.user.findFirstOrThrow({
      where: { email: userEmail },
      select: {
        id: true,
        workspaceMemberships: {
          select: { workspaceId: true, workspace: { select: { id: true } } },
        },
      },
    });
    createdUserIds.push(user.id);
    for (const membership of user.workspaceMemberships) {
      createdWorkspaceIds.push(membership.workspaceId);
    }
    const code = codeFromTestEmail(userEmail);
    const verified = await request("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email: userEmail, code }),
    });
    assert.equal(verified.status, 200);
    return user;
  }

  const owner = await createVerifiedUser(email, "Account Owner");
  const ownerWorkspaceId = owner.workspaceMemberships[0]?.workspaceId;
  assert.ok(ownerWorkspaceId);
  const ownerLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  assert.equal(ownerLogin.status, 200);
  const ownerCookie = cookieFrom(ownerLogin);

  const profileUpdate = await request("/account/profile", {
    method: "PATCH",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ name: "Updated Account Owner" }),
  });
  assert.equal(profileUpdate.status, 200);
  assert.deepEqual(await profileUpdate.json(), { name: "Updated Account Owner" });
  const profileResponse = await request("/account", { headers: { cookie: ownerCookie } });
  assert.equal(profileResponse.status, 200);
  const profile = (await profileResponse.json()) as Record<string, unknown>;
  assert.equal(profile.name, "Updated Account Owner");
  assert.equal(profile.email, email);
  assert.equal(profile.hasProfilePhoto, false);
  assert.equal("profilePhotoBytes" in profile, false);

  const validPng = await sharp({
    create: { width: 24, height: 16, channels: 3, background: "#6259d9" },
  })
    .png()
    .toBuffer();
  const imageForm = new FormData();
  imageForm.set("photo", new Blob([validPng], { type: "image/png" }), "profile.png");
  const photoUpload = await request("/account/profile-photo", {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: imageForm,
  });
  assert.equal(photoUpload.status, 200, await photoUpload.clone().text());
  const storedPhoto = await request("/account/profile-photo", {
    headers: { cookie: ownerCookie },
  });
  assert.equal(storedPhoto.status, 200);
  assert.equal(storedPhoto.headers.get("content-type"), "image/webp");
  const storedMetadata = await sharp(Buffer.from(await storedPhoto.arrayBuffer())).metadata();
  assert.equal(storedMetadata.width, 512);
  assert.equal(storedMetadata.height, 512);
  assert.equal(storedMetadata.format, "webp");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).avatarUrl, "/api/v1/account/profile-photo");

  const invalidImageForm = new FormData();
  invalidImageForm.set("photo", new Blob(["not an image"], { type: "image/jpeg" }), "fake.jpg");
  assert.equal(
    (
      await request("/account/profile-photo", {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: invalidImageForm,
      })
    ).status,
    400,
  );
  const oversizedPhoto = new FormData();
  oversizedPhoto.set(
    "photo",
    new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/png" }),
    "oversized.png",
  );
  assert.equal(
    (
      await request("/account/profile-photo", {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: oversizedPhoto,
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await request("/account/profile-photo", {
        method: "DELETE",
        headers: { cookie: ownerCookie },
      })
    ).status,
    204,
  );

  const emailChange = await request("/account/email-change", {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ email: newEmail }),
  });
  assert.equal(emailChange.status, 200);
  assert.equal((await emailChange.json()).verificationRequired, true);
  const pendingProfile = (await (
    await request("/account", { headers: { cookie: ownerCookie } })
  ).json()) as { email: string; pendingEmail: string };
  assert.equal(pendingProfile.email, email);
  assert.equal(pendingProfile.pendingEmail, newEmail);
  assert.equal(
    (
      await request("/account/email-change/confirm", {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ code: "000000" }),
      })
    ).status,
    400,
  );
  const changeCode = codeFromTestEmail(newEmail);
  assert.equal(
    (
      await request("/account/email-change/confirm", {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ code: changeCode }),
      })
    ).status,
    204,
  );
  const changedProfile = (await (
    await request("/account", { headers: { cookie: ownerCookie } })
  ).json()) as { email: string; pendingEmail: string | null; emailVerifiedAt: string | null };
  assert.equal(changedProfile.email, newEmail);
  assert.equal(changedProfile.pendingEmail, null);
  assert.ok(changedProfile.emailVerifiedAt);

  const notificationTypes = [
    "TASK_ASSIGNED",
    "TASK_MENTIONED",
    "COMMENT_ADDED",
    "DUE_DATE_REMINDER",
    "PROJECT_UPDATED",
    "INVITATION_RECEIVED",
  ] as const;
  const defaultPreferences = (await (
    await request("/account/notifications", { headers: { cookie: ownerCookie } })
  ).json()) as { preferences: Array<{ type: string; inApp: boolean; email: boolean }> };
  assert.equal(defaultPreferences.preferences.length, notificationTypes.length);
  assert.ok(
    defaultPreferences.preferences.every(({ type, inApp, email: emailEnabled }) =>
      inApp && emailEnabled === (type === "INVITATION_RECEIVED"),
    ),
  );
  const savedPreferences = await request("/account/notifications", {
    method: "PUT",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({
      preferences: notificationTypes.map((type) => ({
        type,
        inApp: type !== "TASK_MENTIONED",
        email: type === "TASK_ASSIGNED" ||
          type === "INVITATION_RECEIVED" ||
          type === "DUE_DATE_REMINDER" ||
          type === "PROJECT_UPDATED",
      })),
    }),
  });
  assert.equal(savedPreferences.status, 200);
  assert.equal(
    await prisma.notificationPreference.count({ where: { userId: owner.id } }),
    notificationTypes.length,
  );

  const target = await createVerifiedUser(targetEmail, "Account Target");
  const targetWorkspaceId = target.workspaceMemberships[0]?.workspaceId;
  assert.ok(targetWorkspaceId);
  await prisma.workspaceMember.create({
    data: { workspaceId: ownerWorkspaceId, userId: target.id, role: "MEMBER" },
  });
  const targetLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: targetEmail, password }),
  });
  assert.equal(targetLogin.status, 200);
  const targetCookie = cookieFrom(targetLogin);
  const enabledPreferences = await request("/account/notifications", {
    method: "PUT",
    headers: { cookie: targetCookie },
    body: JSON.stringify({
      preferences: notificationTypes.map((type) => ({
        type,
        inApp: type !== "TASK_MENTIONED",
        email: type === "TASK_ASSIGNED" ||
          type === "INVITATION_RECEIVED" ||
          type === "DUE_DATE_REMINDER" ||
          type === "PROJECT_UPDATED",
      })),
    }),
  });
  assert.equal(enabledPreferences.status, 200);

  const createdProject = await request("/projects", {
    method: "POST",
    headers: { cookie: ownerCookie, "x-workspace-id": ownerWorkspaceId },
    body: JSON.stringify({ name: "Account notification test project" }),
  });
  assert.equal(createdProject.status, 201);
  const project = (await createdProject.json()) as {
    project: { id: string; statuses: Array<{ id: string; name: string }> };
  };
  const todo = project.project.statuses.find(({ name }) => name === "To do");
  assert.ok(todo);
  const completed = project.project.statuses.find(({ name }) => name === "Done");
  assert.ok(completed);
  await prisma.projectMember.create({
    data: { projectId: project.project.id, userId: target.id, projectRole: "MEMBER" },
  });
  const assignedTask = await request(`/projects/${project.project.id}/tasks`, {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({
      title: "Preference-controlled task",
      statusId: todo.id,
      assigneeId: target.id,
    }),
  });
  assert.equal(assignedTask.status, 201);
  const assigned = (await assignedTask.json()) as { task: { id: string } };
  const mentionedComment = await request(`/tasks/${assigned.task.id}/comments`, {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ body: `@${targetEmail} please review this task` }),
  });
  assert.equal(mentionedComment.status, 201);
  const hiddenMention = await prisma.notification.findFirstOrThrow({
    where: { recipientId: target.id, entityId: assigned.task.id, type: "TASK_MENTIONED" },
  });
  assert.equal(hiddenMention.inApp, false);
  const inboxWithoutMention = await request("/notifications", { headers: { cookie: targetCookie } });
  assert.equal(inboxWithoutMention.status, 200);
  assert.ok(
    !((await inboxWithoutMention.json()) as { notifications: Array<{ id: string }> }).notifications.some(
      ({ id }) => id === hiddenMention.id,
    ),
  );
  await app.get(NotificationsService).processPendingEmailDeliveries();
  const emailService = app.get(EmailService);
  const firstDeliveryEmail = takeTestEmails(targetEmail).filter((message) =>
    message.subject.includes("notification"),
  );
  assert.equal(firstDeliveryEmail.length, 2);
  const projectUpdateNotification = await prisma.notification.findFirstOrThrow({
    where: {
      recipientId: target.id,
      entityType: "TASK",
      entityId: assigned.task.id,
      type: "PROJECT_UPDATED",
    },
  });
  assert.equal(projectUpdateNotification.inApp, true);
  assert.equal(
    (await prisma.notificationEmailDelivery.findUniqueOrThrow({
      where: { notificationId: projectUpdateNotification.id },
    })).status,
    "SENT",
  );
  assert.equal(
    await prisma.notification.count({
      where: {
        recipientId: owner.id,
        entityType: "TASK",
        entityId: assigned.task.id,
        type: "PROJECT_UPDATED",
      },
    }),
    0,
    "An actor must not receive their own project-update notification.",
  );
  const notificationRecord = await prisma.notification.findFirstOrThrow({
    where: { recipientId: target.id, entityId: assigned.task.id, type: "TASK_ASSIGNED" },
    include: { actor: { select: { id: true, name: true } } },
  });
  const taskRecord = await prisma.task.findUniqueOrThrow({
    where: { id: assigned.task.id },
    select: { id: true, title: true, projectId: true, project: { select: { name: true } } },
  });
  const notificationForReplay: CreatedNotification = {
    recipientId: target.id,
    inAppEnabled: true,
    hasEmailDelivery: true,
    summary: {
      id: notificationRecord.id,
      type: notificationRecord.type,
      entityType: notificationRecord.entityType,
      entityId: notificationRecord.entityId,
      createdAt: notificationRecord.createdAt.toISOString(),
      readAt: null,
      actor: notificationRecord.actor,
      task: {
        title: taskRecord.title,
        projectId: taskRecord.projectId,
        projectName: taskRecord.project.name,
      },
      project: null,
      workspaceInvitation: null,
    },
  };
  await Promise.all([
    app.get(NotificationsService).publishCreated(notificationForReplay),
    app.get(NotificationsService).publishCreated(notificationForReplay),
  ]);
  assert.deepEqual(takeTestEmails(targetEmail), []);
  assert.equal(
    (await prisma.notificationEmailDelivery.findUniqueOrThrow({
      where: { notificationId: notificationRecord.id },
    })).status,
    "SENT",
  );
  await app.get(NotificationsService).processPendingEmailDeliveries();
  assert.deepEqual(takeTestEmails(targetEmail), []);
  assert.equal(
    (await prisma.notificationEmailDelivery.findUniqueOrThrow({
      where: { notificationId: notificationRecord.id },
    })).status,
    "SENT",
  );

  const originalSendNotification = emailService.sendNotification.bind(emailService);
  let postCommitSendCount = 0;
  let failedNotificationId = "";
  emailService.sendNotification = async () => {
    postCommitSendCount += 1;
    throw new Error("mock SMTP failure");
  };
  try {
    const failedDeliveryTask = await request(`/projects/${project.project.id}/tasks`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({
        title: "SMTP failure isolation task",
        statusId: todo.id,
        assigneeId: target.id,
      }),
    });
    assert.equal(failedDeliveryTask.status, 201);
    const failedTask = (await failedDeliveryTask.json()) as { task: { id: string } };
    const failedNotification = await prisma.notification.findFirstOrThrow({
      where: { recipientId: target.id, entityId: failedTask.task.id, type: "TASK_ASSIGNED" },
    });
    failedNotificationId = failedNotification.id;
    assert.equal(failedNotification.inApp, true);
    assert.equal(
      (await prisma.notificationEmailDelivery.findUniqueOrThrow({
        where: { notificationId: failedNotification.id },
      })).status,
      "PENDING",
    );
    const targetInbox = await request("/notifications", { headers: { cookie: targetCookie } });
    assert.equal(targetInbox.status, 200);
    assert.ok(
      ((await targetInbox.json()) as { notifications: Array<{ id: string }> }).notifications.some(
        ({ id }) => id === failedNotification.id,
      ),
    );
    assert.equal(postCommitSendCount, 0);
  } finally {
    emailService.sendNotification = originalSendNotification;
  }

  const failedDelivery = await prisma.notificationEmailDelivery.findUniqueOrThrow({
    where: { notificationId: failedNotificationId },
  });
  assert.equal(failedDelivery.attemptCount, 0);
  assert.equal(failedDelivery.status, "PENDING");

  const notificationsService = app.get(NotificationsService);
  const dueNow = new Date();
  const reminderTask = await prisma.task.create({
    data: {
      projectId: project.project.id,
      title: "UTC due reminder test",
      statusId: todo.id,
      reporterId: owner.id,
      assigneeId: target.id,
      dueDate: new Date(dueNow.getTime() + 12 * 60 * 60 * 1000),
    },
    select: { id: true, dueDate: true },
  });
  assert.ok(await notificationsService.createDueDateReminders(dueNow) >= 1);
  assert.equal(await notificationsService.createDueDateReminders(dueNow), 0);
  const dueReminder = await prisma.notification.findFirstOrThrow({
    where: { entityId: reminderTask.id, type: "DUE_DATE_REMINDER" },
  });
  assert.equal(dueReminder.recipientId, target.id);
  assert.equal(
    (await prisma.notificationEmailDelivery.findUniqueOrThrow({
      where: { notificationId: dueReminder.id },
    })).status,
    "PENDING",
  );

  const nextDueDate = new Date(dueNow.getTime() + 18 * 60 * 60 * 1000);
  const rescheduled = await request(`/tasks/${reminderTask.id}`, {
    method: "PATCH",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ assigneeId: owner.id, dueDate: nextDueDate.toISOString() }),
  });
  assert.equal(rescheduled.status, 200);
  assert.ok((await prisma.notification.findUniqueOrThrow({
    where: { id: dueReminder.id },
  })).readAt);
  assert.equal(
    (await prisma.notificationEmailDelivery.findUniqueOrThrow({
      where: { notificationId: dueReminder.id },
    })).status,
    "CANCELLED",
  );
  assert.equal(await notificationsService.createDueDateReminders(new Date()), 1);
  const replacementReminder = await prisma.notification.findFirstOrThrow({
    where: { entityId: reminderTask.id, type: "DUE_DATE_REMINDER", recipientId: owner.id },
  });
  assert.notEqual(replacementReminder.eventKey, dueReminder.eventKey);

  const completedReminderTask = await request(`/tasks/${reminderTask.id}`, {
    method: "PATCH",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ statusId: completed.id }),
  });
  assert.equal(completedReminderTask.status, 200);
  assert.equal(await notificationsService.createDueDateReminders(new Date()), 0);
  assert.ok((await prisma.notification.findUniqueOrThrow({
    where: { id: replacementReminder.id },
  })).readAt);
  assert.equal(
    (await prisma.notificationEmailDelivery.findUniqueOrThrow({
      where: { notificationId: replacementReminder.id },
    })).status,
    "CANCELLED",
  );

  const cancelledStatus = await prisma.projectStatus.create({
    data: {
      projectId: project.project.id,
      name: "Cancelled",
      position: 99,
    },
    select: { id: true },
  });
  const cancelledTask = await prisma.task.create({
    data: {
      projectId: project.project.id,
      title: "Cancelled task without reminder",
      statusId: cancelledStatus.id,
      reporterId: owner.id,
      assigneeId: target.id,
      dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  const undatedAssignedTask = await prisma.task.create({
    data: {
      projectId: project.project.id,
      title: "Undated task without reminder",
      statusId: todo.id,
      reporterId: owner.id,
      assigneeId: target.id,
    },
    select: { id: true },
  });
  const unassignedDueTask = await prisma.task.create({
    data: {
      projectId: project.project.id,
      title: "Unassigned task without reminder",
      statusId: todo.id,
      reporterId: owner.id,
      dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  const missedWindowTask = await prisma.task.create({
    data: {
      projectId: project.project.id,
      title: "Recently overdue task reminder",
      statusId: todo.id,
      reporterId: owner.id,
      assigneeId: target.id,
      dueDate: new Date(Date.now() - 3 * 60 * 60 * 1000),
    },
    select: { id: true },
  });
  assert.equal(await notificationsService.createDueDateReminders(new Date()), 1);
  assert.equal(await notificationsService.createDueDateReminders(new Date()), 0);
  assert.equal(
    await prisma.notification.count({
      where: {
        type: "DUE_DATE_REMINDER",
        entityId: { in: [cancelledTask.id, undatedAssignedTask.id, unassignedDueTask.id] },
      },
    }),
    0,
  );
  assert.equal(
    await prisma.notification.count({
      where: { type: "DUE_DATE_REMINDER", entityId: missedWindowTask.id },
    }),
    1,
  );
  await notificationsService.processPendingEmailDeliveries();
  const missedReminder = await prisma.notification.findFirstOrThrow({
    where: { type: "DUE_DATE_REMINDER", entityId: missedWindowTask.id },
  });
  assert.equal(
    (await prisma.notificationEmailDelivery.findUniqueOrThrow({
      where: { notificationId: missedReminder.id },
    })).status,
    "SENT",
  );
  assert.ok(takeTestEmails(targetEmail).some(({ text }) => text.includes("is overdue.")));

  const projectUpdateResponse = await request(`/projects/${project.project.id}`, {
    method: "PATCH",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ name: "Updated notification project" }),
  });
  assert.equal(projectUpdateResponse.status, 200);
  const metadataUpdate = await prisma.notification.findFirstOrThrow({
    where: {
      recipientId: target.id,
      type: "PROJECT_UPDATED",
      entityType: "PROJECT",
      entityId: project.project.id,
    },
  });
  assert.equal(
    await prisma.notification.count({
      where: {
        recipientId: owner.id,
        type: "PROJECT_UPDATED",
        entityType: "PROJECT",
        entityId: project.project.id,
      },
    }),
    0,
  );
  await prisma.notificationPreference.update({
    where: { userId_type: { userId: target.id, type: "PROJECT_UPDATED" } },
    data: { inApp: false, email: false },
  });
  const updateCountBeforeDisabledChange = await prisma.notification.count({
    where: { recipientId: target.id, type: "PROJECT_UPDATED", entityType: "TASK" },
  });
  const priorityUpdate = await request(`/tasks/${assigned.task.id}`, {
    method: "PATCH",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ priority: "HIGH" }),
  });
  assert.equal(priorityUpdate.status, 200);
  assert.equal(
    await prisma.notification.count({
      where: { recipientId: target.id, type: "PROJECT_UPDATED", entityType: "TASK" },
    }),
    updateCountBeforeDisabledChange,
  );
  await prisma.notificationPreference.update({
    where: { userId_type: { userId: target.id, type: "PROJECT_UPDATED" } },
    data: { inApp: true, email: true },
  });

  const pendingAccessNotification = await prisma.$transaction((transaction) =>
    notificationsService.createProjectUpdateNotifications(
      transaction,
      owner.id,
      "TASK",
      assigned.task.id,
      randomUUID(),
    ),
  );
  assert.equal(pendingAccessNotification.length, 1);
  const pendingAccessId = pendingAccessNotification[0]!.summary.id;
  await prisma.projectMember.delete({
    where: { projectId_userId: { projectId: project.project.id, userId: target.id } },
  });
  await notificationsService.processPendingEmailDeliveries();
  assert.equal(
    (await prisma.notificationEmailDelivery.findUniqueOrThrow({
      where: { notificationId: pendingAccessId },
    })).status,
    "CANCELLED",
  );
  const targetInboxAfterRemoval = await request("/notifications", {
    headers: { cookie: targetCookie },
  });
  assert.ok(
    !((await targetInboxAfterRemoval.json()) as { notifications: Array<{ id: string }> })
      .notifications.some(({ id }) => id === metadataUpdate.id || id === pendingAccessId),
  );

  async function createQueuedEmail(input: {
    attemptCount?: number;
    status?: "PENDING" | "PROCESSING";
    leaseExpiresAt?: Date | null;
  } = {}): Promise<string> {
    const record = await prisma.notification.create({
      data: {
        recipientId: target.id,
        actorId: owner.id,
        type: "TASK_ASSIGNED",
        entityType: "TASK",
        entityId: assigned.task.id,
        eventKey: `outbox-test:${randomUUID()}`,
        emailDelivery: {
          create: {
            attemptCount: input.attemptCount ?? 0,
            status: input.status ?? "PENDING",
            ...(input.leaseExpiresAt !== undefined ? { leaseExpiresAt: input.leaseExpiresAt } : {}),
            ...(input.status === "PROCESSING" ? { attemptedAt: new Date(0) } : {}),
            nextAttemptAt: new Date(0),
          },
        },
      },
      select: { id: true },
    });
    return record.id;
  }

  let concurrentSendCount = 0;
  emailService.sendNotification = async () => {
    concurrentSendCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
  };
  const concurrentDeliveryId = await createQueuedEmail();
  const concurrentClaims = await Promise.all([
    notificationsService.processPendingEmailDeliveries(1),
    notificationsService.processPendingEmailDeliveries(1),
  ]);
  assert.equal(concurrentClaims.reduce((sum, count) => sum + count, 0), 1);
  assert.equal(concurrentSendCount, 1);
  assert.equal(
    (await prisma.notificationEmailDelivery.findUniqueOrThrow({
      where: { notificationId: concurrentDeliveryId },
    })).status,
    "SENT",
  );
  assert.equal(
    (await prisma.notificationEmailDelivery.findUniqueOrThrow({
      where: { notificationId: concurrentDeliveryId },
    })).claimToken,
    null,
  );

  let releaseSlowEmail!: () => void;
  const slowEmailGate = new Promise<void>((resolve) => {
    releaseSlowEmail = resolve;
  });
  let slowEmailSendCount = 0;
  emailService.sendNotification = async () => {
    slowEmailSendCount += 1;
    await slowEmailGate;
  };
  const slowDeliveryId = await createQueuedEmail();
  const slowDeliveryProcessing = notificationsService.processPendingEmailDeliveries(1);
  let slowDelivery;
  const claimDeadline = Date.now() + 5_000;
  do {
    slowDelivery = await prisma.notificationEmailDelivery.findUniqueOrThrow({
      where: { notificationId: slowDeliveryId },
      select: { status: true, claimToken: true },
    });
    if (slowDelivery.status === "PROCESSING" && slowDelivery.claimToken) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (Date.now() < claimDeadline);
  assert.equal(slowDelivery.status, "PROCESSING");
  assert.ok(slowDelivery.claimToken);
  await new Promise((resolve) => setTimeout(resolve, 22_000));
  const renewedSlowDelivery = await prisma.notificationEmailDelivery.findUniqueOrThrow({
    where: { notificationId: slowDeliveryId },
    select: { leaseExpiresAt: true, claimToken: true, attemptCount: true },
  });
  assert.equal(renewedSlowDelivery.claimToken, slowDelivery.claimToken);
  assert.ok(renewedSlowDelivery.leaseExpiresAt!.getTime() > Date.now() + 45_000);
  assert.equal(renewedSlowDelivery.attemptCount, 1);
  releaseSlowEmail();
  assert.equal(await slowDeliveryProcessing, 1);
  assert.equal(slowEmailSendCount, 1);
  assert.equal(
    (await prisma.notificationEmailDelivery.findUniqueOrThrow({
      where: { notificationId: slowDeliveryId },
    })).status,
    "SENT",
  );

  const expiredLeaseId = await createQueuedEmail({
    status: "PROCESSING",
    attemptCount: 1,
    leaseExpiresAt: new Date(0),
  });
  assert.equal(await notificationsService.processPendingEmailDeliveries(), 1);
  assert.equal(
    (await prisma.notificationEmailDelivery.findUniqueOrThrow({
      where: { notificationId: expiredLeaseId },
    })).attemptCount,
    2,
  );

  let permanentAttemptCount = 0;
  emailService.sendNotification = async () => {
    permanentAttemptCount += 1;
    throw new EmailDeliveryError("Permanent test failure.", false, "SMTP_PERMANENT_TEST");
  };
  const permanentDeliveryId = await createQueuedEmail();
  await notificationsService.processPendingEmailDeliveries();
  assert.equal(permanentAttemptCount, 1);
  assert.equal(
    (await prisma.notificationEmailDelivery.findUniqueOrThrow({
      where: { notificationId: permanentDeliveryId },
    })).status,
    "FAILED",
  );

  let retryLimitAttemptCount = 0;
  emailService.sendNotification = async () => {
    retryLimitAttemptCount += 1;
    throw new EmailDeliveryError("Temporary test failure.", true, "SMTP_TEMPORARY_TEST");
  };
  const retryLimitDeliveryId = await createQueuedEmail({ attemptCount: 4 });
  await notificationsService.processPendingEmailDeliveries();
  assert.equal(retryLimitAttemptCount, 1);
  const terminalDelivery = await prisma.notificationEmailDelivery.findUniqueOrThrow({
    where: { notificationId: retryLimitDeliveryId },
  });
  assert.equal(terminalDelivery.status, "FAILED");
  assert.equal(terminalDelivery.attemptCount, 5);
  assert.equal(terminalDelivery.failureCode, "SMTP_TEMPORARY_TEST");
  assert.equal(await notificationsService.processPendingEmailDeliveries(), 0);
  assert.equal(retryLimitAttemptCount, 1);
  emailService.sendNotification = originalSendNotification;
  const permanentFailureId = await prisma.notification.create({
    data: {
      recipientId: target.id,
      actorId: owner.id,
      type: "TASK_ASSIGNED",
      entityType: "TASK",
      entityId: assigned.task.id,
      emailDelivery: { create: {} },
    },
    select: { id: true },
  });
  emailService.sendNotification = async () => {
    throw new EmailDeliveryError("Permanent test failure.", false, "SMTP_PERMANENT_TEST");
  };
  await notificationsService.processPendingEmailDeliveries();
  assert.equal(
    (await prisma.notificationEmailDelivery.findUniqueOrThrow({
      where: { notificationId: permanentFailureId.id },
    })).status,
    "FAILED",
  );
  emailService.sendNotification = originalSendNotification;

  const invitationWorkspaceResponse = await request("/workspaces", {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ name: "Account invitation preference workspace" }),
  });
  assert.equal(invitationWorkspaceResponse.status, 201);
  const invitationWorkspace = (await invitationWorkspaceResponse.json()) as {
    workspace: { id: string; name: string };
  };
  createdWorkspaceIds.push(invitationWorkspace.workspace.id);
  const inviteOnce = await request(
    `/workspaces/${invitationWorkspace.workspace.id}/invitations`,
    {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: targetEmail, role: "MEMBER" }),
    },
  );
  assert.equal(inviteOnce.status, 201);
  assert.equal(takeTestEmails(targetEmail).filter(({ subject }) => subject.includes("invited")).length, 1);
  const invitationNotification = await prisma.notification.findFirstOrThrow({
    where: { recipientId: target.id, type: "INVITATION_RECEIVED" },
  });
  assert.equal(invitationNotification.inApp, true);
  const inviteInbox = await request("/notifications", { headers: { cookie: targetCookie } });
  assert.equal(inviteInbox.status, 200);
  const inviteSummary = (
    (await inviteInbox.json()) as {
      notifications: Array<{
        id: string;
        workspaceInvitation: { workspaceName: string } | null;
      }>;
    }
  ).notifications.find(({ id }) => id === invitationNotification.id);
  assert.equal(inviteSummary?.workspaceInvitation?.workspaceName, invitationWorkspace.workspace.name);

  const invitationPrefsOff = await request("/account/notifications", {
    method: "PUT",
    headers: { cookie: targetCookie },
    body: JSON.stringify({
      preferences: notificationTypes.map((type) => ({
        type,
        inApp: true,
        email: type === "TASK_ASSIGNED",
      })),
    }),
  });
  assert.equal(invitationPrefsOff.status, 200);
  const inviteWithEmailDisabled = await request(
    `/workspaces/${invitationWorkspace.workspace.id}/invitations`,
    {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: targetEmail, role: "MEMBER" }),
    },
  );
  assert.equal(inviteWithEmailDisabled.status, 201);
  assert.deepEqual(takeTestEmails(targetEmail), []);
  assert.equal(
    await prisma.notification.count({
      where: {
        recipientId: target.id,
        type: "INVITATION_RECEIVED",
        entityId: invitationNotification.entityId,
      },
    }),
    1,
  );

  const targetSessions = (await (
    await request("/account/sessions", { headers: { cookie: targetCookie } })
  ).json()) as { sessions: Array<{ id: string; current: boolean }> };
  assert.ok(targetSessions.sessions.every((session) => !("token" in session) && !("tokenHash" in session)));
  assert.equal(targetSessions.sessions.length, 1);
  assert.equal(targetSessions.sessions[0]?.current, true);
  assert.equal(
    (
      await request(`/account/sessions/${targetSessions.sessions[0]!.id}`, {
        method: "DELETE",
        headers: { cookie: ownerCookie },
      })
    ).status,
    404,
  );

  const otherOwnerLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: newEmail, password }),
  });
  assert.equal(otherOwnerLogin.status, 200);
  const otherOwnerCookie = cookieFrom(otherOwnerLogin);
  const ownerSessions = (await (
    await request("/account/sessions", { headers: { cookie: ownerCookie } })
  ).json()) as { sessions: Array<{ id: string; current: boolean }> };
  assert.equal(ownerSessions.sessions.length, 2);
  assert.equal(
    (
      await request(`/account/sessions/${ownerSessions.sessions.find(({ current }) => !current)!.id}`, {
        method: "DELETE",
        headers: { cookie: ownerCookie },
      })
    ).status,
    204,
  );
  assert.equal((await request("/auth/me", { headers: { cookie: otherOwnerCookie } })).status, 401);

  const passwordSession = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: newEmail, password }),
  });
  assert.equal(passwordSession.status, 200);
  const passwordSessionCookie = cookieFrom(passwordSession);
  const invalidPasswordChange = await request("/account/password", {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ currentPassword: "invalid-current-password", newPassword }),
  });
  assert.equal(invalidPasswordChange.status, 401);
  const changedPasswordResponse = await request("/account/password", {
    method: "POST",
    headers: { cookie: ownerCookie },
    body: JSON.stringify({ currentPassword: password, newPassword }),
  });
  assert.equal(changedPasswordResponse.status, 204);
  assert.equal((await request("/auth/me", { headers: { cookie: passwordSessionCookie } })).status, 401);
  assert.equal((await request("/auth/me", { headers: { cookie: ownerCookie } })).status, 200);
  const remainingSessions = (await (
    await request("/account/sessions", { headers: { cookie: ownerCookie } })
  ).json()) as { sessions: Array<{ current: boolean }> };
  assert.equal(remainingSessions.sessions.length, 1);
  assert.equal(remainingSessions.sessions[0]?.current, true);
  assert.equal(
    (
      await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: newEmail, password }),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: newEmail, password: newPassword }),
      })
    ).status,
    200,
  );
});
