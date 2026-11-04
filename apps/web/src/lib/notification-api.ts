import type { NotificationSummary, NotificationsResponse } from "@orbit/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseNotification(value: unknown): NotificationSummary {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    typeof value.entityType !== "string" ||
    typeof value.entityId !== "string" ||
    typeof value.createdAt !== "string" ||
    !(typeof value.readAt === "string" || value.readAt === null) ||
    !(value.actor === null ||
      (isRecord(value.actor) &&
        typeof value.actor.id === "string" &&
        typeof value.actor.name === "string")) ||
    !(value.task === null ||
      (isRecord(value.task) &&
        typeof value.task.title === "string" &&
        typeof value.task.projectId === "string" &&
        typeof value.task.projectName === "string")) ||
    !(value.project === null ||
      (isRecord(value.project) &&
        typeof value.project.id === "string" &&
        typeof value.project.name === "string")) ||
    !(value.workspaceInvitation === null ||
      (isRecord(value.workspaceInvitation) &&
        typeof value.workspaceInvitation.id === "string" &&
        typeof value.workspaceInvitation.workspaceId === "string" &&
        typeof value.workspaceInvitation.workspaceName === "string"))
  ) {
    throw new Error("The notifications API returned an invalid notification.");
  }

  const types = [
    "TASK_ASSIGNED",
    "TASK_MENTIONED",
    "COMMENT_ADDED",
    "DUE_DATE_REMINDER",
    "PROJECT_UPDATED",
    "INVITATION_RECEIVED",
  ] as const;
  if (!types.includes(value.type as (typeof types)[number])) {
    throw new Error("The notifications API returned an unsupported notification type.");
  }

  return {
    id: value.id,
    type: value.type as NotificationSummary["type"],
    entityType: value.entityType,
    entityId: value.entityId,
    createdAt: value.createdAt,
    readAt: value.readAt,
    actor:
      value.actor === null ? null : { id: value.actor.id as string, name: value.actor.name as string },
    task:
      value.task === null
        ? null
        : {
            title: value.task.title as string,
            projectId: value.task.projectId as string,
            projectName: value.task.projectName as string,
          },
    project:
      value.project === null
        ? null
        : { id: value.project.id as string, name: value.project.name as string },
    workspaceInvitation:
      value.workspaceInvitation === null
        ? null
        : {
            id: value.workspaceInvitation.id as string,
            workspaceId: value.workspaceInvitation.workspaceId as string,
            workspaceName: value.workspaceInvitation.workspaceName as string,
          },
  };
}

async function request(path: string, method = "GET"): Promise<unknown> {
  const response = await fetch(`/api/v1/notifications${path}`, {
    method,
    credentials: "include",
  });
  if (response.status === 204) return undefined;

  const body: unknown = await response.json();
  if (!response.ok) {
    const message = isRecord(body) && typeof body.message === "string" ? body.message : undefined;
    throw new Error(message ?? "Could not load notifications.");
  }
  return body;
}

export const notificationApi = {
  async list(): Promise<NotificationsResponse> {
    const value = await request("");
    if (
      !isRecord(value) ||
      !Array.isArray(value.notifications) ||
      typeof value.unreadCount !== "number"
    ) {
      throw new Error("The notifications API returned an invalid response.");
    }
    return {
      notifications: value.notifications.map(parseNotification),
      unreadCount: value.unreadCount,
    };
  },
  async markRead(id: string): Promise<void> {
    await request(`/${encodeURIComponent(id)}/read`, "PATCH");
  },
  async markAllRead(): Promise<void> {
    await request("/read-all", "PATCH");
  },
};
