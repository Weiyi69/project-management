import { Inngest } from "inngest";

import prisma from "../configs/prisma.js";

const eventKey = process.env.INNGEST_EVENT_KEY ?? process.env.INGEST_EVENT_KEY;
const signingKey =
  process.env.INNGEST_SIGNING_KEY ?? process.env.INGEST_SIGNING_KEY;

export const inngest = new Inngest({
  id: "project-management",
  ...(eventKey ? { eventKey } : {}),
  ...(signingKey ? { signingKey } : {}),
  isDev: process.env.INNGEST_DEV === "1",
});

const getEventData = (event) => {
  const payload = event?.data ?? {};

  // Clerk's Inngest transformation usually passes the webhook data through
  // directly, but some examples show the payload nested under resource keys.
  if (payload.user || payload.organization || payload.organizationMembership) {
    return (
      payload.user ??
      payload.organization ??
      payload.organizationMembership ??
      payload
    );
  }

  return payload;
};

const getPrimaryEmail = (user) => {
  if (!user?.email_addresses?.length) {
    return null;
  }

  const primaryEmail =
    user.email_addresses.find(
      (email) => email.id === user.primary_email_address_id,
    ) ?? user.email_addresses[0];

  return primaryEmail?.email_address ?? null;
};

const getDisplayName = (user) => {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  return name || getPrimaryEmail(user) || user?.username || "Unknown User";
};

const mapWorkspaceRole = (role) => {
  const normalizedRole = String(role ?? "").toLowerCase();
  return normalizedRole.includes("admin") ? "ADMIN" : "MEMBER";
};

const requireValue = (value, fieldName) => {
  if (!value) {
    throw new Error(`Missing required Clerk field: ${fieldName}`);
  }

  return value;
};

const syncUserCreation = inngest.createFunction(
  { id: "sync-user-from-clerk" },
  { event: "clerk/user.created" },
  async ({ event, step }) => {
    const data = getEventData(event);
    const email = requireValue(getPrimaryEmail(data), "email_addresses");

    await step.run("upsert-user", async () => {
      await prisma.user.upsert({
        where: { id: data.id },
        update: {
          email: email ?? undefined,
          name: getDisplayName(data),
          image: data.image_url ?? "",
        },
        create: {
          id: data.id,
          email,
          name: getDisplayName(data),
          image: data.image_url ?? "",
        },
      });
    });
  },
);

const syncUserDeletion = inngest.createFunction(
  { id: "delete-user-from-clerk" },
  { event: "clerk/user.deleted" },
  async ({ event, step }) => {
    const data = getEventData(event);

    await step.run("delete-user", async () => {
      await prisma.user.deleteMany({
        where: {
          id: data.id,
        },
      });
    });
  },
);

const syncUserUpdate = inngest.createFunction(
  { id: "update-user-from-clerk" },
  { event: "clerk/user.updated" },
  async ({ event, step }) => {
    const data = getEventData(event);
    const email = requireValue(getPrimaryEmail(data), "email_addresses");

    await step.run("update-user", async () => {
      await prisma.user.upsert({
        where: { id: data.id },
        update: {
          email: email ?? undefined,
          name: getDisplayName(data),
          image: data.image_url ?? "",
        },
        create: {
          id: data.id,
          email,
          name: getDisplayName(data),
          image: data.image_url ?? "",
        },
      });
    });
  },
);

const syncWorkspaceCreation = inngest.createFunction(
  { id: "sync-workspace-from-clerk" },
  { event: "clerk/organization.created" },
  async ({ event, step }) => {
    const data = getEventData(event);
    const ownerId = requireValue(data.created_by, "created_by");

    await step.run("upsert-workspace", async () => {
      await prisma.workspace.upsert({
        where: { id: data.id },
        update: {
          name: data.name,
          slug: data.slug,
          image_url: data.image_url ?? "",
          ownerId,
        },
        create: {
          id: data.id,
          name: data.name,
          slug: data.slug,
          ownerId,
          image_url: data.image_url ?? "",
        },
      });
    });

    await step.run("ensure-workspace-owner-membership", async () => {
      await prisma.workspaceMember.upsert({
        where: {
          userId_workspaceId: {
            userId: ownerId,
            workspaceId: data.id,
          },
        },
        update: {
          role: "ADMIN",
        },
        create: {
          userId: ownerId,
          workspaceId: data.id,
          role: "ADMIN",
        },
      });
    });
  },
);

