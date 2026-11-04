import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ActivityService } from "../activity/activity.service";
import type {
  ProjectSummary,
  ProjectLifecycle as ProjectLifecycleContract,
} from "@orbit/contracts";
import { ProjectLifecycle } from "../generated/prisma/enums";
import { randomUUID } from "node:crypto";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceAccess: WorkspaceAccessService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
  ) {}

  async listProjects(userId: string, workspaceId?: string): Promise<ProjectSummary[]> {
    if (workspaceId) {
      await this.workspaceAccess.requireMembership(workspaceId, userId);
    }

    const projects = await this.prisma.project.findMany({
      where: {
        workspace: {
          members: { some: { userId } },
          ...(workspaceId ? { id: workspaceId } : {}),
        },
      },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            members: { where: { userId }, select: { role: true } },
          },
        },
        members: { where: { userId }, select: { projectRole: true } },
        statuses: {
          select: { id: true, name: true, color: true, position: true },
          orderBy: { position: "asc" },
        },
        _count: { select: { tasks: true } },
      },
    });

    return projects.map((project) => this.toSummary(project));
  }

  async createProject(
    userId: string,
    input: { name: string; description?: string },
    workspaceId?: string,
  ): Promise<ProjectSummary> {
    const membership = workspaceId
      ? await this.workspaceAccess.requireWorkspaceManager(workspaceId, userId)
      : await this.prisma.workspaceMember.findFirst({
          where: { userId },
          orderBy: { joinedAt: "asc" },
          select: { workspaceId: true, userId: true, role: true },
        });
    if (!membership) {
      throw new NotFoundException("No workspace is available for this account.");
    }
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      throw new ForbiddenException("Workspace owner or admin permission is required to create projects.");
    }

    const project = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.project.create({
        data: {
          workspaceId: membership.workspaceId,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          createdBy: userId,
          members: { create: { userId, projectRole: "ADMIN" } },
          statuses: {
            create: [
              { name: "To do", color: "#94A3B8", position: 0, isDefault: true },
              { name: "In progress", color: "#6366F1", position: 1 },
              { name: "Done", color: "#22C55E", position: 2, isCompleted: true },
            ],
          },
        },
        include: {
          workspace: {
            select: {
              id: true,
              name: true,
              members: { where: { userId }, select: { role: true } },
            },
          },
          members: { where: { userId }, select: { projectRole: true } },
          statuses: {
            select: { id: true, name: true, color: true, position: true },
            orderBy: { position: "asc" },
          },
          _count: { select: { tasks: true } },
        },
      });
      await this.activity.record(transaction, {
        workspaceId: membership.workspaceId,
        projectId: created.id,
        actorId: userId,
        entityType: "PROJECT",
        entityId: created.id,
        action: "PROJECT_CREATED",
        metadata: { name: created.name },
      });
      await this.activity.record(transaction, {
        workspaceId: membership.workspaceId,
        projectId: created.id,
        actorId: userId,
        entityType: "MEMBERSHIP",
        entityId: userId,
        action: "PROJECT_MEMBER_ADDED",
        metadata: { name: created.name },
      });
      return created;
    });

    return this.toSummary(project);
  }

  async getProject(userId: string, projectId: string): Promise<ProjectSummary> {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        workspace: { members: { some: { userId } } },
      },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            members: { where: { userId }, select: { role: true } },
          },
        },
        members: { where: { userId }, select: { projectRole: true } },
        statuses: {
          select: { id: true, name: true, color: true, position: true },
          orderBy: { position: "asc" },
        },
        _count: { select: { tasks: true } },
      },
    });

    if (!project) {
      throw new NotFoundException("Project not found.");
    }

    return this.toSummary(project);
  }

  async updateProject(
    userId: string,
    projectId: string,
    input: {
      name?: string;
      description?: string | null;
      state?: ProjectLifecycleContract;
    },
  ): Promise<ProjectSummary> {
    const accessibleProject = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        workspace: { members: { some: { userId } } },
      },
      select: { id: true, workspaceId: true, name: true, description: true, state: true },
    });
    if (!accessibleProject) {
      throw new NotFoundException("Project not found.");
    }
    await this.requireProjectManager(userId, projectId, accessibleProject.workspaceId);

    const { project, notifications } = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.project.update({
        where: { id: projectId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined
            ? { description: input.description?.trim() || null }
            : {}),
          ...(input.state !== undefined ? { state: ProjectLifecycle[input.state] } : {}),
        },
        include: {
          workspace: {
            select: {
              id: true,
              name: true,
              members: { where: { userId }, select: { role: true } },
            },
          },
          members: { where: { userId }, select: { projectRole: true } },
          statuses: {
            select: { id: true, name: true, color: true, position: true },
            orderBy: { position: "asc" },
          },
          _count: { select: { tasks: true } },
        },
      });
      const changedFields = [
        ...(input.name !== undefined && input.name.trim() !== accessibleProject.name ? ["name"] : []),
        ...(input.description !== undefined &&
        (input.description?.trim() || null) !== accessibleProject.description
          ? ["description"]
          : []),
        ...(input.state !== undefined &&
        ProjectLifecycle[input.state] !== accessibleProject.state
          ? ["state"]
          : []),
      ];
      if (changedFields.length) {
        await this.activity.record(transaction, {
          workspaceId: accessibleProject.workspaceId,
          projectId,
          actorId: userId,
          entityType: "PROJECT",
          entityId: projectId,
          action: "PROJECT_UPDATED",
          metadata: { name: updated.name, changedFields },
        });
      }
      return {
        project: updated,
        notifications: changedFields.length
          ? await this.notifications.createProjectUpdateNotifications(
              transaction,
              userId,
              "PROJECT",
              projectId,
              randomUUID(),
            )
          : [],
      };
    });

    for (const notification of notifications) await this.notifications.publishCreated(notification);
    return this.toSummary(project);
  }

  async deleteProject(userId: string, projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        workspace: { members: { some: { userId } } },
      },
      select: { id: true, workspaceId: true },
    });
    if (!project) {
      throw new NotFoundException("Project not found.");
    }

    await this.requireProjectManager(userId, projectId, project.workspaceId);
    await this.prisma.project.delete({ where: { id: projectId } });
  }

  private async requireProjectManager(
    userId: string,
    projectId: string,
    workspaceId: string,
  ): Promise<void> {
    const membership = await this.workspaceAccess.requireMembership(workspaceId, userId);
    if (membership.role === "OWNER" || membership.role === "ADMIN") {
      return;
    }

    const projectMembership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { projectRole: true },
    });
    if (projectMembership?.projectRole !== "ADMIN") {
      throw new ForbiddenException("Project admin permission is required.");
    }
  }

  private toSummary(project: {
    id: string;
    name: string;
    description: string | null;
    state: ProjectSummary["state"];
    createdAt: Date;
    updatedAt: Date;
    workspace: {
      id: string;
      name: string;
      members: Array<{ role: "OWNER" | "ADMIN" | "MEMBER" }>;
    };
    members: Array<{ projectRole: "ADMIN" | "MEMBER" }>;
    statuses: ProjectSummary["statuses"];
    _count: { tasks: number };
  }): ProjectSummary {
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      state: project.state,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      workspace: { id: project.workspace.id, name: project.workspace.name },
      taskCount: project._count.tasks,
      canManage:
        project.workspace.members.some((member) => member.role === "OWNER" || member.role === "ADMIN") ||
        project.members.some((member) => member.projectRole === "ADMIN"),
      statuses: project.statuses,
    };
  }
}
