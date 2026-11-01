import type { WorkspaceActivitySummary } from "@orbit/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseActivity(value: unknown): WorkspaceActivitySummary {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !(typeof value.actorName === "string" || value.actorName === null) ||
    typeof value.action !== "string" ||
    typeof value.entityType !== "string" ||
    typeof value.entityId !== "string" ||
    typeof value.entityName !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    throw new Error("The activity API returned an invalid activity record.");
  }
  let project: WorkspaceActivitySummary["project"];
  if (value.project === null) {
    project = null;
  } else if (
    isRecord(value.project) &&
    typeof value.project.id === "string" &&
    typeof value.project.name === "string"
  ) {
    project = { id: value.project.id, name: value.project.name };
  } else {
    throw new Error("The activity API returned invalid project metadata.");
  }

  return {
    id: value.id,
    actorName: value.actorName,
    action: value.action,
    entityType: value.entityType,
    entityId: value.entityId,
    entityName: value.entityName,
    project,
    createdAt: value.createdAt,
  };
}

export const activityApi = {
  async list(workspaceId: string): Promise<WorkspaceActivitySummary[]> {
    let response: Response;
    try {
      response = await fetch(
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/activity`,
        { credentials: "include" },
      );
    } catch {
      throw new Error("Could not reach ORBIT. Confirm that the API is running, then try again.");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error("The activity API returned an unreadable response.");
    }
    if (!response.ok) {
      const message =
        isRecord(body) && typeof body.message === "string"
          ? body.message
          : "Could not load workspace activity.";
      throw new Error(message);
    }
    if (!isRecord(body) || !Array.isArray(body.activities)) {
      throw new Error("The activity API returned an invalid response.");
    }
    return body.activities.map(parseActivity);
  },
};
