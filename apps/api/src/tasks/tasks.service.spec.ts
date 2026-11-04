import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaService } from "../prisma/prisma.service";
import type { RealtimeGateway } from "../realtime/realtime.gateway";
import type { NotificationsService } from "../notifications/notifications.service";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import type { ActivityService } from "../activity/activity.service";
import { TasksService } from "./tasks.service";

const userId = "15442c08-e919-4a81-ac54-e5d7b42102dd";
const workspaceId = "ed7abe70-253b-47c2-aee4-449a4c726675";
const projectId = "61b77378-0a0a-44de-8b78-774f7601892d";
const statusId = "b307e0d1-1339-4103-8e13-75606bb256d8";
const taskId = "fc14b956-eead-442d-afa0-7f8a4c266abb";
const now = new Date("2026-10-31T00:00:00.000Z");
const activity = { record: async () => undefined } as unknown as ActivityService;

test("updates a task status through the Prisma status relation", async () => {
  const task = {
    id: taskId,
    projectId,
    title: "Sign-in Page",
    description: null,
    statusId,
    priority: "HIGH",
    assigneeId: userId,
    reporterId: userId,
    startDate: now,
    dueDate: new Date("2026-11-07T00:00:00.000Z"),
    position: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
    status: { id: statusId, name: "In progress", color: "#6259D9" },
    assignee: { id: userId, name: "Test User", email: "test@example.invalid" },
    labels: [],
    dependencies: [],
    _count: { comments: 0 },
  };
  let updateData: { status?: unknown; statusId?: unknown } | undefined;
  const transaction = {
    task: {
      update: async (args: { data: { status?: unknown; statusId?: unknown } }) => {
        updateData = args.data;
        return { ...task, version: 2, updatedAt: new Date() };
      },
    },
  };
  const prisma = {
    task: {
      findFirst: async () => task,
      findMany: async () => [],
    },
    project: {
      findFirst: async () => ({ id: projectId, workspaceId }),
    },
    projectStatus: {
      findFirst: async () => ({ id: statusId }),
    },
    workspaceMember: {
      findUnique: async () => ({ userId }),
    },
    comment: {
      findMany: async () => [],
    },
    $transaction: async (callback: (value: unknown) => Promise<unknown>) =>
      callback(transaction),
  } as unknown as PrismaService;
  const realtime = { publishTaskEvent: () => undefined } as unknown as RealtimeGateway;
  const notifications = {
    createTaskAssignment: async () => undefined,
  } as unknown as NotificationsService;
  const workspaceAccess = {
    requireMembership: async () => ({ workspaceId, userId, role: "OWNER" as const }),
  } as unknown as WorkspaceAccessService;
  const service = new TasksService(prisma, workspaceAccess, realtime, notifications, activity);

  const updated = await service.updateTask(userId, taskId, {
    statusId,
    assigneeId: userId,
    startDate: "2026-10-31",
    dueDate: "2026-11-07",
    labelIds: [],
  });

  assert.deepEqual(updateData?.status, { connect: { id: statusId } });
  assert.equal(updateData?.statusId, undefined);
  assert.equal(updated.version, 2);
});

