import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ActivityService } from "../activity/activity.service";
import { Prisma } from "../generated/prisma/client";
import type { TaskPriority as TaskPriorityContract } from "@orbit/contracts";
import type {
  MyTasksResponse,
  ProjectLabelSummary,
  ProjectTasksResponse,
  TaskFocusResponse,
  TaskCommentSummary,
  TaskDetail,
  TaskSummary,
  TaskWorkspaceMember,
  WorkspaceCalendarResponse,
} from "@orbit/contracts";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";

const taskInclude = {
  status: { select: { id: true, name: true, color: true, isCompleted: true } },
  assignee: { select: { id: true, name: true, email: true } },
  labels: {
    include: { label: { select: { id: true, name: true, color: true } } },
  },
  dependencies: {
    include: {
      dependsOn: {
        select: { id: true, title: true, status: { select: { name: true } } },
      },
    },
  },
  _count: { select: { comments: { where: { deletedAt: null } } } },
} satisfies Prisma.TaskInclude;

type IncludedTask = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

const workspaceCalendarTaskInclude = {
  ...taskInclude,
  project: { select: { id: true, name: true } },
} satisfies Prisma.TaskInclude;

type IncludedWorkspaceCalendarTask = Prisma.TaskGetPayload<{
  include: typeof workspaceCalendarTaskInclude;
}>;

