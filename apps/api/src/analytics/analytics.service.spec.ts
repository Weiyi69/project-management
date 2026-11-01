import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import { test } from "node:test";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { AnalyticsService } from "./analytics.service";

const workspaceId = "9ac3c1a8-07e1-4fa8-bdf7-9011c503b704";
const projectId = "aa9b1979-c4d4-4d15-9b53-e15c787b43d2";
const memberId = "7e47cf93-a89b-4b54-8213-598ed9a2c2d7";

function makeService(
  prisma: Record<string, unknown>,
  workspaceAccess: Record<string, unknown>,
): AnalyticsService {
  return new AnalyticsService(
    prisma as unknown as PrismaService,
    workspaceAccess as unknown as WorkspaceAccessService,
  );
}

test("aggregates persisted workspace data and requires membership", async () => {
  let membershipChecked = false;
  const prismaStub = {
    workspace: {
      findUnique: async () => ({ id: workspaceId, name: "Design team" }),
    },
    project: {
      findMany: async () => [
        {
          id: projectId,
          name: "Website",
          state: "ACTIVE",
          statuses: [
            { id: "status-open", name: "Doing", color: "#6259d9", position: 0, isCompleted: false },
            { id: "status-done", name: "Done", color: "#16a34a", position: 1, isCompleted: true },
          ],
        },
      ],
    },
    task: {
      groupBy: async (args: {
        by: string[];
        where: { dueDate?: { gte?: Date; lt?: Date }; assigneeId?: null };
      }) => {
        if (args.by.includes("statusId")) {
          return [
            { projectId, statusId: "status-open", _count: { _all: 3 } },
            { projectId, statusId: "status-done", _count: { _all: 1 } },
          ];
        }
        if (args.by.includes("assigneeId")) {
          return [{ projectId, assigneeId: memberId, _count: { _all: 1 } }];
        }
        if (args.where.dueDate?.gte) return [{ projectId, _count: { _all: 1 } }];
        if (args.where.dueDate?.lt) return [{ projectId, _count: { _all: 1 } }];
        if (args.where.assigneeId === null) return [{ projectId, _count: { _all: 2 } }];
        return [{ projectId, _count: { _all: 4 } }];
      },
    },
    workspaceMember: {
      findMany: async () => [{ userId: memberId, user: { name: "Morgan" } }],
    },
  };
  const accessStub = {
    requireMembership: async (requestedWorkspaceId: string, userId: string) => {
      membershipChecked = requestedWorkspaceId === workspaceId && userId === "user-id";
    },
  };

  const report = await makeService(prismaStub, accessStub).getWorkspaceAnalytics("user-id", workspaceId);

  assert.equal(membershipChecked, true);
  assert.equal(report.workspace.name, "Design team");
  assert.equal(report.summary.totalProjects, 1);
  assert.equal(report.summary.totalTasks, 4);
  assert.equal(report.summary.completedTasks, 1);
  assert.equal(report.summary.completionRate, 25);
  assert.equal(report.summary.overdueTasks, 1);
  assert.equal(report.summary.dueSoonTasks, 1);
  assert.equal(report.unassignedOpenTasks, 2);
  assert.equal(report.workload[0]?.name, "Morgan");
  assert.equal(report.workload[0]?.assignedOpenTasks, 1);
  assert.equal(report.projects[0]?.health.status, "AT_RISK");
});

test("hides projects the requesting user cannot access", async () => {
  let queriedMembershipFilter = false;
  const service = makeService(
    {
      project: {
        findFirst: async (args: {
          where: { id: string; workspace: { members: { some: { userId: string } } } };
        }) => {
          queriedMembershipFilter =
            args.where.id === projectId && args.where.workspace.members.some.userId === "user-id";
          return null;
        },
      },
    },
    {},
  );

  await assert.rejects(
    service.getProjectAnalytics("user-id", projectId),
    (error: unknown) => error instanceof NotFoundException,
  );
  assert.equal(queriedMembershipFilter, true);
});
