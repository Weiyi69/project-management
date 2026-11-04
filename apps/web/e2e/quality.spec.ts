import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function assertWcagAa(
  page: import("@playwright/test").Page,
  include?: string,
): Promise<void> {
  let axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (include) axe = axe.include(include);
  const results = await axe.analyze();
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
  test.setTimeout(180_000);
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
  type ProjectMemberFixture = {
    userId: string;
    name: string;
    email: string;
    projectRole: "ADMIN" | "MEMBER";
    joinedAt: string;
  };
  const projectCandidate = {
    id: "fc14b956-eead-442d-afa0-7f8a4c266abb",
    name: "Quality Added Member",
    email: "quality-added-member@example.test",
  };
  let projectMembersFixture: ProjectMemberFixture[] | undefined;
  let showEmptyProjectRoster = true;
  await page.route("**/api/v1/projects/*/members**", async (route) => {
    const request = route.request();
    const method = request.method();
    if (method === "GET") {
      const response = await route.fetch();
      const body = (await response.json()) as {
        members: ProjectMemberFixture[];
        workspaceMembers: Array<{ id: string; name: string; email: string }>;
      };
      projectMembersFixture ??= body.members;
      const membersForResponse = showEmptyProjectRoster ? [] : projectMembersFixture;
      showEmptyProjectRoster = false;
      await route.fulfill({
        response,
        json: {
          ...body,
          members: membersForResponse,
          workspaceMembers: [...body.workspaceMembers, projectCandidate],
        },
      });
      return;
    }

    if (method === "POST") {
      const input = request.postDataJSON() as {
        userId: string;
        projectRole: "ADMIN" | "MEMBER";
      };
      const member: ProjectMemberFixture = {
        userId: input.userId,
        name: projectCandidate.name,
        email: projectCandidate.email,
        projectRole: input.projectRole,
        joinedAt: new Date().toISOString(),
      };
      projectMembersFixture = [...(projectMembersFixture ?? []), member];
      await route.fulfill({ status: 201, json: { member } });
      return;
    }

    const userId = new URL(request.url()).pathname.split("/").at(-1)!;
    if (method === "PATCH") {
      const input = request.postDataJSON() as { projectRole: "ADMIN" | "MEMBER" };
      projectMembersFixture = (projectMembersFixture ?? []).map((member) =>
        member.userId === userId ? { ...member, projectRole: input.projectRole } : member,
      );
      await route.fulfill({
        status: 200,
        json: { member: projectMembersFixture.find((member) => member.userId === userId) },
      });
      return;
    }

    projectMembersFixture = (projectMembersFixture ?? []).filter(
      (member) => member.userId !== userId,
    );
    await route.fulfill({ status: 204 });
  });
  await page
    .locator(".dashboard-project-list")
    .getByRole("link", { name: new RegExp(`Quality browser project ${suffix}`) })
    .click();
  await expect(page.getByRole("heading", { name: /^Tasks \d+$/ })).toBeVisible();
  await expect(page.locator(".project-loading")).toBeHidden();
  const projectMembersList = page.getByRole("list", { name: "Project members" });
  await expect(page.getByRole("heading", { name: "Project members" })).toBeVisible();
  await expect(page.getByText("No project members yet.")).toBeVisible();
  await assertWcagAa(page);
  await page.reload();
  await expect(projectMembersList.getByText("Quality Browser User", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Role for Quality Browser User")).toHaveValue("ADMIN");
  await expect(
    page.getByRole("button", { name: "Remove Quality Browser User from project" }),
  ).toBeDisabled();
  await page.getByLabel("Add a workspace member").selectOption(projectCandidate.id);
  await page.getByLabel("Project role").selectOption("ADMIN");
  await page.getByRole("button", { name: "Add member" }).click();
  await expect(projectMembersList.getByText(projectCandidate.name, { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Project member added." })).toBeVisible();
  await page.getByLabel(`Role for ${projectCandidate.name}`).selectOption("MEMBER");
  await page.getByRole("button", { name: `Save role for ${projectCandidate.name}` }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `Updated ${projectCandidate.name}'s project role.` }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: `Remove ${projectCandidate.name} from project` }).click();
  await expect(projectMembersList.getByText(projectCandidate.name, { exact: true })).toHaveCount(0);
  let releaseMemberResponse!: () => void;
  const heldMemberResponse = new Promise<void>((resolve) => {
    releaseMemberResponse = resolve;
  });
  await page.route("**/api/v1/projects/*/members**", async (route) => {
    await heldMemberResponse;
    await route.continue();
  });
  const memberReload = page.reload();
  await expect(page.locator(".project-loading")).toBeVisible();
  releaseMemberResponse();
  await memberReload;
  await page.unroute("**/api/v1/projects/*/members**");
  await expect(projectMembersList.getByText("Quality Browser User", { exact: true })).toBeVisible();

  await page.route("**/api/v1/projects/*/members**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Project members are temporarily unavailable." }),
    }),
  );
  await page.reload();
  await expect(page.getByText("Project members are temporarily unavailable.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry loading members" })).toBeVisible();
  await page.unroute("**/api/v1/projects/*/members**");
  await page.reload();
  await expect(projectMembersList.getByText("Quality Browser User", { exact: true })).toBeVisible();
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

  const searchTrigger = page.getByRole("button", { name: "Search anything K" });
  const palette = page.getByRole("dialog", { name: "Search ORBIT" });
  const searchInput = page.getByRole("searchbox", {
    name: "Search projects, tasks, and pages",
  });
  let contentSearchRequests = 0;
  const countSearchRequests = (request: import("@playwright/test").Request) => {
    if (new URL(request.url()).pathname === "/api/v1/search") contentSearchRequests += 1;
  };
  page.on("request", countSearchRequests);
  await searchTrigger.click();
  await expect(searchInput).toBeFocused();
  await searchInput.fill("q");
  await expect(page.getByText("Type at least 2 characters to search projects and tasks.")).toBeVisible();
  await page.waitForTimeout(300);
  expect(contentSearchRequests).toBe(0);
  await searchInput.fill(`quality browser project ${suffix}`);
  const projectResult = page.getByRole("option", {
    name: new RegExp(`Quality browser project ${suffix}`),
  });
  await expect(page.getByRole("group", { name: "Projects" })).toBeVisible();
  await expect(projectResult).toBeVisible();
  await expect(projectResult.locator("mark")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);

  await searchTrigger.click();
  await searchInput.fill("Verify keyboard task workflow");
  const taskResult = page.getByRole("option", {
    name: /Verify keyboard task workflow/,
  });
  await expect(page.getByRole("group", { name: "Tasks" })).toBeVisible();
  await expect(taskResult).toBeVisible();
  await taskResult.click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\?task=/);
  await expect(page.getByRole("dialog", { name: "Edit task" })).toBeVisible();
  await page.getByRole("button", { name: "Close task dialog" }).click();

  let releaseStaleSearch!: () => void;
  const staleSearchHold = new Promise<void>((resolve) => {
    releaseStaleSearch = resolve;
  });
  let staleRequestSeen!: () => void;
  const staleSearchRequested = new Promise<void>((resolve) => {
    staleRequestSeen = resolve;
  });
  let retryCount = 0;
  await page.route("**/api/v1/search**", async (route) => {
    const searchTerm = new URL(route.request().url()).searchParams.get("q");
    if (searchTerm === "slowquery") {
      staleRequestSeen();
      await staleSearchHold;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          projects: [{
            id: "stale-project",
            name: "Slow stale result",
            description: null,
            workspace: { id: "workspace-1", name: "Workspace" },
          }],
          tasks: [],
        }),
      });
    } else if (searchTerm === "freshquery") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          projects: [{
            id: "fresh-project",
            name: "Fresh search result",
            description: null,
            workspace: { id: "workspace-1", name: "Workspace" },
          }],
          tasks: [],
        }),
      });
    } else if (searchTerm === "errorquery") {
      retryCount += 1;
      if (retryCount === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Search is temporarily unavailable." }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ projects: [], tasks: [] }),
        });
      }
    } else if (searchTerm === "needle") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          projects: [
            {
              id: "highlight-project",
              name: 'needle <img src=x onerror="alert(1)">',
              description: null,
              workspace: { id: "workspace-1", name: "Workspace" },
            },
            {
              id: "second-highlight-project",
              name: "Needle secondary result",
              description: null,
              workspace: { id: "workspace-1", name: "Workspace" },
            },
          ],
          tasks: [],
        }),
      });
    } else {
      await route.continue();
    }
  });

  await searchTrigger.click();
  await searchInput.fill("slowquery");
  await staleSearchRequested;
  await expect(page.getByRole("status").filter({ hasText: "Searching" })).toBeVisible();
  await searchInput.fill("freshquery");
  await expect(page.getByRole("option", { name: "Fresh search result" })).toBeVisible();
  releaseStaleSearch();
  await expect(page.getByRole("option", { name: "Slow stale result" })).toHaveCount(0);

  await searchInput.fill("errorquery");
  await expect(page.getByRole("alert").filter({ hasText: "Search is temporarily unavailable." })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("No results match “errorquery”.")).toBeVisible();

  await searchInput.fill("needle");
  const highlightedResults = page.getByRole("group", { name: "Projects" });
  const unsafeTextResult = highlightedResults.getByRole("option", { name: /needle/ }).first();
  await expect(unsafeTextResult.locator("mark")).toHaveText("needle");
  await expect(unsafeTextResult.getByRole("img")).toHaveCount(0);
  await expect(unsafeTextResult.locator("strong")).toContainText(
    'needle <img src=x onerror="alert(1)">',
  );
  await expect(page.getByRole("option", { name: /Needle secondary result/ })).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await expect(searchInput).toHaveAttribute(
    "aria-activedescendant",
    "command-result-project-second-highlight-project",
  );
  await page.keyboard.press("ArrowUp");
  await expect(searchInput).toHaveAttribute(
    "aria-activedescendant",
    "command-result-project-highlight-project",
  );
  await assertWcagAa(page, ".command-dialog");
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await searchTrigger.click();
  await page.locator(".command-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(palette).toBeHidden();
  await page.unroute("**/api/v1/search**");
  page.off("request", countSearchRequests);

  await searchTrigger.click();
  await searchInput.fill("no-such-result-zq");
  await expect(page.getByText("No results match “no-such-result-zq”.")).toBeVisible();
  await searchInput.fill("analytics");
  await expect(page.getByRole("group", { name: "Pages" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Analytics" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/analytics$/);

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
  const mobileOverflow = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    overflowingElements: [...document.querySelectorAll("body *")]
      .map((element) => ({
        element: `${element.tagName.toLowerCase()}${typeof element.className === "string" && element.className
          ? `.${element.className.trim().replace(/\s+/g, ".")}`
          : ""}`,
        right: Math.round(element.getBoundingClientRect().right),
      }))
      .filter(({ right }) => right > window.innerWidth + 1)
      .slice(0, 5),
  }));
  expect(mobileOverflow.documentWidth, JSON.stringify(mobileOverflow)).toBeLessThanOrEqual(
    mobileOverflow.viewportWidth,
  );
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

  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/profile$/);
  await expect(page.getByRole("heading", { name: "Account settings" })).toBeVisible();
  await expect(page.getByLabel("Display name")).toHaveValue("Quality Browser User");
  await expect(page.getByRole("link", { name: "Workspace settings" })).toBeVisible();
  await assertWcagAa(page);

  await page.getByRole("link", { name: "Notifications", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/notifications$/);
  await expect(page.getByRole("heading", { name: "Notification preferences" })).toBeVisible();
  await expect(page.getByLabel("Task assignments email notifications")).toBeVisible();
  await assertWcagAa(page);

  await page.getByRole("link", { name: "Security", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/security$/);
  await expect(page.getByRole("heading", { name: "Active sessions" })).toBeVisible();
  await expect(page.getByText("This browser", { exact: true })).toBeVisible();
  await assertWcagAa(page);

  await page.getByRole("link", { name: "Workspace settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Workspace settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Members and roles" })).toBeVisible();

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
