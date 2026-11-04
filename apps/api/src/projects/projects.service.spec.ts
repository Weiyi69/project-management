import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActivityService } from "../activity/activity.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { ProjectsService } from "./projects.service";

const actorId = "15442c08-e919-4a81-ac54-e5d7b42102dd";
const memberId = "fc14b956-eead-442d-afa0-7f8a4c266abb";
const projectId = "ed7abe70-253b-47c2-aee4-449a4c726675";
const workspaceId = "f8c26d52-9f62-44b0-b343-531d14513175";

function createService(
  prisma: unknown,
  activity: ActivityService = { record: async () => undefined } as unknown as ActivityService,
): ProjectsService {
  return new ProjectsService(
    prisma as PrismaService,
    {} as WorkspaceAccessService,
    activity,
    {} as never,
  );
}

function projectMember(overrides: Record<string, unknown> = {}) {
  return {
    userId: memberId,
    projectRole: "MEMBER",
    joinedAt: new Date("2025-01-01T00:00:00.000Z"),
    user: { id: memberId, name: "Project Member", email: "member@example.test" },
    ...overrides,
  };
}

async function expectStatus(promise: Promise<unknown>, status: number): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    return (
      typeof error === "object" &&
      error !== null &&
      "getStatus" in error &&
      typeof error.getStatus === "function" &&
      error.getStatus() === status
    );
  });
}

test("project member listing is scoped to the viewer's workspace and returns current workspace members", async () => {
  let projectWhere: unknown;
  const service = createService({
    project: {
      findFirst: async (args: { where: unknown }) => {
        projectWhere = args.where;
        return {
          members: [
            projectMember(),
            projectMember({
              userId: "c805c7c5-b107-4584-b4b2-b181c32e5934",
              user: {
                id: "c805c7c5-b107-4584-b4b2-b181c32e5934",
                name: "Former Workspace Member",
                email: "former@example.test",
              },
            }),
          ],
          workspace: {
            members: [
              { user: { id: actorId, name: "Project Owner", email: "owner@example.test" } },
              { user: { id: memberId, name: "Project Member", email: "member@example.test" } },
            ],
          },
        };
      },
    },
  });

  const result = await service.listProjectMembers(actorId, projectId);

  assert.deepEqual(projectWhere, {
    id: projectId,
    workspace: { members: { some: { userId: actorId } } },
  });
  assert.deepEqual(result.members, [
    {
      userId: memberId,
      name: "Project Member",
      email: "member@example.test",
      projectRole: "MEMBER",
      joinedAt: "2025-01-01T00:00:00.000Z",
    },
  ]);
  assert.deepEqual(result.workspaceMembers, [
    { id: actorId, name: "Project Owner", email: "owner@example.test" },
    { id: memberId, name: "Project Member", email: "member@example.test" },
  ]);
});

test("only current workspace members can be added to a project", async () => {
  let createCalled = false;
  const service = createService({
    project: { findFirst: async () => ({ id: projectId, workspaceId }) },
    $transaction: async (run: (transaction: unknown) => Promise<unknown>) =>
      run({
        workspaceMember: {
          findUnique: async ({ where }: { where: { workspaceId_userId: { userId: string } } }) =>
            where.workspaceId_userId.userId === actorId ? { role: "OWNER" } : null,
        },
        projectMember: {
          create: async () => {
            createCalled = true;
            return projectMember();
          },
        },
      }),
  });

  await expectStatus(
    service.addProjectMember(actorId, projectId, memberId, "MEMBER"),
    404,
  );
  assert.equal(createCalled, false);
});

test("project members cannot manage other memberships", async () => {
  const service = createService({
    project: { findFirst: async () => ({ id: projectId, workspaceId }) },
    $transaction: async (run: (transaction: unknown) => Promise<unknown>) =>
      run({
        workspaceMember: {
          findUnique: async () => ({ role: "MEMBER" }),
        },
        projectMember: {
          findUnique: async () => ({ projectRole: "MEMBER" }),
        },
      }),
  });

  await expectStatus(
    service.updateProjectMemberRole(actorId, projectId, memberId, "ADMIN"),
    403,
  );
});

test("the last project admin cannot be demoted", async () => {
  let updateCalled = false;
  const service = createService({
    project: { findFirst: async () => ({ id: projectId, workspaceId }) },
    $transaction: async (run: (transaction: unknown) => Promise<unknown>) =>
      run({
        workspaceMember: { findUnique: async () => ({ role: "OWNER" }) },
        projectMember: {
          findUnique: async () => projectMember({ projectRole: "ADMIN" }),
          count: async () => 1,
          update: async () => {
            updateCalled = true;
            return projectMember();
          },
        },
      }),
  });

  await expectStatus(
    service.updateProjectMemberRole(actorId, projectId, memberId, "MEMBER"),
    409,
  );
  assert.equal(updateCalled, false);
});

test("the last project admin cannot be removed", async () => {
  let deleteCalled = false;
  const service = createService({
    project: { findFirst: async () => ({ id: projectId, workspaceId }) },
    $transaction: async (run: (transaction: unknown) => Promise<unknown>) =>
      run({
        workspaceMember: { findUnique: async () => ({ role: "OWNER" }) },
        projectMember: {
          findUnique: async () => projectMember({ projectRole: "ADMIN" }),
          count: async () => 1,
          delete: async () => {
            deleteCalled = true;
            return projectMember();
          },
        },
      }),
  });

  await expectStatus(service.removeProjectMember(actorId, projectId, memberId), 409);
  assert.equal(deleteCalled, false);
});