const syncWorkspaceUpdate = inngest.createFunction(
  { id: "update-workspace-from-clerk" },
  { event: "clerk/organization.updated" },
  async ({ event, step }) => {
    const data = getEventData(event);

    await step.run("update-workspace", async () => {
      await prisma.workspace.updateMany({
        where: {
          id: data.id,
        },
        data: {
          name: data.name,
          slug: data.slug,
          image_url: data.image_url ?? "",
        },
      });
    });
  },
);

const syncWorkspaceDeletion = inngest.createFunction(
  { id: "delete-workspace-from-clerk" },
  { event: "clerk/organization.deleted" },
  async ({ event, step }) => {
    const data = getEventData(event);

    await step.run("delete-workspace", async () => {
      await prisma.workspace.deleteMany({
        where: {
          id: data.id,
        },
      });
    });
  },
);

const syncWorkspaceMembershipCreation = inngest.createFunction(
  { id: "sync-workspace-membership-from-clerk" },
  { event: "clerk/organizationMembership.created" },
  async ({ event, step }) => {
    const data = getEventData(event);
    const userId = data.public_user_data?.user_id ?? data.publicUserData?.userId;
    const workspaceId = data.organization?.id ?? data.organization_id;

    if (!userId || !workspaceId) {
      return;
    }

    await step.run("upsert-workspace-membership", async () => {
      await prisma.workspaceMember.upsert({
        where: {
          userId_workspaceId: {
            userId,
            workspaceId,
          },
        },
        update: {
          role: mapWorkspaceRole(data.role),
        },
        create: {
          userId,
          workspaceId,
          role: mapWorkspaceRole(data.role),
        },
      });
    });
  },
);

const syncWorkspaceMembershipUpdate = inngest.createFunction(
  { id: "update-workspace-membership-from-clerk" },
  { event: "clerk/organizationMembership.updated" },
  async ({ event, step }) => {
    const data = getEventData(event);
    const userId = data.public_user_data?.user_id ?? data.publicUserData?.userId;
    const workspaceId = data.organization?.id ?? data.organization_id;

    if (!userId || !workspaceId) {
      return;
    }

    await step.run("update-workspace-membership", async () => {
      await prisma.workspaceMember.updateMany({
        where: {
          userId,
          workspaceId,
        },
        data: {
          role: mapWorkspaceRole(data.role),
        },
      });
    });
  },
);

const syncWorkspaceMembershipDeletion = inngest.createFunction(
  { id: "delete-workspace-membership-from-clerk" },
  { event: "clerk/organizationMembership.deleted" },
  async ({ event, step }) => {
    const data = getEventData(event);
    const userId = data.public_user_data?.user_id ?? data.publicUserData?.userId;
    const workspaceId = data.organization?.id ?? data.organization_id;

    if (!userId || !workspaceId) {
      return;
    }

    await step.run("delete-workspace-membership", async () => {
      await prisma.workspaceMember.deleteMany({
        where: {
          userId,
          workspaceId,
        },
      });
    });
  },
);

export const functions = [
  syncUserCreation,
  syncUserDeletion,
  syncUserUpdate,
  syncWorkspaceCreation,
  syncWorkspaceUpdate,
  syncWorkspaceDeletion,
  syncWorkspaceMembershipCreation,
  syncWorkspaceMembershipUpdate,
  syncWorkspaceMembershipDeletion,
];
