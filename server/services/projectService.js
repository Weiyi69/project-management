import prisma from "../configs/prisma.js";

const projectRelations = {
  members: {
    include: {
      user: true,
    },
  },
};

const badRequest = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const ensureUserExists = async (userId, actor) => {
  if (!userId) {
    throw badRequest("Team lead is required");
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

export const createProject = async ({
  name,
  description,
  status,
  priority,
  start_date,
  end_date,
  team_members,
  team_lead,
  workspaceId,
  actor,
}) => {
  if (!name || !workspaceId) {
    throw badRequest("Project name and workspace ID are required");
  }

  await ensureUserExists(team_lead, actor);

  const project = await prisma.project.create({
    data: {
      name,
      description,
      status,
      priority,
      start_date: start_date ? new Date(start_date) : null,
      end_date: end_date ? new Date(end_date) : null,
      team_lead,
      workspaceId,
      progress: 0,
    },
  });

  if (team_members?.length) {
    await prisma.projectMember.createMany({
      data: team_members.map((userId) => ({
        projectId: project.id,
        userId,
      })),
      skipDuplicates: true,
    });
  }

  if (team_lead) {
    await prisma.projectMember.createMany({
      data: [
        {
          projectId: project.id,
          userId: team_lead,
        },
      ],
      skipDuplicates: true,
    });
  }

  return prisma.project.findUnique({
    where: { id: project.id },
    include: projectRelations,
  });
};

export const updateProject = async ({
  projectId,
  name,
  description,
  status,
  priority,
  start_date,
  end_date,
  progress,
}) => {
  if (!projectId) {
    throw badRequest("Project ID is required");
  }

  return prisma.project.update({
    where: { id: projectId },
    data: {
      name,
      description,
      status,
      priority,
      start_date: start_date ? new Date(start_date) : undefined,
      end_date: end_date ? new Date(end_date) : undefined,
      progress,
    },
    include: projectRelations,
  });
};

export const addProjectMember = async ({ projectId, email }) => {
  if (!projectId || !email) {
    throw badRequest("Project ID and email are required");
  }

  const existingMember = await prisma.projectMember.findFirst({
    where: {
      projectId,
      userId: email,
    },
  });

  if (existingMember) {
    throw badRequest("Member already exists in project");
  }

  await prisma.projectMember.create({
    data: {
      projectId,
      userId: email,
    },
  });

  return prisma.project.findUnique({
    where: { id: projectId },
    include: projectRelations,
  });
};
