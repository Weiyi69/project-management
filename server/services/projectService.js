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

const resolveUserId = async (identifier, fieldName = "User") => {
  if (!identifier) {
    throw badRequest(`${fieldName} is required`);
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { id: identifier },
        { email: identifier },
      ],
    },
  });

  if (!user) {
    throw badRequest(`${fieldName} not found`);
  }

  return user.id;
};

const resolveUserIds = async (identifiers = []) => {
  if (!identifiers.length) {
    return [];
  }

  const resolvedIds = await Promise.all(
    identifiers.map((identifier) => resolveUserId(identifier, "Project member")),
  );

  return [...new Set(resolvedIds)];
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

  let teamLeadId = null;
  if (team_lead) {
    const existingLead = await prisma.user.findFirst({
      where: {
        OR: [
          { id: team_lead },
          { email: team_lead },
        ],
      },
    });

    if (existingLead) {
      teamLeadId = existingLead.id;
    } else {
      await ensureUserExists(team_lead, actor);
      teamLeadId = team_lead;
    }
  }

  const teamMemberIds = await resolveUserIds(team_members ?? []);

  const project = await prisma.project.create({
    data: {
      name,
      description,
      status,
      priority,
      start_date: start_date ? new Date(start_date) : null,
      end_date: end_date ? new Date(end_date) : null,
      team_lead: teamLeadId,
      workspaceId,
      progress: 0,
    },
  });

  if (teamMemberIds.length) {
    await prisma.projectMember.createMany({
      data: teamMemberIds.map((userId) => ({
        projectId: project.id,
        userId,
      })),
      skipDuplicates: true,
    });
  }

  if (teamLeadId) {
    await prisma.projectMember.createMany({
      data: [
        {
          projectId: project.id,
          userId: teamLeadId,
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

export const addProjectMember = async ({ projectId, userId, email }) => {
  if (!projectId || (!userId && !email)) {
    throw badRequest("Project ID and user identifier are required");
  }

  const resolvedUserId = await resolveUserId(userId || email, "Project member");

  const existingMember = await prisma.projectMember.findFirst({
    where: {
      projectId,
      userId: resolvedUserId,
    },
  });

  if (existingMember) {
    throw badRequest("Member already exists in project");
  }

  await prisma.projectMember.create({
    data: {
      projectId,
      userId: resolvedUserId,
    },
  });

  return prisma.project.findUnique({
    where: { id: projectId },
    include: projectRelations,
  });
};
