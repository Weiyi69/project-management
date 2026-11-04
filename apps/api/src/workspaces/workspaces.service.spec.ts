import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActivityService } from "../activity/activity.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { RealtimeGateway } from "../realtime/realtime.gateway";
import type { EmailService } from "./email.service";
import type { WorkspaceAccessService } from "./workspace-access.service";
import { WorkspacesService } from "./workspaces.service";

const userId = "15442c08-e919-4a81-ac54-e5d7b42102dd";
const invitationId = "fc14b956-eead-442d-afa0-7f8a4c266abb";
const workspaceId = "ed7abe70-253b-47c2-aee4-449a4c726675";
const expiresAt = new Date(Date.now() + 60_000);

function createService(
  prisma: Partial<PrismaService>,
  activity: ActivityService = { record: async () => undefined } as unknown as ActivityService,
  access: WorkspaceAccessService = {} as WorkspaceAccessService,
): WorkspacesService {
  return new WorkspacesService(
    prisma as PrismaService,
    access,
    {} as EmailService,
    {} as RealtimeGateway,
    activity,
    {} as NotificationsService,
  );
}

test("pending invitation acceptance binds the claim and membership to the verified email atomically", async () => {
  let claimWhere: unknown;
  let membershipCreate: unknown;
  const activityRecords: unknown[] = [];
  const invitation = {
    id: invitationId,
    workspaceId,
    email: "invitee@example.test",
    role: "MEMBER",
    acceptedAt: null,
    expiresAt,
    workspace: { id: workspaceId, name: "Team", slug: "team" },
  };
  const prisma = {
    user: {
      findUnique: async () => ({
        email: " Invitee@Example.Test ",
        name: "Invitee",
        emailVerifiedAt: new Date(),
      }),
    },
    workspaceInvitation: {
      findFirst: async () => invitation,
    },
    workspaceMember: {},
    $transaction: async (run: (transaction: unknown) => Promise<unknown>) =>
      run({
        workspaceInvitation: {
          updateMany: async (args: { where: unknown }) => {
            claimWhere = args.where;
            return { count: 1 };
          },
        },
        workspaceMember: {
          upsert: async (args: { create: unknown }) => {
            membershipCreate = args.create;
            return { role: "MEMBER" };
          },
        },
      }),
  } as unknown as PrismaService;
  const activity = {
    record: async (_transaction: unknown, input: unknown) => {
      activityRecords.push(input);
    },
  } as unknown as ActivityService;
  const service = createService(prisma, activity);

  const accepted = await service.acceptPendingInvitation(userId, invitationId);

  assert.deepEqual(accepted, { id: workspaceId, name: "Team", slug: "team", role: "MEMBER" });
  assert.ok(typeof claimWhere === "object" && claimWhere !== null);
  const claimFilter = claimWhere as {
    id: string;
    email: string;
    acceptedAt: Date | null;
    expiresAt: { gt: Date };
  };
  assert.equal(claimFilter.id, invitationId);
  assert.equal(claimFilter.email, "invitee@example.test");
  assert.equal(claimFilter.acceptedAt, null);
  assert.ok(claimFilter.expiresAt.gt instanceof Date);
  assert.deepEqual(membershipCreate, {
    workspaceId,
    userId,
    role: "MEMBER",
  });
  assert.equal(activityRecords.length, 1);
});

test("a concurrent invitation acceptance cannot create a duplicate membership", async () => {
  let membershipCreated = false;
  const prisma = {
    user: {
      findUnique: async () => ({
        email: "invitee@example.test",
        name: "Invitee",
        emailVerifiedAt: new Date(),
      }),
    },
    workspaceInvitation: {
      findFirst: async () => ({
        id: invitationId,
        workspaceId,
        email: "invitee@example.test",
        role: "MEMBER",
        acceptedAt: null,
        expiresAt,
        workspace: { id: workspaceId, name: "Team", slug: "team" },
      }),
    },
    workspaceMember: {},
    $transaction: async (run: (transaction: unknown) => Promise<unknown>) =>
      run({
        workspaceInvitation: { updateMany: async () => ({ count: 0 }) },
        workspaceMember: {
          upsert: async () => {
            membershipCreated = true;
            return { role: "MEMBER" };
          },
        },
      }),
  } as unknown as PrismaService;

  await assert.rejects(createService(prisma).acceptPendingInvitation(userId, invitationId));
  assert.equal(membershipCreated, false);
});

