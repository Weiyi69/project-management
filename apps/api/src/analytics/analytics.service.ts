import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  AnalyticsDueTask,
  AnalyticsProjectResponse,
  AnalyticsProjectSummary,
  AnalyticsStatusMetric,
  AnalyticsWorkspaceResponse,
  AnalyticsWorkloadMember,
} from "@orbit/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { calculateProjectHealth, getAnalyticsDateWindow, toCsv } from "./analytics-metrics";

type AnalyticsProjectRecord = {
  id: string;
  name: string;
  state: AnalyticsProjectSummary["state"];
  statuses: Array<{
    id: string;
    name: string;
    color: string;
    position: number;
    isCompleted: boolean;
  }>;
};

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceAccess: WorkspaceAccessService,
  ) {}

  async getWorkspaceAnalytics(userId: string, workspaceId: string): Promise<AnalyticsWorkspaceResponse> {
    await this.workspaceAccess.requireMembership(workspaceId, userId);
    const [workspace, projects] = await Promise.all([
      this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, name: true },
      }),
      this.prisma.project.findMany({
        where: { workspaceId },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          state: true,
          statuses: {
            select: { id: true, name: true, color: true, position: true, isCompleted: true },
            orderBy: { position: "asc" },
          },
        },
      }),
    ]);

    if (!workspace) throw new NotFoundException("Workspace not found.");
    const { projects: projectSummaries, workload, unassignedOpenTasks } =
      await this.summarizeProjects(workspaceId, projects);
    const totalTasks = projectSummaries.reduce((sum, project) => sum + project.health.taskCount, 0);
    const completedTasks = projectSummaries.reduce(
      (sum, project) => sum + project.health.completedTasks,
      0,
    );

    return {
      workspace,
      generatedAt: new Date().toISOString(),
      summary: {
        totalProjects: projectSummaries.length,
        activeProjects: projectSummaries.filter((project) => project.state === "ACTIVE").length,
        completedProjects: projectSummaries.filter((project) => project.state === "COMPLETED").length,
        totalTasks,
        completedTasks,
        completionRate: totalTasks === 0 ? null : Math.round((completedTasks / totalTasks) * 1000) / 10,
        overdueTasks: projectSummaries.reduce((sum, project) => sum + project.health.overdueTasks, 0),
        dueSoonTasks: projectSummaries.reduce((sum, project) => sum + project.health.dueSoonTasks, 0),
        unassignedTasks: unassignedOpenTasks,
      },
      projects: projectSummaries,
      workload,
      unassignedOpenTasks,
    };
  }

  async getProjectAnalytics(userId: string, projectId: string): Promise<AnalyticsProjectResponse> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspace: { members: { some: { userId } } } },
      select: {
        id: true,
        name: true,
        state: true,
        workspaceId: true,
        workspace: { select: { id: true, name: true } },
        statuses: {
          select: { id: true, name: true, color: true, position: true, isCompleted: true },
          orderBy: { position: "asc" },
        },
      },
    });

    if (!project) throw new NotFoundException("Project not found.");

    const { projects, workload, statusMetrics, unassignedOpenTasks } = await this.summarizeProjects(
      project.workspaceId,
      [project],
    );
    const projectSummary = projects[0];
    if (!projectSummary) throw new NotFoundException("Project not found.");

    const { dueSoonEnd } = getAnalyticsDateWindow();
    const dueTaskRows = await this.prisma.task.findMany({
      where: {
        projectId,
        dueDate: { lt: dueSoonEnd },
        status: { is: { isCompleted: false } },
      },
      orderBy: [{ dueDate: "asc" }, { title: "asc" }],
      take: 101,
      select: {
        id: true,
        title: true,
        dueDate: true,
        status: { select: { name: true } },
        assignee: { select: { name: true } },
      },
    });
    const dueTasks: AnalyticsDueTask[] = dueTaskRows.slice(0, 100).flatMap((task) =>
      task.dueDate
        ? [{
            id: task.id,
            title: task.title,
            dueDate: task.dueDate.toISOString().slice(0, 10),
            statusName: task.status.name,
            assigneeName: task.assignee?.name ?? null,
          }]
        : [],
    );
    const statuses: AnalyticsStatusMetric[] = project.statuses.map((status) => ({
      statusId: status.id,
      name: status.name,
      color: status.color,
      isComplete: status.isCompleted,
      taskCount: statusMetrics.get(status.id) ?? 0,
    }));

    return {
      workspace: project.workspace,
      project: projectSummary,
      generatedAt: new Date().toISOString(),
      statuses,
      workload,
      dueTasks,
      dueTasksLimited: dueTaskRows.length > 100,
    };
  }

  async exportWorkspaceCsv(userId: string, workspaceId: string): Promise<string> {
    const report = await this.getWorkspaceAnalytics(userId, workspaceId);
    const rows: Array<Array<string | number | null>> = [
      ["Report", "Workspace analytics"],
      ["Workspace", report.workspace.name],
      ["Generated at", report.generatedAt],
      ["Metric", "Value"],
      ["Projects", report.summary.totalProjects],
      ["Active projects", report.summary.activeProjects],
      ["Completed projects", report.summary.completedProjects],
      ["Tasks", report.summary.totalTasks],
      ["Completed tasks", report.summary.completedTasks],
      ["Completion rate (%)", report.summary.completionRate],
      ["Overdue incomplete tasks", report.summary.overdueTasks],
      ["Due within 7 days", report.summary.dueSoonTasks],
      ["Unassigned incomplete tasks", report.unassignedOpenTasks],
      [],
      ["Project", "Lifecycle", "Health", "Tasks", "Completion (%)", "Overdue", "Due soon", "Unassigned", "Reasons"],
      ...report.projects.map((project) => [
        project.name,
        project.state,
        project.health.status,
        project.health.taskCount,
        project.health.completionRate,
        project.health.overdueTasks,
        project.health.dueSoonTasks,
        project.health.unassignedTasks,
        project.health.reasons.join(" "),
      ]),
      [],
      ["Team member", "Assigned incomplete tasks"],
      ...report.workload.map((member) => [member.name, member.assignedOpenTasks]),
    ];
    return toCsv(rows);
  }

  async exportProjectCsv(userId: string, projectId: string): Promise<string> {
    const report = await this.getProjectAnalytics(userId, projectId);
    const { dueSoonEnd } = getAnalyticsDateWindow();
    const dueTaskRows = await this.prisma.task.findMany({
      where: {
        projectId,
        dueDate: { lt: dueSoonEnd },
        status: { is: { isCompleted: false } },
      },
      orderBy: [{ dueDate: "asc" }, { title: "asc" }],
      select: {
        title: true,
        dueDate: true,
        status: { select: { name: true } },
        assignee: { select: { name: true } },
      },
    });
    const rows: Array<Array<string | number | null>> = [
      ["Report", "Project analytics"],
      ["Workspace", report.workspace.name],
      ["Project", report.project.name],
      ["Lifecycle", report.project.state],
      ["Health", report.project.health.status],
      ["Health reasons", report.project.health.reasons.join(" ")],
      ["Generated at", report.generatedAt],
      ["Metric", "Value"],
      ["Tasks", report.project.health.taskCount],
      ["Completed tasks", report.project.health.completedTasks],
      ["Completion rate (%)", report.project.health.completionRate],
      ["Overdue incomplete tasks", report.project.health.overdueTasks],
      ["Due within 7 days", report.project.health.dueSoonTasks],
      ["Unassigned incomplete tasks", report.project.health.unassignedTasks],
      [],
      ["Workflow status", "Complete status", "Task count"],
      ...report.statuses.map((status) => [status.name, status.isComplete ? "Complete" : "Incomplete", status.taskCount]),
      [],
      ["Team member", "Assigned incomplete tasks"],
      ...report.workload.map((member) => [member.name, member.assignedOpenTasks]),
      [],
      ["Due task", "Due date", "Workflow status", "Assignee"],
      ...dueTaskRows.flatMap((task) =>
        task.dueDate
          ? [[task.title, task.dueDate.toISOString().slice(0, 10), task.status.name, task.assignee?.name ?? null]]
          : [],
      ),
    ];
    return toCsv(rows);
  }

  private async summarizeProjects(
    workspaceId: string,
    projects: AnalyticsProjectRecord[],
  ): Promise<{
    projects: AnalyticsProjectSummary[];
    workload: AnalyticsWorkloadMember[];
    statusMetrics: Map<string, number>;
    unassignedOpenTasks: number;
  }> {
    const projectIds = projects.map((project) => project.id);
    const { todayStart, dueSoonEnd } = getAnalyticsDateWindow();
    if (projectIds.length === 0) {
      return { projects: [], workload: [], statusMetrics: new Map(), unassignedOpenTasks: 0 };
    }

    const openTasks = {
      projectId: { in: projectIds },
      status: { is: { isCompleted: false } },
    };
    const [taskGroups, statusGroups, overdueGroups, dueSoonGroups, unassignedGroups, workloadGroups] =
      await Promise.all([
        this.prisma.task.groupBy({
          by: ["projectId"],
          where: { projectId: { in: projectIds } },
          _count: { _all: true },
        }),
        this.prisma.task.groupBy({
          by: ["projectId", "statusId"],
          where: { projectId: { in: projectIds } },
          _count: { _all: true },
        }),
        this.prisma.task.groupBy({
          by: ["projectId"],
          where: { ...openTasks, dueDate: { lt: todayStart } },
          _count: { _all: true },
        }),
        this.prisma.task.groupBy({
          by: ["projectId"],
          where: { ...openTasks, dueDate: { gte: todayStart, lt: dueSoonEnd } },
          _count: { _all: true },
        }),
        this.prisma.task.groupBy({
          by: ["projectId"],
          where: { ...openTasks, assigneeId: null },
          _count: { _all: true },
        }),
        this.prisma.task.groupBy({
          by: ["projectId", "assigneeId"],
          where: { ...openTasks, assigneeId: { not: null } },
          _count: { _all: true },
        }),
      ]);

    const taskCounts = new Map(taskGroups.map((group) => [group.projectId, group._count._all]));
    const overdueCounts = new Map(overdueGroups.map((group) => [group.projectId, group._count._all]));
    const dueSoonCounts = new Map(dueSoonGroups.map((group) => [group.projectId, group._count._all]));
    const unassignedCounts = new Map(
      unassignedGroups.map((group) => [group.projectId, group._count._all]),
    );
    const projectStatusCounts = new Map<string, number>();
    for (const group of statusGroups) {
      projectStatusCounts.set(`${group.projectId}:${group.statusId}`, group._count._all);
    }
    const statusMetrics = new Map<string, number>();
    for (const group of statusGroups) {
      statusMetrics.set(group.statusId, (statusMetrics.get(group.statusId) ?? 0) + group._count._all);
    }

    const memberIds = [
      ...new Set(
        workloadGroups.flatMap((group) => (group.assigneeId ? [group.assigneeId] : [])),
      ),
    ];
    const members = memberIds.length
      ? await this.prisma.workspaceMember.findMany({
          where: { workspaceId, userId: { in: memberIds } },
          select: { userId: true, user: { select: { name: true } } },
        })
      : [];
    const memberNames = new Map(members.map((member) => [member.userId, member.user.name]));

    const projectWorkloads = new Map<string, Map<string, number>>();
    for (const group of workloadGroups) {
      if (!group.assigneeId) continue;
      const byMember = projectWorkloads.get(group.projectId) ?? new Map<string, number>();
      byMember.set(group.assigneeId, group._count._all);
      projectWorkloads.set(group.projectId, byMember);
    }
    const allWorkload = new Map<string, number>();
    for (const byMember of projectWorkloads.values()) {
      for (const [memberId, count] of byMember) {
        allWorkload.set(memberId, (allWorkload.get(memberId) ?? 0) + count);
      }
    }
    const workloadFor = (counts: Map<string, number>): AnalyticsWorkloadMember[] =>
      [...counts.entries()]
        .flatMap(([memberId, assignedOpenTasks]) => {
          const name = memberNames.get(memberId);
          return name ? [{ memberId, name, assignedOpenTasks }] : [];
        })
        .sort((left, right) => right.assignedOpenTasks - left.assignedOpenTasks || left.name.localeCompare(right.name));

    return {
      projects: projects.map((project) => {
        const taskCount = taskCounts.get(project.id) ?? 0;
        const completedTasks = project.statuses.reduce(
          (sum, status) =>
            sum +
            (status.isCompleted
              ? projectStatusCounts.get(`${project.id}:${status.id}`) ?? 0
              : 0),
          0,
        );
        return {
          id: project.id,
          name: project.name,
          state: project.state,
          health: calculateProjectHealth({
            taskCount,
            completedTasks,
            overdueTasks: overdueCounts.get(project.id) ?? 0,
            dueSoonTasks: dueSoonCounts.get(project.id) ?? 0,
            unassignedTasks: unassignedCounts.get(project.id) ?? 0,
          }),
        };
      }),
      workload: workloadFor(allWorkload),
      statusMetrics,
      unassignedOpenTasks: [...unassignedCounts.values()].reduce((sum, count) => sum + count, 0),
    };
  }
}
