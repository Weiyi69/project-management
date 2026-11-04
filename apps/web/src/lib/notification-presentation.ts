import type { NotificationSummary } from "@orbit/contracts";

export function notificationMessage(notification: NotificationSummary): string {
  const actor = notification.actor?.name ?? "Someone";
  const task = notification.task?.title ?? "a task";
  if (notification.type === "TASK_ASSIGNED") return `${actor} assigned you ${task}.`;
  if (notification.type === "TASK_MENTIONED") return `${actor} mentioned you on ${task}.`;
  if (notification.type === "COMMENT_ADDED") return `${actor} commented on ${task}.`;
  if (notification.type === "DUE_DATE_REMINDER") return `${task} is due soon.`;
  if (notification.type === "INVITATION_RECEIVED") return `${actor} invited you to a workspace.`;
  return `${actor} updated ${notification.project?.name ?? notification.task?.projectName ?? "a project"}.`;
}