test("declining a pending invitation deletes only a live invite for the verified email", async () => {
  let deleteWhere: unknown;
  const prisma = {
    user: {
      findUnique: async () => ({
        email: "Invitee@Example.Test",
        name: "Invitee",
        emailVerifiedAt: new Date(),
      }),
    },
    workspaceInvitation: {
      findFirst: async () => ({ role: "MEMBER" }),
      deleteMany: async (args: { where: unknown }) => {
        deleteWhere = args.where;
        return { count: 1 };
      },
    },
  } as unknown as PrismaService;

  await createService(prisma).declinePendingInvitation(userId, invitationId);

  assert.ok(typeof deleteWhere === "object" && deleteWhere !== null);
  const deleteFilter = deleteWhere as {
    id: string;
    email: string;
    acceptedAt: Date | null;
    expiresAt: { gt: Date };
  };
  assert.equal(deleteFilter.id, invitationId);
  assert.equal(deleteFilter.email, "invitee@example.test");
  assert.equal(deleteFilter.acceptedAt, null);
  assert.ok(deleteFilter.expiresAt.gt instanceof Date);
});

test("unverified users cannot list recipient-facing invitations", async () => {
  let invitationsQueried = false;
  const prisma = {
    user: {
      findUnique: async () => ({
        email: "invitee@example.test",
        name: "Invitee",
        emailVerifiedAt: null,
      }),
    },
    workspaceInvitation: {
      findMany: async () => {
        invitationsQueried = true;
        return [];
      },
    },
  } as unknown as PrismaService;

  await assert.rejects(createService(prisma).listPendingInvitations(userId));
  assert.equal(invitationsQueried, false);
});

test("the pending inbox preserves ADMIN and MEMBER roles and omits invalid OWNER invitations", async () => {
  const service = createService({
    user: {
      findUnique: async () => ({
        email: "invitee@example.test",
        name: "Invitee",
        emailVerifiedAt: new Date(),
      }),
    },
    workspaceInvitation: {
      findMany: async () => [
        {
          id: "member-invitation",
          role: "MEMBER",
          expiresAt,
          workspace: { id: workspaceId, name: "Member workspace" },
          inviter: { name: "Member inviter" },
        },
        {
          id: "admin-invitation",
          role: "ADMIN",
          expiresAt,
          workspace: { id: workspaceId, name: "Admin workspace" },
          inviter: { name: "Admin inviter" },
        },
        {
          id: "owner-invitation",
          role: "OWNER",
          expiresAt,
          workspace: { id: workspaceId, name: "Invalid workspace" },
          inviter: { name: "Invalid inviter" },
        },
      ],
    },
  } as unknown as PrismaService);

  const invitations = await service.listPendingInvitations(userId);

  assert.deepEqual(invitations.map(({ id, role }) => ({ id, role })), [
    { id: "member-invitation", role: "MEMBER" },
    { id: "admin-invitation", role: "ADMIN" },
  ]);
});

test("workspace managers do not receive unsupported OWNER invitations in invitation listings", async () => {
  const service = createService(
    {
      workspaceInvitation: {
        findMany: async () => [
          {
            id: "member-invitation",
            email: "member@example.test",
            role: "MEMBER",
            expiresAt,
            acceptedAt: null,
            inviter: { name: "Inviter" },
          },
          {
            id: "owner-invitation",
            email: "owner@example.test",
            role: "OWNER",
            expiresAt,
            acceptedAt: null,
            inviter: { name: "Inviter" },
          },
        ],
      },
    } as unknown as PrismaService,
    undefined,
    {
      requireWorkspaceManager: async () => ({ workspaceId, userId, role: "OWNER" }),
    } as unknown as WorkspaceAccessService,
  );

  const invitations = await service.listInvitations(workspaceId, userId);

  assert.deepEqual(invitations.map(({ role }) => role), ["MEMBER"]);
});