test("lists the signed-in user's tasks from accessible workspaces and hides completed tasks by default", async () => {
  const task = {
    id: taskId,
    projectId,
    title: "Review project plan",
    description: null,
    statusId,
    priority: "MEDIUM",
    assigneeId: userId,
    reporterId: userId,
    startDate: null,
    dueDate: null,
    position: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
    status: { id: statusId, name: "To do", color: "#94A3B8", isCompleted: false },
    assignee: { id: userId, name: "Test User", email: "test@example.invalid" },
    labels: [],
    dependencies: [],
    _count: { comments: 0 },
    project: {
      id: projectId,
      name: "Test project",
      workspace: { id: workspaceId, name: "Test workspace" },
    },
  };
  let query: unknown;
  const prisma = {
    task: {
      findMany: async (args: unknown) => {
        query = args;
        return [task];
      },
    },
  } as unknown as PrismaService;
  const service = new TasksService(
    prisma,
    {} as WorkspaceAccessService,
    {} as RealtimeGateway,
    {} as NotificationsService,
    activity,
  );

  const response = await service.listMyTasks(userId);

  assert.deepEqual(query, {
    where: {
      assigneeId: userId,
      project: { workspace: { members: { some: { userId } } } },
      status: { isCompleted: false },
    },
    include: {
      status: { select: { id: true, name: true, color: true, isCompleted: true } },
      assignee: { select: { id: true, name: true, email: true } },
      labels: { include: { label: { select: { id: true, name: true, color: true } } } },
      dependencies: {
        include: {
          dependsOn: {
            select: { id: true, title: true, status: { select: { name: true } } },
          },
        },
      },
      _count: { select: { comments: { where: { deletedAt: null } } } },
      project: {
        select: {
          id: true,
          name: true,
          workspace: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
  });
  assert.equal(response.tasks.length, 1);
  assert.equal(response.tasks[0]?.id, taskId);
  assert.equal(response.tasks[0]?.statusIsCompleted, false);
  assert.deepEqual(response.tasks[0]?.project, task.project);
});

test("includes completed tasks only when requested", async () => {
  const prisma = {
    task: {
      findMany: async (args: unknown) => {
        const query = args as { where: Record<string, unknown> };
        assert.equal(query.where.assigneeId, userId);
        assert.equal("status" in query.where, false);
        return [];
      },
    },
  } as unknown as PrismaService;
  const service = new TasksService(
    prisma,
    {} as WorkspaceAccessService,
    {} as RealtimeGateway,
    {} as NotificationsService,
    activity,
  );

  const response = await service.listMyTasks(userId, true);

  assert.deepEqual(response, { tasks: [] });
});

test("lists only due-dated workspace tasks within the requested calendar dates", async () => {
  const task = {
    id: taskId,
    projectId,
    title: "Review project plan",
    description: null,
    statusId,
    priority: "HIGH",
    assigneeId: userId,
    reporterId: userId,
    startDate: null,
    dueDate: new Date("2026-11-07T00:00:00.000Z"),
    position: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
    status: { id: statusId, name: "To do", color: "#94A3B8" },
    assignee: { id: userId, name: "Test User", email: "test@example.invalid" },
    labels: [],
    dependencies: [],
    _count: { comments: 0 },
    project: { id: projectId, name: "Test project" },
  };
  let taskQuery: Record<string, unknown> | undefined;
  let workspaceQuery: Record<string, unknown> | undefined;
  let membershipCheck = false;
  const prisma = {
    task: {
      findMany: async (args: Record<string, unknown>) => {
        taskQuery = args;
        return [task];
      },
    },
    workspace: {
      findFirst: async (args: Record<string, unknown>) => {
        workspaceQuery = args;
        return {
          projects: [
            {
              id: projectId,
              name: "Test project",
              statuses: [{ id: statusId, name: "To do", color: "#94A3B8", position: 0 }],
            },
          ],
          members: [{ user: { id: userId, name: "Test User", email: "test@example.invalid" } }],
        };
      },
    },
  } as unknown as PrismaService;
  const workspaceAccess = {
    requireMembership: async (requestedWorkspaceId: string, requestedUserId: string) => {
      assert.equal(requestedWorkspaceId, workspaceId);
      assert.equal(requestedUserId, userId);
      membershipCheck = true;
      return { workspaceId, userId, role: "OWNER" as const };
    },
  } as unknown as WorkspaceAccessService;
  const service = new TasksService(
    prisma,
    workspaceAccess,
    {} as RealtimeGateway,
    {} as NotificationsService,
    activity,
  );

  const response = await service.listWorkspaceCalendarTasks(
    userId,
    workspaceId,
    "2026-11-01",
    "2026-11-07",
  );

  assert.equal(membershipCheck, true);
  assert.deepEqual(taskQuery?.where, {
    dueDate: {
      gte: new Date("2026-11-01T00:00:00.000Z"),
      lt: new Date("2026-11-08T00:00:00.000Z"),
    },
    project: {
      workspaceId,
      workspace: { members: { some: { userId } } },
    },
  });
  assert.deepEqual(workspaceQuery?.where, { id: workspaceId, members: { some: { userId } } });
  assert.equal(response.tasks.length, 1);
  assert.equal(response.tasks[0]?.dueDate, "2026-11-07");
  assert.equal(response.tasks[0]?.project.name, "Test project");
  assert.equal(response.projects[0]?.statuses[0]?.name, "To do");
  assert.equal(response.members[0]?.id, userId);
});

test("rejects invalid workspace calendar date ranges", async () => {
  let workspaceQueryCount = 0;
  const prisma = {
    workspace: {
      findFirst: async () => {
        workspaceQueryCount += 1;
        return null;
      },
    },
    task: { findMany: async () => [] },
  } as unknown as PrismaService;
  const workspaceAccess = {
    requireMembership: async () => ({ workspaceId, userId, role: "OWNER" as const }),
  } as unknown as WorkspaceAccessService;
  const service = new TasksService(
    prisma,
    workspaceAccess,
    {} as RealtimeGateway,
    {} as NotificationsService,
    activity,
  );

  await assert.rejects(
    service.listWorkspaceCalendarTasks(userId, workspaceId, "2026-02-30", "2026-03-01"),
    /calendar startDate is invalid/,
  );
  await assert.rejects(
    service.listWorkspaceCalendarTasks(userId, workspaceId, "2026-11-08", "2026-11-07"),
    /start date must be on or before its end date/,
  );
  await assert.rejects(
    service.listWorkspaceCalendarTasks(userId, workspaceId, undefined, "2026-11-07"),
    /calendar startDate must use YYYY-MM-DD format/,
  );
  assert.equal(workspaceQueryCount, 0);
});

test("aggregates only open assigned tasks across the user's current workspace memberships", async () => {
  const upcoming = {
    id: taskId,
    projectId,
    title: "Review project plan",
    priority: "HIGH",
    dueDate: new Date("2026-11-02T00:00:00.000Z"),
    status: { name: "To do" },
    project: {
      id: projectId,
      name: "Test project",
      workspace: { id: workspaceId, name: "Test workspace" },
    },
  };
  const countQueries: Array<Record<string, unknown>> = [];
  let taskQuery: Record<string, unknown> | undefined;
  const prisma = {
    task: {
      count: async (args: { where: Record<string, unknown> }) => {
        countQueries.push(args.where);
        return [7, 2, 1][countQueries.length - 1] ?? 0;
      },
      findMany: async (args: Record<string, unknown>) => {
        taskQuery = args;
        return [upcoming];
      },
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as PrismaService;
  const service = new TasksService(
    prisma,
    {} as WorkspaceAccessService,
    {} as RealtimeGateway,
    {} as NotificationsService,
    activity,
  );

  const response = await service.getTaskFocus(userId, "2026-10-31");

  assert.deepEqual(response, {
    openCount: 7,
    dueTodayCount: 2,
    overdueCount: 1,
    upcomingTasks: [
      {
        id: taskId,
        projectId,
        title: "Review project plan",
        priority: "HIGH",
        statusName: "To do",
        dueDate: "2026-11-02T00:00:00.000Z",
        project: { id: projectId, name: "Test project" },
        workspace: { id: workspaceId, name: "Test workspace" },
      },
    ],
  });
  assert.equal(countQueries.length, 3);
  for (const where of countQueries) {
    assert.equal(where.assigneeId, userId);
    assert.deepEqual(where.project, { workspace: { members: { some: { userId } } } });
    assert.deepEqual(where.status, { isCompleted: false });
    assert.deepEqual(where.NOT, {
      status: { name: { contains: "cancel", mode: "insensitive" } },
    });
  }
  assert.deepEqual(countQueries[1]?.dueDate, {
    gte: new Date("2026-10-31T00:00:00.000Z"),
    lt: new Date("2026-11-01T00:00:00.000Z"),
  });
  assert.deepEqual(countQueries[2]?.dueDate, {
    lt: new Date("2026-10-31T00:00:00.000Z"),
  });
  assert.deepEqual(taskQuery?.where, {
    assigneeId: userId,
    project: { workspace: { members: { some: { userId } } } },
    NOT: { status: { name: { contains: "cancel", mode: "insensitive" } } },
    status: { isCompleted: false },
    OR: [
      { dueDate: { gte: new Date("2026-10-31T00:00:00.000Z") } },
      { dueDate: null },
    ],
  });
});

test("rejects malformed dashboard dates", async () => {
  const service = new TasksService(
    {} as PrismaService,
    {} as WorkspaceAccessService,
    {} as RealtimeGateway,
    {} as NotificationsService,
    activity,
  );

  await assert.rejects(service.getTaskFocus(userId, "not-a-date"), /YYYY-MM-DD/);
});
