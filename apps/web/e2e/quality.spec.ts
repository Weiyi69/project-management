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
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill(`Quality browser project ${suffix}`);
  await page.getByRole("button", { name: "Create project" }).click();
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
  const taskStartedAt = performance.now();
  await taskDialog.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Verify keyboard task workflow", { exact: true })).toBeVisible();
  navigationDurations.taskCreation = performance.now() - taskStartedAt;

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
      const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
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