test("a token invitation with OWNER role is rejected before account or membership changes", async () => {
  let userLookedUp = false;
  let transactionStarted = false;
  const prisma = {
    workspaceInvitation: {
      findUnique: async () => ({
        id: invitationId,
        workspaceId,
        email: "invitee@example.test",
        role: "OWNER",
        acceptedAt: null,
        expiresAt,
        workspace: { id: workspaceId, name: "Team", slug: "team" },
      }),
    },
    user: {
      findUniqueOrThrow: async () => {
        userLookedUp = true;
        return {
          id: userId,
          email: "invitee@example.test",
          name: "Invitee",
          emailVerifiedAt: new Date(),
        };
      },
    },
    $transaction: async () => {
      transactionStarted = true;
      throw new Error("An invalid invite must not start a membership transaction.");
    },
  } as unknown as PrismaService;

  await assert.rejects(createService(prisma).acceptInvitation(userId, "valid-looking-token"));
  assert.equal(userLookedUp, false);
  assert.equal(transactionStarted, false);
});

test("an inbox OWNER invitation is rejected before its membership transaction", async () => {
  let transactionStarted = false;
  const prisma = {
    user: {
      findUnique: async () => ({
        email: "invitee@example.test",
        name: "Invitee",
        emailVerifiedAt: new Date(),
      }),
    },
    workspaceInvitation: {
      findFirst: async () => ({
        id: invitationId,
        workspaceId,
        email: "invitee@example.test",
        role: "OWNER",
        acceptedAt: null,
        expiresAt,
        workspace: { id: workspaceId, name: "Team", slug: "team" },
      }),
    },
    $transaction: async () => {
      transactionStarted = true;
      throw new Error("An invalid invite must not start a membership transaction.");
    },
  } as unknown as PrismaService;

  await assert.rejects(createService(prisma).acceptPendingInvitation(userId, invitationId));
  assert.equal(transactionStarted, false);
});

test("an OWNER invitation cannot be previewed as an assignable role", async () => {
  const service = createService({
    workspaceInvitation: {
      findUnique: async () => ({
        id: invitationId,
        workspaceId,
        email: "invitee@example.test",
        role: "OWNER",
        acceptedAt: null,
        expiresAt,
        workspace: { id: workspaceId, name: "Team", slug: "team" },
      }),
    },
  } as unknown as PrismaService);

  await assert.rejects(service.previewInvitation("valid-looking-token"));
});

test("unsupported invitation creation roles are rejected before persistence", async () => {
  let invitationCreated = false;
  const service = createService(
    {
      workspaceInvitation: {
        upsert: async () => {
          invitationCreated = true;
          throw new Error("Unsupported roles must not be persisted.");
        },
      },
    } as unknown as PrismaService,
    undefined,
    {
      requireWorkspaceManager: async () => ({ workspaceId, userId, role: "OWNER" }),
    } as unknown as WorkspaceAccessService,
  );
  const invalidInput = {
    email: "invitee@example.test",
    role: "OWNER" as "ADMIN",
  };

  await assert.rejects(
    service.createInvitation(workspaceId, userId, invalidInput),
    /support only admin or member roles/i,
  );
  assert.equal(invitationCreated, false);
});

test("a valid ADMIN invitation grants only ADMIN membership and leaves workspace ownership unchanged", async () => {
  let membershipCreate: unknown;
  let transactionCount = 0;
  const invitation = {
    id: invitationId,
    workspaceId,
    email: "invitee@example.test",
    role: "ADMIN",
    acceptedAt: null,
    expiresAt,
    workspace: { id: workspaceId, name: "Team", slug: "team", ownerId: "original-owner" },
  };
  const prisma = {
    user: {
      findUnique: async () => ({
        email: "invitee@example.test",
        name: "Invitee",
        emailVerifiedAt: new Date(),
      }),
    },
    workspaceInvitation: {
      findFirst: async () => invitation,
    },
    workspaceMember: {},
    $transaction: async (run: (transaction: unknown) => Promise<unknown>) => {
      transactionCount += 1;
      return run({
        workspaceInvitation: {
          updateMany: async () => ({ count: 1 }),
        },
        workspaceMember: {
          upsert: async (args: { create: unknown }) => {
            membershipCreate = args.create;
            return { role: "ADMIN" };
          },
        },
      });
    },
  } as unknown as PrismaService;

  const accepted = await createService(prisma).acceptPendingInvitation(userId, invitationId);

  assert.equal(accepted.role, "ADMIN");
  assert.deepEqual(membershipCreate, {
    workspaceId,
    userId,
    role: "ADMIN",
  });
  assert.equal(transactionCount, 1);
  assert.equal(invitation.workspace.ownerId, "original-owner");
});
