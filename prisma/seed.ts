import "dotenv/config";
import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set before seeding the database.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function seed(): Promise<void> {
  const demoUserId = "00000000-0000-4000-8000-000000000001";
  const workspaceId = "00000000-0000-4000-8000-000000000002";
  const projectId = "00000000-0000-4000-8000-000000000003";
  const todoStatusId = "00000000-0000-4000-8000-000000000004";
  const doingStatusId = "00000000-0000-4000-8000-000000000005";
  const doneStatusId = "00000000-0000-4000-8000-000000000006";
  const labelId = "00000000-0000-4000-8000-000000000007";
  const firstTaskId = "00000000-0000-4000-8000-000000000008";

  const user = await prisma.user.upsert({
    where: { email: "demo@orbit.local" },
    update: { name: "Orbit Demo" },
    create: {
      id: demoUserId,
      name: "Orbit Demo",
      email: "demo@orbit.local",
      passwordHash: await argon2.hash(randomBytes(32).toString("base64url")),
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: "orbit-demo" },
    update: { name: "Orbit Demo Workspace", ownerId: user.id },
    create: {
      id: workspaceId,
      name: "Orbit Demo Workspace",
      slug: "orbit-demo",
      ownerId: user.id,
    },
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    update: { role: "OWNER" },
    create: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
  });

  const project = await prisma.project.upsert({
    where: { id: projectId },
    update: { name: "Website Refresh", workspaceId: workspace.id, createdBy: user.id },
    create: {
      id: projectId,
      workspaceId: workspace.id,
      name: "Website Refresh",
      description: "A sample project for validating the ORBIT database foundation.",
      state: "ACTIVE",
      createdBy: user.id,
    },
  });

  const statuses = [
    { id: todoStatusId, name: "TODO", color: "#94A3B8", position: 0, isDefault: true },
    { id: doingStatusId, name: "IN_PROGRESS", color: "#6366F1", position: 1 },
    { id: doneStatusId, name: "DONE", color: "#16A34A", position: 2, isCompleted: true },
  ] as const;

  for (const status of statuses) {
    await prisma.projectStatus.upsert({
      where: { id: status.id },
      update: { ...status, projectId: project.id },
      create: { ...status, projectId: project.id },
    });
  }

  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: project.id, userId: user.id } },
    update: { projectRole: "ADMIN" },
    create: { projectId: project.id, userId: user.id, projectRole: "ADMIN" },
  });

  const label = await prisma.label.upsert({
    where: { id: labelId },
    update: { name: "Design", projectId: project.id },
    create: { id: labelId, projectId: project.id, name: "Design", color: "#8B5CF6" },
  });

  const now = new Date();
  const tasks = [
    {
      id: firstTaskId,
      title: "Plan the new landing page",
      statusId: todoStatusId,
      priority: "HIGH" as const,
      position: 0,
      dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    },
    {
      id: "00000000-0000-4000-8000-000000000009",
      title: "Prepare the visual direction",
      statusId: doingStatusId,
      priority: "MEDIUM" as const,
      position: 0,
    },
    {
      id: "00000000-0000-4000-8000-000000000010",
      title: "Create the project brief",
      statusId: doneStatusId,
      priority: "LOW" as const,
      position: 0,
    },
  ];

  for (const task of tasks) {
    await prisma.task.upsert({
      where: { id: task.id },
      update: {
        title: task.title,
        projectId: project.id,
        statusId: task.statusId,
        priority: task.priority,
        assigneeId: user.id,
        reporterId: user.id,
        position: task.position,
      },
      create: {
        ...task,
        projectId: project.id,
        assigneeId: user.id,
        reporterId: user.id,
      },
    });
  }

  await prisma.taskLabel.upsert({
    where: {
      taskId_labelId: {
        taskId: firstTaskId,
        labelId: label.id,
      },
    },
    update: {},
    create: { taskId: firstTaskId, labelId: label.id },
  });

  console.info("Seeded the Orbit demo workspace and starter project.");
  console.info("Demo user: demo@orbit.local (authentication is not implemented in Stage 1).");
}

seed()
  .catch((error: unknown) => {
    console.error("Database seed failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
