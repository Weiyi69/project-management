import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function assertWcagAa(page: import("@playwright/test").Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map(({ id, impact, description, nodes }) => ({
      id,
      impact,
      description,
      elements: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
    })),
  ).toEqual([]);
}

test("registers, creates project work, and loads accessible analytics", async ({ page }) => {
  test.setTimeout(120_000);
  const navigationDurations: Record<string, number> = {};
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `quality-browser-${suffix}@example.test`;
  const invitationToken = "quality-browser-invitation-token";
  let newWorkspaceId = "";
  await page.route(`**/api/v1/invitations/preview/${invitationToken}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        invitation: {
          email,
          role: "MEMBER",
          workspaceName: "Quality invited workspace",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          accepted: false,
        },
      }),
    }),
  );
  await page.route("**/api/v1/invitations/accept", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspace: {
          id: newWorkspaceId,
          name: "Quality browser user's workspace",
          slug: "quality-browser-workspace",
          role: "OWNER",
        },
      }),
    }),
  );
  const startedAt = performance.now();
  await page.goto(`/invitations/accept?token=${invitationToken}`);
  await expect(page.getByRole("heading", { name: "Join your workspace" })).toBeVisible();
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  navigationDurations.registrationPage = performance.now() - startedAt;
  await assertWcagAa(page);

  await page.getByLabel("Your name").fill("Quality Browser User");
  await expect(page.getByLabel("Email address")).toHaveValue(email);
  await page.getByRole("textbox", { name: "Password" }).fill("quality-suite-password-123");

  const registrationStartedAt = performance.now();
  const registrationResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/v1/auth/register"),
  );
  await page.getByRole("button", { name: "Create account" }).click();
  const registrationResponse = await registrationResponsePromise;
  const registrationBody = await registrationResponse.text();
  expect(
    registrationResponse.ok(),
    `Registration returned HTTP ${registrationResponse.status()}: ${registrationBody}`,
  ).toBe(true);

  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/verify-email");
  expect(
    (await page.context().cookies()).some((cookie) => cookie.name === "orbit_session"),
  ).toBe(false);
  await assertWcagAa(page);
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByText("Email verified successfully. You can now sign in.")).toBeVisible();
  expect(
    (await page.context().cookies()).some((cookie) => cookie.name === "orbit_session"),
  ).toBe(false);
  await page.getByRole("textbox", { name: "Password" }).fill("quality-suite-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Join your workspace" })).toBeVisible();
  const currentUser = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/me", { credentials: "include" });
    const body = (await response.json()) as { user?: { workspaceId?: string } };
    return body.user?.workspaceId ?? "";
  });
  expect(currentUser).not.toBe("");
  newWorkspaceId = currentUser;
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  navigationDurations.registration = performance.now() - registrationStartedAt;

  const projectsStartedAt = performance.now();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  const onboardingHeading = page.getByRole("heading", { name: "Welcome to your workspace" });
  await expect(onboardingHeading).toBeVisible();
  await expect(page.getByRole("link", { name: "Create your first project" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Invite team members" })).toBeVisible();
  await assertWcagAa(page);

  let releaseEmptyCalendar!: () => void;
  const heldEmptyCalendarResponse = new Promise<void>((resolve) => {
    releaseEmptyCalendar = resolve;
  });
  const calendarEndpoint = /\/api\/v1\/workspaces\/[^/]+\/calendar\/tasks/;
  await page.route(calendarEndpoint, async (route) => {
    await heldEmptyCalendarResponse;
    await route.continue();
  });
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page.getByText("Loading workspace calendar")).toBeVisible();
  releaseEmptyCalendar();
  await expect(page.getByRole("heading", { name: "No tasks to show" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create task" })).toBeDisabled();
  await assertWcagAa(page);
  await page.unroute(calendarEndpoint);
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(onboardingHeading).toBeVisible();

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  let releaseProjects!: () => void;
  const heldProjectsResponse = new Promise<void>((resolve) => {
    releaseProjects = resolve;
  });
  await page.route("**/api/v1/projects", async (route) => {
    await heldProjectsResponse;
    await route.continue();
  });
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByText("Loading your workspace overview")).toBeVisible();
  await expect(onboardingHeading).toBeHidden();
  releaseProjects();
  await expect(onboardingHeading).toBeVisible();
  await page.unroute("**/api/v1/projects");

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.route("**/api/v1/projects", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Projects are temporarily unavailable." }),
    }),
  );
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByText("Projects are temporarily unavailable.")).toBeVisible();
  await expect(onboardingHeading).toBeHidden();
  await page.unroute("**/api/v1/projects");

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.route("**/api/v1/workspaces", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspaces: [{
          id: newWorkspaceId,
          name: "Quality browser user's workspace",
          slug: "quality-browser-workspace",
          role: "MEMBER",
        }],
      }),
    }),
  );
  await page.reload();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(onboardingHeading).toBeVisible();
  await expect(page.getByRole("link", { name: "Create your first project" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Invite team members" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Browse projects" })).toBeVisible();
  await page.unroute("**/api/v1/workspaces");
  await page.reload();
  await expect(onboardingHeading).toBeVisible();

  await page.getByRole("link", { name: "Create your first project" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByLabel("Project name")).toBeVisible();
  await page.getByLabel("Project name").fill(`Quality browser project ${suffix}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Your projects" })).toBeVisible();
  await expect(onboardingHeading).toBeHidden();
  await page
    .locator(".dashboard-project-list")
    .getByRole("link", { name: new RegExp(`Quality browser project ${suffix}`) })
    .click();
  await expect(page.getByRole("heading", { name: /^Tasks \d+$/ })).toBeVisible();
  await expect(page.locator(".project-loading")).toBeHidden();
  navigationDurations.projectCreationAndNavigation = performance.now() - projectsStartedAt;

  await assertWcagAa(page);

  const addTaskButton = page.getByRole("button", { name: "Add task", exact: true });
  await addTaskButton.click();
  const taskDialog = page.getByRole("dialog", { name: "Create task" });
  await expect(taskDialog).toBeVisible();
  await expect(taskDialog.getByLabel("Title")).toBeFocused();
  await taskDialog.getByLabel("Title").fill("Verify keyboard task workflow");
  await taskDialog.getByRole("button", { name: "Create task" }).focus();
  await page.keyboard.press("Tab");
  await expect(taskDialog.getByRole("button", { name: "Close task dialog" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(taskDialog).toBeHidden();
  await expect(addTaskButton).toBeFocused();

  await addTaskButton.click();
  await taskDialog.getByLabel("Title").fill("Verify keyboard task workflow");
  await taskDialog.getByLabel("Assignee").selectOption({ index: 1 });
  const calendarDueDate = await page.evaluate(() => {
    const date = new Date();
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  });
  await taskDialog.getByLabel("Due date").fill(calendarDueDate);
  const taskStartedAt = performance.now();
  await taskDialog.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Verify keyboard task workflow", { exact: true })).toBeVisible();
  navigationDurations.taskCreation = performance.now() - taskStartedAt;

  const myTasksStartedAt = performance.now();
  await page.getByRole("link", { name: "My tasks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My tasks" })).toBeVisible();
  const myTaskLink = page
    .locator(".my-tasks-page")
    .getByRole("link", { name: "Verify keyboard task workflow" });
  await expect(myTaskLink).toBeVisible();
  navigationDurations.myTasks = performance.now() - myTasksStartedAt;
  await assertWcagAa(page);
  await myTaskLink.click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\?task=/);
  await expect(page.getByRole("dialog", { name: "Edit task" })).toBeVisible();
  await page.getByRole("button", { name: "Close task dialog" }).click();

  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My focus today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upcoming tasks" })).toBeVisible();
  await expect(
    page
      .locator(".dashboard-task-list")
      .getByRole("link", { name: /Verify keyboard task workflow/ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
  await expect(page.getByText("No pending invitations")).toBeVisible();
  await assertWcagAa(page);

  await page.getByRole("link", { name: "Create task" }).click();
  await expect(page.getByRole("dialog", { name: "Create task" })).toBeVisible();
  await page.getByRole("button", { name: "Close task dialog" }).click();

  let releaseCalendar!: () => void;
  const heldCalendarResponse = new Promise<void>((resolve) => {
    releaseCalendar = resolve;
  });
  await page.route(calendarEndpoint, async (route) => {
    await heldCalendarResponse;
    await route.continue();
  });
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page.getByText("Loading workspace calendar")).toBeVisible();
  releaseCalendar();
  await expect(
    page.getByRole("button", { name: /Open task Verify keyboard task workflow/ }),
  ).toBeVisible();
  await page.unroute(calendarEndpoint);

  const calendarPeriod = page.locator(".workspace-calendar-period h2");
  const initialCalendarPeriod = await calendarPeriod.textContent();
  await page.getByRole("button", { name: "Next period" }).focus();
  await page.keyboard.press("Enter");
  await expect(calendarPeriod).not.toHaveText(initialCalendarPeriod ?? "");
  await page.getByRole("button", { name: "Previous period" }).click();
  await expect(calendarPeriod).toHaveText(initialCalendarPeriod ?? "");
  await page.getByRole("button", { name: "Today" }).click();
  await assertWcagAa(page);

  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.locator(".workspace-calendar-week-day")).toHaveCount(7);
  await page.getByRole("button", { name: "Next period" }).click();
  await expect(
    page.getByRole("button", { name: /Open task Verify keyboard task workflow/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Previous period" }).click();
  await expect(
    page.getByRole("button", { name: /Open task Verify keyboard task workflow/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect(page.locator(".workspace-calendar-single-day")).toBeVisible();
  await page.getByRole("button", { name: "Next period" }).click();
  await expect(
    page.getByRole("button", { name: /Open task Verify keyboard task workflow/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Today" }).click();
  await expect(
    page.getByRole("button", { name: /Open task Verify keyboard task workflow/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(page.getByRole("region", { name: "Agenda view" })).toBeVisible();
  const agendaPeriod = await calendarPeriod.textContent();
  await page.getByRole("button", { name: "Next period" }).click();
  await expect(calendarPeriod).not.toHaveText(agendaPeriod ?? "");
  await page.getByRole("button", { name: "Previous period" }).click();
  await expect(calendarPeriod).toHaveText(agendaPeriod ?? "");
  await page.getByLabel("Filter by project").selectOption({ label: `Quality browser project ${suffix}` });
  await page.getByLabel("Filter by status").selectOption({
    label: `Quality browser project ${suffix} · To do`,
  });
  await page.getByLabel("Filter by priority").selectOption("MEDIUM");
  await page.getByLabel("Filter by assignee").selectOption({ label: "Quality Browser User" });
  await expect(
    page.getByRole("button", { name: /Open task Verify keyboard task workflow/ }),
  ).toBeVisible();
  await page.getByLabel("Filter by priority").selectOption("HIGH");
  await expect(page.getByRole("heading", { name: "No tasks to show" })).toBeVisible();
  await page.getByLabel("Filter by priority").selectOption("MEDIUM");
  await page.getByLabel("Filter by assignee").selectOption("__unassigned__");
  await expect(page.getByRole("heading", { name: "No tasks to show" })).toBeVisible();
  await page
    .getByRole("region", { name: "Calendar filters" })
    .getByRole("button", { name: "Clear filters" })
    .click();
  await expect(
    page.getByRole("button", { name: /Open task Verify keyboard task workflow/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const monthColumnCount = await page
    .locator(".workspace-calendar-month-grid")
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(monthColumnCount).toBe(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await assertWcagAa(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.getByRole("link", { name: `Open project Quality browser project ${suffix}` }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await page.getByRole("button", { name: /Open task Verify keyboard task workflow/ }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\?task=/);
  await expect(page.getByRole("dialog", { name: "Edit task" })).toBeVisible();
  await page.getByRole("button", { name: "Close task dialog" }).click();
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByRole("dialog", { name: "Create task" })).toBeVisible();
  await page.getByRole("button", { name: "Close task dialog" }).click();

  const analyticsStartedAt = performance.now();
  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await expect(page.getByTitle(`Quality browser project ${suffix}`)).toBeVisible();
  navigationDurations.analytics = performance.now() - analyticsStartedAt;
  await assertWcagAa(page);

  const report = {
    source: "Playwright core workflow run",
    browser: "Chromium",
    generatedAt: new Date().toISOString(),
    navigationDurationsMs: Object.fromEntries(
      Object.entries(navigationDurations).map(([name, value]) => [name, Math.round(value * 100) / 100]),
    ),
    initialNavigation: await page.evaluate(() => {
      const entry = window.performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      return entry ? {
        domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd * 100) / 100,
        loadEventMs: Math.round(entry.loadEventEnd * 100) / 100,
        transferBytes: entry.transferSize,
      } : null;
    }),
  };
  const resultsDirectory = join(repositoryRoot, "test-results");
  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(
    join(resultsDirectory, "ui-performance-baseline.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  console.log(`QUALITY_UI_PERFORMANCE_BASELINE ${JSON.stringify(report)}`);
});
