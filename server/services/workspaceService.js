import prisma from "../configs/prisma.js";

const workspaceRelations = {
  members: {
    include: {
      user: true,
    },
  },
  owner: true,
};

const workspaceListRelations = {
  members: {
    include: {
      user: true,
    },
  },
  projects: {
    include: {
      tasks: {
        include: {
          assignee: true,
          comments: {
            include: {
              user: true,
            },
          },
        },
      },
      members: {
        include: {
          user: true,
        },
      },
    },
  },
};

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const forbidden = (message) => {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
};

const slugify = (value) => {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
};

const generateUniqueSlug = async (name) => {
  const baseSlug = slugify(name) || "workspace";
  let slug = baseSlug;
  let counter = 1;

  while (await prisma.workspace.findUnique({ where: { slug } })) {
    counter += 1;
    slug = `${baseSlug}-${counter}`;
  }

  return slug;
};

const ensureWorkspaceAdminAccess = async (workspaceId, userId) => {
  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId,
        workspaceId,
      },
    },
  });

  if (!membership || membership.role !== "ADMIN") {
    throw forbidden("You do not have permission to manage this workspace");
  }
};

const ensureUserExists = async (userId, actor) => {
  if (!userId) {
    throw badRequest("User ID is required");
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (existingUser) {
    return existingUser;
  }

  if (!actor?.email || !actor?.name) {
    throw badRequest("User profile is not ready yet. Please try again in a moment.");
  }

  return prisma.user.create({
    data: {
      id: userId,
      email: actor.email,
      name: actor.name,
      image: actor.image || "",
    },
  });
};

export const getWorkspacesForUser = async (userId) => {
  return prisma.workspace.findMany({
    where: {
      members: {
        some: {
          userId,
        },
      },
    },
    include: workspaceListRelations,
  });
};

export const createWorkspace = async ({
  userId,
  actor,
  name,
  description,
  image_url,
}) => {
  if (!userId) {
    throw badRequest("User ID is required");
  }

  if (!name?.trim()) {
    throw badRequest("Workspace name is required");
  }

  await ensureUserExists(userId, actor);

  const slug = await generateUniqueSlug(name);

  return prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: {
        name: name.trim(),
        slug,
        description: description?.trim() || null,
        image_url: image_url || "",
        ownerId: userId,
      },
    });

    await tx.workspaceMember.create({
      data: {
        userId,
        workspaceId: workspace.id,
        role: "ADMIN",
      },
    });

    return tx.workspace.findUnique({
      where: { id: workspace.id },
      include: workspaceRelations,
    });
  });
};

export const updateWorkspace = async ({
  userId,
  workspaceId,
  name,
  description,
  image_url,
}) => {
  if (!workspaceId || !name) {
    throw badRequest("Workspace ID and name are required");
  }

  await ensureWorkspaceAdminAccess(workspaceId, userId);

  return prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      image_url: image_url || "",
    },
    include: workspaceRelations,
  });
};

export const deleteWorkspace = async ({ userId, workspaceId }) => {
  if (!workspaceId) {
    throw badRequest("Workspace ID is required");
  }

  await ensureWorkspaceAdminAccess(workspaceId, userId);

  await prisma.workspace.delete({
    where: { id: workspaceId },
  });

  return { success: true };
};
