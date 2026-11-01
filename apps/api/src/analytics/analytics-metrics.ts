import type { ProjectHealth, ProjectHealthStatus } from "@orbit/contracts";

export interface ProjectHealthInput {
  taskCount: number;
  completedTasks: number;
  overdueTasks: number;
  dueSoonTasks: number;
  unassignedTasks: number;
}

export function getAnalyticsDateWindow(now = new Date()): {
  todayStart: Date;
  dueSoonEnd: Date;
} {
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const dueSoonEnd = new Date(todayStart);
  dueSoonEnd.setUTCDate(dueSoonEnd.getUTCDate() + 8);
  return { todayStart, dueSoonEnd };
}

export function calculateProjectHealth(input: ProjectHealthInput): ProjectHealth {
  const {
    taskCount,
    completedTasks,
    overdueTasks,
    dueSoonTasks,
    unassignedTasks,
  } = input;

  if (taskCount === 0) {
    return {
      status: "NEEDS_ATTENTION",
      reasons: ["No tasks have been added, so health and completion cannot be assessed."],
      taskCount,
      completedTasks: 0,
      completionRate: null,
      overdueTasks: 0,
      dueSoonTasks: 0,
      unassignedTasks: 0,
    };
  }

  const reasons: string[] = [];
  if (overdueTasks > 0) {
    reasons.push(`${overdueTasks} incomplete task${overdueTasks === 1 ? " is" : "s are"} overdue.`);
  }
  if (dueSoonTasks > 0) {
    reasons.push(
      `${dueSoonTasks} incomplete task${dueSoonTasks === 1 ? " is" : "s are"} due within 7 days.`,
    );
  }
  if (unassignedTasks > 0) {
    reasons.push(
      `${unassignedTasks} incomplete task${unassignedTasks === 1 ? " is" : "s are"} unassigned.`,
    );
  }

  let status: ProjectHealthStatus = "ON_TRACK";
  if (overdueTasks > 0) status = "AT_RISK";
  else if (dueSoonTasks > 0 || unassignedTasks > 0) status = "NEEDS_ATTENTION";
  else reasons.push("No overdue, due-soon, or unassigned incomplete tasks.");

  return {
    status,
    reasons,
    taskCount,
    completedTasks,
    completionRate: Math.round((completedTasks / taskCount) * 1000) / 10,
    overdueTasks,
    dueSoonTasks,
    unassignedTasks,
  };
}

export function toCsv(rows: Array<Array<string | number | null>>): string {
  return `\uFEFF${rows
    .map((row) =>
      row
        .map((value) => {
          const text = value === null ? "" : String(value);
          const safeText = /^[\u0000-\u0020]*[=+\-@]/.test(text) ? `'${text}` : text;
          return `"${safeText.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n")}\r\n`;
}
