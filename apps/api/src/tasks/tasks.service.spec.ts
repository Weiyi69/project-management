import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaService } from "../prisma/prisma.service";
import type { RealtimeGateway } from "../realtime/realtime.gateway";
import type { NotificationsService } from "../notifications/notifications.service";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { TasksService } from "./tasks.service";

const userId = "15442c08-e919-4a81-ac54-e5d7b42102dd";
const workspaceId = "ed7abe70-253b-47c2-aee4-449a4c726675";
const projectId = "61b77378-0a0a-44de-8b78-774f7601892d";
const statusId = "b307e0d1-1339-4103-8e13-75606bb256d8";
const taskId = "fc14b956-eead-442d-afa0-7f8a4c266abb";
const now = new Date("2026-10-31T00:00:00.000Z");

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
  const service = new TasksService(prisma, workspaceAccess, realtime, notifications);

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