const assignedTaskInclude = {
  ...taskInclude,
  status: { select: { id: true, name: true, color: true, isCompleted: true } },
  project: {
    select: {
      id: true,
      name: true,
      workspace: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.TaskInclude;

type IncludedAssignedTask = Prisma.TaskGetPayload<{ include: typeof assignedTaskInclude }>;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceAccess: WorkspaceAccessService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityService,
  ) {}

  async listProjectTasks(userId: string, projectId: string): Promise<ProjectTasksResponse> {
    const project = await this.requireProject(projectId, userId);
    const [tasks, members, labels] = await Promise.all([
      this.prisma.task.findMany({
        where: { projectId },
        include: taskInclude,
        orderBy: [{ status: { position: "asc" } }, { position: "asc" }, { createdAt: "asc" }],
      }),
      this.prisma.workspaceMember.findMany({
        where: { workspaceId: project.workspaceId },
        select: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { user: { name: "asc" } },
      }),
      this.prisma.label.findMany({
        where: { projectId },
        include: { _count: { select: { tasks: true } } },
        orderBy: { name: "asc" },
      }),
    ]);

    return {
      tasks: tasks.map((task) => this.toSummary(task)),
      members: members.map(({ user }): TaskWorkspaceMember => user),
      labels: labels.map(
        (label): ProjectLabelSummary => ({
          id: label.id,
          name: label.name,
          color: label.color,
          taskCount: label._count.tasks,
        }),
      ),
    };
  }

  async listWorkspaceCalendarTasks(
    userId: string,
    workspaceId: string,
    startDate: string | undefined,
    endDate: string | undefined,
  ): Promise<WorkspaceCalendarResponse> {
    await this.workspaceAccess.requireMembership(workspaceId, userId);

    const start = this.parseCalendarDate(startDate, "startDate");
    const end = this.parseCalendarDate(endDate, "endDate");
    if (start > end) {
      throw new BadRequestException("The calendar start date must be on or before its end date.");
    }

    const endExclusive = new Date(end);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    const [workspace, records] = await Promise.all([
      this.prisma.workspace.findFirst({
        where: { id: workspaceId, members: { some: { userId } } },
        select: {
          projects: {
            where: { workspaceId },
            select: {
              id: true,
              name: true,
              statuses: {
                select: { id: true, name: true, color: true, position: true },
                orderBy: { position: "asc" },
              },
            },
            orderBy: { name: "asc" },
          },
          members: {
            select: { user: { select: { id: true, name: true, email: true } } },
            orderBy: { user: { name: "asc" } },
          },
        },
      }),
      this.prisma.task.findMany({
        where: {
          dueDate: { gte: start, lt: endExclusive },
          project: {
            workspaceId,
            workspace: { members: { some: { userId } } },
          },
        },
        include: workspaceCalendarTaskInclude,
        orderBy: [{ dueDate: "asc" }, { title: "asc" }],
      }),
    ]);

    if (!workspace) {
      throw new NotFoundException("Workspace not found.");
    }

    return {
      tasks: records.map((task) => this.toWorkspaceCalendarTask(task)),
      projects: workspace.projects,
      members: workspace.members.map(({ user }) => user),
    };
  }

  async listMyTasks(userId: string, includeCompleted = false): Promise<MyTasksResponse> {
    const tasks = await this.prisma.task.findMany({
      where: {
        assigneeId: userId,
        project: { workspace: { members: { some: { userId } } } },
        ...(!includeCompleted ? { status: { isCompleted: false } } : {}),
      },
      include: assignedTaskInclude,
      orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
    });

    return {
      tasks: tasks.map((task) => this.toMyTaskSummary(task)),
    };
  }

  async getTaskFocus(userId: string, today: string): Promise<TaskFocusResponse> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
      throw new BadRequestException("The dashboard date must use YYYY-MM-DD format.");
    }
    const start = new Date(`${today}T00:00:00.000Z`);
    if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== today) {
      throw new BadRequestException("The dashboard date is invalid.");
    }
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const accessibleTask = {
      assigneeId: userId,
      project: { workspace: { members: { some: { userId } } } },
      NOT: { status: { name: { contains: "cancel", mode: "insensitive" as const } } },
    };
    const openTask = { ...accessibleTask, status: { isCompleted: false } };
    const [openCount, dueTodayCount, overdueCount, records] = await this.prisma.$transaction([
      this.prisma.task.count({ where: openTask }),
      this.prisma.task.count({
        where: { ...openTask, dueDate: { gte: start, lt: end } },
      }),
      this.prisma.task.count({
        where: { ...openTask, dueDate: { lt: start } },
      }),
      this.prisma.task.findMany({
        where: {
          ...openTask,
          OR: [{ dueDate: { gte: start } }, { dueDate: null }],
        },
        select: {
          id: true,
          projectId: true,
          title: true,
          priority: true,
          dueDate: true,
          status: { select: { name: true } },
          project: {
            select: {
              id: true,
              name: true,
              workspace: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [
          { dueDate: { sort: "asc", nulls: "last" } },
          { updatedAt: "desc" },
        ],
        take: 8,
      }),
    ]);

    return {
      openCount,
      dueTodayCount,
      overdueCount,
      upcomingTasks: records.map((task) => ({
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        priority: task.priority,
        statusName: task.status.name,
        dueDate: task.dueDate?.toISOString() ?? null,
        project: { id: task.project.id, name: task.project.name },
        workspace: task.project.workspace,
      })),
    };
  }

  async getTask(userId: string, taskId: string): Promise<TaskDetail> {
    const task = await this.requireTask(taskId, userId);
    const [comments, availableDependencies] = await Promise.all([
      this.prisma.comment.findMany({
        where: { taskId, deletedAt: null },
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.task.findMany({
        where: { projectId: task.projectId, id: { not: taskId } },
        select: { id: true, title: true, status: { select: { name: true } } },
        orderBy: [{ title: "asc" }],
      }),
    ]);

    const existingDependencyIds = new Set(task.dependencies.map(({ dependsOnTaskId }) => dependsOnTaskId));
    return {
      ...this.toSummary(task),
      comments: comments.map(
        (comment): TaskCommentSummary => ({
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
          author: comment.author,
          canEdit: comment.authorId === userId,
        }),
      ),
      availableDependencies: availableDependencies
        .filter((dependency) => !existingDependencyIds.has(dependency.id))
        .map((dependency) => ({
          id: dependency.id,
          title: dependency.title,
          statusName: dependency.status.name,
        })),
    };
  }

  async createTask(
    userId: string,
    projectId: string,
    input: {
      title: string;
      description?: string;
      statusId: string;
      priority?: TaskPriorityContract;
      assigneeId?: string | null;
      startDate?: string | null;
      dueDate?: string | null;
      labelIds?: string[];
    },
  ): Promise<TaskDetail> {
    const project = await this.requireProject(projectId, userId);
    await this.requireStatus(projectId, input.statusId);
    await this.requireAssignee(project.workspaceId, input.assigneeId);
    await this.requireLabels(projectId, input.labelIds ?? []);
    const position = await this.nextPosition(projectId, input.statusId);

    const { task, notification, projectUpdates } = await this.prisma.$transaction(async (transaction) => {
      const createdTask = await transaction.task.create({
        data: {
          projectId,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          statusId: input.statusId,
          priority: input.priority ?? "MEDIUM",
          assigneeId: input.assigneeId || null,
          reporterId: userId,
          startDate: this.parseDate(input.startDate),
          dueDate: this.parseDate(input.dueDate),
          position,
          ...(input.labelIds?.length
            ? { labels: { create: input.labelIds.map((labelId) => ({ labelId })) } }
            : {}),
        },
        include: taskInclude,
      });
      await this.activity.record(transaction, {
        workspaceId: project.workspaceId,
        projectId,
        actorId: userId,
        entityType: "TASK",
        entityId: createdTask.id,
        action: "TASK_CREATED",
        metadata: { title: createdTask.title },
      });
      if (createdTask.assigneeId) {
        await this.activity.record(transaction, {
          workspaceId: project.workspaceId,
          projectId,
          actorId: userId,
          entityType: "TASK",
          entityId: createdTask.id,
          action: "TASK_ASSIGNED",
          metadata: { title: createdTask.title },
        });
      }
      return {
        task: createdTask,
        notification: await this.notifications.createTaskAssignment(
          transaction,
          userId,
          createdTask.id,
          createdTask.assigneeId,
        ),
        projectUpdates: await this.notifications.createProjectUpdateNotifications(
          transaction,
          userId,
          "TASK",
          createdTask.id,
          randomUUID(),
        ),
      };
    });

    if (notification) await this.notifications.publishCreated(notification);
    for (const projectUpdate of projectUpdates) await this.notifications.publishCreated(projectUpdate);
    this.realtime.publishTaskEvent({
      projectId,
      taskId: task.id,
      actorId: userId,
      action: "created",
    });
    return this.toDetail(task, userId);
  }

  async updateTask(
    userId: string,
    taskId: string,
    input: {
      title?: string;
      description?: string | null;
      statusId?: string;
      priority?: TaskPriorityContract;
      assigneeId?: string | null;
      startDate?: string | null;
      dueDate?: string | null;
      labelIds?: string[];
    },
  ): Promise<TaskDetail> {
    const task = await this.requireTask(taskId, userId);
    const project = await this.requireProject(task.projectId, userId);
    if (input.statusId !== undefined) await this.requireStatus(task.projectId, input.statusId);
    if (input.assigneeId !== undefined) {
      await this.requireAssignee(project.workspaceId, input.assigneeId);
    }
    if (input.labelIds !== undefined) await this.requireLabels(task.projectId, input.labelIds);

    const statusChanged = input.statusId !== undefined && input.statusId !== task.statusId;
    const data: Prisma.TaskUpdateInput = {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.statusId !== undefined ? { status: { connect: { id: input.statusId } } } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.assigneeId !== undefined
        ? { assignee: input.assigneeId ? { connect: { id: input.assigneeId } } : { disconnect: true } }
        : {}),
      ...(input.startDate !== undefined ? { startDate: this.parseDate(input.startDate) } : {}),
      ...(input.dueDate !== undefined ? { dueDate: this.parseDate(input.dueDate) } : {}),
      ...(statusChanged ? { position: await this.nextPosition(task.projectId, input.statusId!) } : {}),
      version: { increment: 1 },
      ...(input.labelIds !== undefined
        ? {
            labels: {
              deleteMany: {},
              ...(input.labelIds.length
                ? { create: input.labelIds.map((labelId) => ({ labelId })) }
                : {}),
            },
          }
        : {}),
    };
    const { updated, notification, projectUpdates } = await this.prisma.$transaction(async (transaction) => {
      const savedTask = await transaction.task.update({
        where: { id: taskId },
        data,
        include: taskInclude,
      });
      const assignmentNotification =
        input.assigneeId !== undefined && input.assigneeId !== task.assigneeId
          ? await this.notifications.createTaskAssignment(
              transaction,
              userId,
              taskId,
              savedTask.assigneeId,
            )
          : undefined;
      const dueDateChanged =
        input.dueDate !== undefined &&
        savedTask.dueDate?.getTime() !== task.dueDate?.getTime();
      const priorityChanged =
        input.priority !== undefined && savedTask.priority !== task.priority;
      const projectUpdates =
        statusChanged || dueDateChanged || priorityChanged
          ? await this.notifications.createProjectUpdateNotifications(
              transaction,
              userId,
              "TASK",
              taskId,
              randomUUID(),
            )
          : [];
      const assigneeChanged =
        input.assigneeId !== undefined && savedTask.assigneeId !== task.assigneeId;
      if (dueDateChanged || assigneeChanged || (statusChanged &&
        (savedTask.status.isCompleted ||
          ["cancelled", "canceled"].includes(savedTask.status.name.trim().toLowerCase())))) {
        await this.notifications.invalidateTaskReminders(transaction, taskId);
      }
      if (statusChanged) {
        await this.activity.record(transaction, {
          workspaceId: project.workspaceId,
          projectId: task.projectId,
          actorId: userId,
          entityType: "TASK",
          entityId: taskId,
          action: savedTask.status.isCompleted ? "TASK_COMPLETED" : "TASK_STATUS_CHANGED",
          metadata: {
            title: savedTask.title,
            from: task.status.name,
            to: savedTask.status.name,
          },
        });
      }
      if (input.assigneeId !== undefined && input.assigneeId !== task.assigneeId && savedTask.assigneeId) {
        await this.activity.record(transaction, {
          workspaceId: project.workspaceId,
          projectId: task.projectId,
          actorId: userId,
          entityType: "TASK",
          entityId: taskId,
          action: "TASK_ASSIGNED",
          metadata: { title: savedTask.title },
        });
      }
      if (priorityChanged) {
        await this.activity.record(transaction, {
          workspaceId: project.workspaceId,
          projectId: task.projectId,
          actorId: userId,
          entityType: "TASK",
          entityId: taskId,
          action: "TASK_PRIORITY_CHANGED",
          metadata: {
            title: savedTask.title,
            from: task.priority,
            to: savedTask.priority,
          },
        });
      }
      return { updated: savedTask, notification: assignmentNotification, projectUpdates };
    });

    if (notification) await this.notifications.publishCreated(notification);
    for (const projectUpdate of projectUpdates) await this.notifications.publishCreated(projectUpdate);
    this.realtime.publishTaskEvent({
      projectId: task.projectId,
      taskId,
      actorId: userId,
      action: "updated",
    });
    return this.toDetail(updated, userId);
  }

  async deleteTask(userId: string, taskId: string): Promise<void> {
    const task = await this.requireTask(taskId, userId);
    await this.prisma.task.delete({ where: { id: taskId } });
    this.realtime.publishTaskEvent({
      projectId: task.projectId,
      taskId,
      actorId: userId,
      action: "deleted",
    });
  }

  async createComment(userId: string, taskId: string, body: string): Promise<TaskCommentSummary> {
    const task = await this.requireTask(taskId, userId);
    const project = await this.requireProject(task.projectId, userId);
    const { comment, notifications } = await this.prisma.$transaction(async (transaction) => {
      const createdComment = await transaction.comment.create({
        data: { taskId, authorId: userId, body: body.trim() },
        include: { author: { select: { id: true, name: true } } },
      });
      await this.activity.record(transaction, {
        workspaceId: project.workspaceId,
        projectId: task.projectId,
        actorId: userId,
        entityType: "TASK",
        entityId: taskId,
        action: "TASK_COMMENTED",
        metadata: { title: task.title },
      });
      return {
        comment: createdComment,
        notifications: await this.notifications.createCommentNotifications(
          transaction,
          userId,
          taskId,
          createdComment.body,
        ),
      };
    });
    for (const notification of notifications) await this.notifications.publishCreated(notification);
    this.realtime.publishTaskEvent({
      projectId: task.projectId,
      taskId,
      actorId: userId,
      action: "commented",
    });
    return {
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      author: comment.author,
      canEdit: true,
    };
  }

  async updateComment(
    userId: string,
    commentId: string,
    body: string,
  ): Promise<TaskCommentSummary> {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, deletedAt: null, task: { project: { workspace: { members: { some: { userId } } } } } },
      select: { id: true, authorId: true, taskId: true, task: { select: { projectId: true } } },
    });
    if (!comment) throw new NotFoundException("Comment not found.");
    if (comment.authorId !== userId) throw new ForbiddenException("Only the comment author can edit it.");
    const updated = await this.prisma.comment.update({
      where: { id: commentId },
      data: { body: body.trim() },
      include: { author: { select: { id: true, name: true } } },
    });
    this.realtime.publishTaskEvent({
      projectId: comment.task.projectId,
      taskId: comment.taskId,
      actorId: userId,
      action: "commented",
    });
    return {
      id: updated.id,
      body: updated.body,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      author: updated.author,
      canEdit: true,
    };
  }

  async deleteComment(userId: string, commentId: string): Promise<void> {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, deletedAt: null, task: { project: { workspace: { members: { some: { userId } } } } } },
      select: { id: true, authorId: true, taskId: true, task: { select: { projectId: true } } },
    });
    if (!comment) throw new NotFoundException("Comment not found.");
    if (comment.authorId !== userId) throw new ForbiddenException("Only the comment author can delete it.");
    await this.prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    this.realtime.publishTaskEvent({
      projectId: comment.task.projectId,
      taskId: comment.taskId,
      actorId: userId,
      action: "commented",
    });
  }

  async listLabels(userId: string, projectId: string): Promise<ProjectLabelSummary[]> {
    await this.requireProject(projectId, userId);
    const labels = await this.prisma.label.findMany({
      where: { projectId },
      include: { _count: { select: { tasks: true } } },
      orderBy: { name: "asc" },
    });
    return labels.map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
      taskCount: label._count.tasks,
    }));
  }

  async createLabel(
    userId: string,
    projectId: string,
    input: { name: string; color?: string },
  ): Promise<ProjectLabelSummary> {
    await this.requireProject(projectId, userId);
    const name = input.name.trim();
    try {
      const label = await this.prisma.label.create({
        data: { projectId, name, color: input.color ?? "#6259D9" },
        include: { _count: { select: { tasks: true } } },
      });
      this.realtime.publishTaskEvent({
        projectId,
        taskId: null,
        actorId: userId,
        action: "labels-updated",
      });
      return { id: label.id, name: label.name, color: label.color, taskCount: 0 };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("A label with that name already exists in this project.");
      }
      throw error;
    }
  }

  async updateLabel(
    userId: string,
    projectId: string,
    labelId: string,
    input: { name?: string; color?: string },
  ): Promise<ProjectLabelSummary> {
    await this.requireProject(projectId, userId);
    const existing = await this.prisma.label.findFirst({ where: { id: labelId, projectId } });
    if (!existing) throw new NotFoundException("Label not found.");
    try {
      const label = await this.prisma.label.update({
        where: { id: labelId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
        },
        include: { _count: { select: { tasks: true } } },
      });
      this.realtime.publishTaskEvent({
        projectId,
        taskId: null,
        actorId: userId,
        action: "labels-updated",
      });
      return {
        id: label.id,
        name: label.name,
        color: label.color,
        taskCount: label._count.tasks,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("A label with that name already exists in this project.");
      }
      throw error;
    }
  }

  async deleteLabel(userId: string, projectId: string, labelId: string): Promise<void> {
    await this.requireProject(projectId, userId);
    const result = await this.prisma.label.deleteMany({ where: { id: labelId, projectId } });
    if (result.count === 0) throw new NotFoundException("Label not found.");
    this.realtime.publishTaskEvent({
      projectId,
      taskId: null,
      actorId: userId,
      action: "labels-updated",
    });
  }

  async addDependency(userId: string, taskId: string, dependsOnTaskId: string): Promise<TaskDetail> {
    const task = await this.requireTask(taskId, userId);
    const dependsOn = await this.requireTask(dependsOnTaskId, userId);
    if (task.projectId !== dependsOn.projectId) {
      throw new ConflictException("Task dependencies must be in the same project.");
    }
    if (taskId === dependsOnTaskId) {
      throw new ConflictException("A task cannot depend on itself.");
    }

    const graph = await this.prisma.task.findMany({
      where: { projectId: task.projectId },
      select: { id: true, dependencies: { select: { dependsOnTaskId: true } } },
    });
    const edges = new Map(graph.map((item) => [item.id, item.dependencies.map((edge) => edge.dependsOnTaskId)]));
    const visited = new Set<string>();
    const reachesTask = (id: string): boolean => {
      if (id === taskId) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      return (edges.get(id) ?? []).some(reachesTask);
    };
    if (reachesTask(dependsOnTaskId)) {
      throw new ConflictException("This dependency would create a task cycle.");
    }

    try {
      await this.prisma.taskDependency.create({
        data: { taskId, dependsOnTaskId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("That task dependency already exists.");
      }
      throw error;
    }
    this.realtime.publishTaskEvent({
      projectId: task.projectId,
      taskId,
      actorId: userId,
      action: "updated",
    });
    return this.getTask(userId, taskId);
  }

  async removeDependency(userId: string, taskId: string, dependsOnTaskId: string): Promise<TaskDetail> {
    const task = await this.requireTask(taskId, userId);
    const dependency = await this.prisma.taskDependency.deleteMany({
      where: { taskId, dependsOnTaskId, task: { projectId: task.projectId } },
    });
    if (dependency.count === 0) throw new NotFoundException("Task dependency not found.");
    this.realtime.publishTaskEvent({
      projectId: task.projectId,
      taskId,
      actorId: userId,
      action: "updated",
    });
    return this.getTask(userId, taskId);
  }

  private async requireProject(projectId: string, userId: string): Promise<{ id: string; workspaceId: string }> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspace: { members: { some: { userId } } } },
      select: { id: true, workspaceId: true },
    });
    if (!project) throw new NotFoundException("Project not found.");
    await this.workspaceAccess.requireMembership(project.workspaceId, userId);
    return project;
  }

  private async requireTask(taskId: string, userId: string): Promise<IncludedTask> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, project: { workspace: { members: { some: { userId } } } } },
      include: taskInclude,
    });
    if (!task) throw new NotFoundException("Task not found.");
    return task;
  }

  private async requireStatus(projectId: string, statusId: string): Promise<void> {
    const status = await this.prisma.projectStatus.findFirst({ where: { id: statusId, projectId }, select: { id: true } });
    if (!status) throw new ConflictException("Choose a status from this project.");
  }

  private async requireAssignee(workspaceId: string, assigneeId?: string | null): Promise<void> {
    if (!assigneeId) return;
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: assigneeId } },
      select: { userId: true },
    });
    if (!member) throw new ConflictException("The assignee must belong to this workspace.");
  }

  private async requireLabels(projectId: string, labelIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(labelIds)];
    if (uniqueIds.length !== labelIds.length) throw new ConflictException("A label can only be selected once.");
    if (!uniqueIds.length) return;
    const count = await this.prisma.label.count({ where: { projectId, id: { in: uniqueIds } } });
    if (count !== uniqueIds.length) throw new ConflictException("Choose labels from this project.");
  }

  private async nextPosition(projectId: string, statusId: string): Promise<number> {
    const last = await this.prisma.task.findFirst({
      where: { projectId, statusId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    return (last?.position ?? -1) + 1;
  }

  private parseDate(value?: string | null): Date | null {
    return value ? new Date(value) : null;
  }

  private parseCalendarDate(value: string | undefined, fieldName: string): Date {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`The calendar ${fieldName} must use YYYY-MM-DD format.`);
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException(`The calendar ${fieldName} is invalid.`);
    }
    return date;
  }

  private dateOnly(value: Date | null): string | null {
    return value?.toISOString().slice(0, 10) ?? null;
  }

  private toWorkspaceCalendarTask(task: IncludedWorkspaceCalendarTask): WorkspaceCalendarResponse["tasks"][number] {
    const summary = this.toSummary(task);
    if (!summary.dueDate) {
      throw new Error("The calendar task query returned a task without a due date.");
    }
    return {
      ...summary,
      dueDate: summary.dueDate,
      project: task.project,
    };
  }

  private toSummary(task: IncludedTask): TaskSummary {
    return {
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      statusId: task.statusId,
      statusName: task.status.name,
      statusColor: task.status.color,
      priority: task.priority,
      assignee: task.assignee,
      reporterId: task.reporterId,
      startDate: this.dateOnly(task.startDate),
      dueDate: this.dateOnly(task.dueDate),
      position: task.position,
      version: task.version,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      labels: task.labels.map(({ label }) => label),
      dependencies: task.dependencies.map(({ dependsOn }) => ({
        id: dependsOn.id,
        title: dependsOn.title,
        statusName: dependsOn.status.name,
      })),
      commentCount: task._count.comments,
    };
  }

  private toMyTaskSummary(task: IncludedAssignedTask): MyTasksResponse["tasks"][number] {
    return {
      ...this.toSummary(task),
      statusIsCompleted: task.status.isCompleted,
      project: task.project,
    };
  }

  private async toDetail(task: IncludedTask, userId: string): Promise<TaskDetail> {
    const [comments, availableDependencies] = await Promise.all([
      this.prisma.comment.findMany({
        where: { taskId: task.id, deletedAt: null },
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.task.findMany({
        where: { projectId: task.projectId, id: { not: task.id } },
        select: { id: true, title: true, status: { select: { name: true } } },
        orderBy: { title: "asc" },
      }),
    ]);
    const linked = new Set(task.dependencies.map(({ dependsOnTaskId }) => dependsOnTaskId));
    return {
      ...this.toSummary(task),
      comments: comments.map(
        (comment): TaskCommentSummary => ({
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
          author: comment.author,
          canEdit: comment.authorId === userId,
        }),
      ),
      availableDependencies: availableDependencies
        .filter(({ id }) => !linked.has(id))
        .map(({ id, title, status }) => ({ id, title, statusName: status.name })),
    };
  }
}
