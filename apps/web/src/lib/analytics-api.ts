import type {
  AnalyticsProjectResponse,
  AnalyticsWorkspaceResponse,
  ProjectHealth,
  ProjectLifecycle,
} from "@orbit/contracts";

class AnalyticsApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHealth(value: unknown): value is ProjectHealth {
  if (!isRecord(value)) return false;
  return (
    (value.status === "ON_TRACK" ||
      value.status === "NEEDS_ATTENTION" ||
      value.status === "AT_RISK") &&
    Array.isArray(value.reasons) &&
    value.reasons.every((reason) => typeof reason === "string") &&
    typeof value.taskCount === "number" &&
    typeof value.completedTasks === "number" &&
    (typeof value.completionRate === "number" || value.completionRate === null) &&
    typeof value.overdueTasks === "number" &&
    typeof value.dueSoonTasks === "number" &&
    typeof value.unassignedTasks === "number"
  );
}

function isLifecycle(value: unknown): value is ProjectLifecycle {
  return (
    value === "PLANNING" ||
    value === "ACTIVE" ||
    value === "ON_HOLD" ||
    value === "COMPLETED" ||
    value === "ARCHIVED"
  );
}

function isProjectSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isLifecycle(value.state) &&
    isHealth(value.health)
  );
}

function getErrorMessage(body: unknown): string | undefined {
  if (!isRecord(body) || !("message" in body)) return undefined;
  if (typeof body.message === "string") return body.message;
  if (Array.isArray(body.message) && body.message.every((item) => typeof item === "string")) {
    return body.message.join(" ");
  }
  return undefined;
}

async function getJson<T>(
  path: string,
  validate: (value: unknown) => value is T,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { credentials: "include" });
  } catch {
    throw new Error("Could not reach ORBIT. Confirm that the API is running, then try again.");
  }
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new AnalyticsApiError(getErrorMessage(body) ?? "Could not load analytics.");
  }
  if (!validate(body)) throw new AnalyticsApiError("The analytics API returned an invalid response.");
  return body;
}

function isWorkspaceResponse(value: unknown): value is AnalyticsWorkspaceResponse {
  if (!isRecord(value) || !isRecord(value.workspace) || !isRecord(value.summary)) return false;
  const summary = value.summary;
  return (
    typeof value.workspace.id === "string" &&
    typeof value.workspace.name === "string" &&
    typeof value.generatedAt === "string" &&
    ["totalProjects", "activeProjects", "completedProjects", "totalTasks", "completedTasks",
      "overdueTasks", "dueSoonTasks", "unassignedTasks"].every(
      (key) => typeof summary[key] === "number",
    ) &&
    (typeof summary.completionRate === "number" || summary.completionRate === null) &&
    Array.isArray(value.projects) &&
    value.projects.every(isProjectSummary) &&
    Array.isArray(value.workload) &&
    value.workload.every(
      (member) =>
        isRecord(member) &&
        typeof member.memberId === "string" &&
        typeof member.name === "string" &&
        typeof member.assignedOpenTasks === "number",
    ) &&
    typeof value.unassignedOpenTasks === "number"
  );
}

function isProjectResponse(value: unknown): value is AnalyticsProjectResponse {
  return (
    isRecord(value) &&
    isRecord(value.workspace) &&
    typeof value.workspace.id === "string" &&
    typeof value.workspace.name === "string" &&
    typeof value.generatedAt === "string" &&
    isProjectSummary(value.project) &&
    Array.isArray(value.statuses) &&
    value.statuses.every(
      (status) =>
        isRecord(status) &&
        typeof status.statusId === "string" &&
        typeof status.name === "string" &&
        typeof status.color === "string" &&
        typeof status.isComplete === "boolean" &&
        typeof status.taskCount === "number",
    ) &&
    Array.isArray(value.workload) &&
    value.workload.every(
      (member) =>
        isRecord(member) &&
        typeof member.memberId === "string" &&
        typeof member.name === "string" &&
        typeof member.assignedOpenTasks === "number",
    ) &&
    Array.isArray(value.dueTasks) &&
    value.dueTasks.every(
      (task) =>
        isRecord(task) &&
        typeof task.id === "string" &&
        typeof task.title === "string" &&
        typeof task.dueDate === "string" &&
        typeof task.statusName === "string" &&
        (typeof task.assigneeName === "string" || task.assigneeName === null),
    ) &&
    typeof value.dueTasksLimited === "boolean"
  );
}

async function downloadCsv(path: string, fileName: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { credentials: "include" });
  } catch {
    throw new Error("Could not reach ORBIT. Confirm that the API is running, then try again.");
  }

  if (!response.ok) {
    let message: string | undefined;
    try {
      message = getErrorMessage(await response.json());
    } catch {
      message = undefined;
    }
    throw new AnalyticsApiError(message ?? "Could not export analytics.");
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

export const analyticsApi = {
  getWorkspace: (workspaceId: string) =>
    getJson(`/analytics/workspaces/${encodeURIComponent(workspaceId)}`, isWorkspaceResponse),
  getProject: (projectId: string) =>
    getJson(`/analytics/projects/${encodeURIComponent(projectId)}`, isProjectResponse),
  exportWorkspace: (workspaceId: string) =>
    downloadCsv(
      `/analytics/workspaces/${encodeURIComponent(workspaceId)}/export.csv`,
      "workspace-analytics.csv",
    ),
  exportProject: (projectId: string) =>
    downloadCsv(
      `/analytics/projects/${encodeURIComponent(projectId)}/export.csv`,
      "project-analytics.csv",
    ),
};
