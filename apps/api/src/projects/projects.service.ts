import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ActivityService } from "../activity/activity.service";
import type {
  ProjectMembersResponse,
  ProjectMemberSummary,
  ProjectMemberRole as ProjectMemberRoleContract,
  ProjectSummary,
  ProjectLifecycle as ProjectLifecycleContract,
} from "@orbit/contracts";
import { Prisma } from "../generated/prisma/client";
import { ProjectLifecycle, ProjectMemberRole } from "../generated/prisma/enums";
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

  async listProjectMembers(userId: string, projectId: string): Promise<ProjectMembersResponse> {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        workspace: { members: { some: { userId } } },
      },
      select: {
        members: {
          orderBy: { joinedAt: "asc" },
          select: {
            userId: true,
            projectRole: true,
            joinedAt: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        workspace: {
          select: {
            members: {
              orderBy: { user: { name: "asc" } },
              select: { user: { select: { id: true, name: true, email: true } } },
            },
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException("Project not found.");
    }

    const workspaceMemberIds = new Set(project.workspace.members.map(({ user }) => user.id));
    return {
      members: project.members
        .filter((member) => workspaceMemberIds.has(member.userId))
        .map((member) => ({
          userId: member.userId,
          name: member.user.name,
          email: member.user.email,
          projectRole: member.projectRole,
          joinedAt: member.joinedAt.toISOString(),
        })),
      workspaceMembers: project.workspace.members.map(({ user }) => user),
    };
  }

  async addProjectMember(
    actorId: string,
    projectId: string,
    targetUserId: string,
    projectRole: ProjectMemberRoleContract,
  ): Promise<ProjectMemberSummary> {
    const project = await this.requireAccessibleProject(actorId, projectId);

    try {
      return await this.runProjectMembershipTransaction(async (transaction) => {
        await this.requireProjectManagerInTransaction(
          transaction,
          actorId,
          projectId,
          project.workspaceId,
        );
        const workspaceMembership = await transaction.workspaceMember.findUnique({
          where: {
            workspaceId_userId: { workspaceId: project.workspaceId, userId: targetUserId },
          },
          select: { id: true },
        });
        if (!workspaceMembership) {
          throw new NotFoundException("Workspace member not found.");
        }

        const member = await transaction.projectMember.create({
          data: { projectId, userId: targetUserId, projectRole },
          include: { user: { select: { id: true, name: true, email: true } } },
        });
        await this.activity.record(transaction, {
          workspaceId: project.workspaceId,
          projectId,
          actorId,
          entityType: "MEMBERSHIP",
          entityId: targetUserId,
          action: "PROJECT_MEMBER_ADDED",
          metadata: { memberName: member.user.name, projectRole: member.projectRole },
        });

        return this.toProjectMemberSummary(member);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("This user is already a project member.");
      }
      throw error;
    }
  }

  async updateProjectMemberRole(
    actorId: string,
    projectId: string,
    targetUserId: string,
    projectRole: ProjectMemberRoleContract,
  ): Promise<ProjectMemberSummary> {
    const project = await this.requireAccessibleProject(actorId, projectId);

    return this.runProjectMembershipTransaction(async (transaction) => {
      await this.requireProjectManagerInTransaction(
        transaction,
        actorId,
        projectId,
        project.workspaceId,
      );
      const current = await transaction.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: targetUserId } },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      if (!current) {
        throw new NotFoundException("Project member not found.");
      }
      if (current.projectRole === projectRole) {
        return this.toProjectMemberSummary(current);
      }

      if (
        current.projectRole === ProjectMemberRole.ADMIN &&
        projectRole === ProjectMemberRole.MEMBER
      ) {
        await this.requireAnotherProjectAdmin(transaction, projectId, project.workspaceId);
      }

      const updated = await transaction.projectMember.update({
        where: { projectId_userId: { projectId, userId: targetUserId } },
        data: { projectRole },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      await this.activity.record(transaction, {
        workspaceId: project.workspaceId,
        projectId,
        actorId,
        entityType: "MEMBERSHIP",
        entityId: targetUserId,
        action: "PROJECT_MEMBER_ROLE_CHANGED",
        metadata: {
          memberName: updated.user.name,
          fromRole: current.projectRole,
          toRole: updated.projectRole,
        },
      });

      return this.toProjectMemberSummary(updated);
    });
  }

  async removeProjectMember(actorId: string, projectId: string, targetUserId: string): Promise<void> {
    const project = await this.requireAccessibleProject(actorId, projectId);

    await this.runProjectMembershipTransaction(async (transaction) => {
      await this.requireProjectManagerInTransaction(
        transaction,
        actorId,
        projectId,
        project.workspaceId,
      );
      const current = await transaction.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: targetUserId } },
        include: { user: { select: { name: true } } },
      });
      if (!current) {
        throw new NotFoundException("Project member not found.");
      }
      if (current.projectRole === ProjectMemberRole.ADMIN) {
        await this.requireAnotherProjectAdmin(transaction, projectId, project.workspaceId);
      }

      await transaction.projectMember.delete({
        where: { projectId_userId: { projectId, userId: targetUserId } },
      });
      await this.activity.record(transaction, {
        workspaceId: project.workspaceId,
        projectId,
        actorId,
        entityType: "MEMBERSHIP",
        entityId: targetUserId,
        action: "PROJECT_MEMBER_REMOVED",
        metadata: { memberName: current.user.name },
      });
    });
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

  private async requireAccessibleProject(
    userId: string,
    projectId: string,
  ): Promise<{ id: string; workspaceId: string }> {
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
    return project;
  }

  private async requireAnotherProjectAdmin(
    transaction: Prisma.TransactionClient,
    projectId: string,
    workspaceId: string,
  ): Promise<void> {
    const adminCount = await transaction.projectMember.count({
      where: {
        projectId,
        projectRole: ProjectMemberRole.ADMIN,
        user: { workspaceMemberships: { some: { workspaceId } } },
      },
    });
    if (adminCount <= 1) {
      throw new ConflictException("A project must keep at least one project admin.");
    }
  }

  private async requireProjectManagerInTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
    projectId: string,
    workspaceId: string,
  ): Promise<void> {
    const membership = await transaction.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    if (!membership) {
      throw new NotFoundException("Project not found.");
    }
    if (membership.role === "OWNER" || membership.role === "ADMIN") {
      return;
    }

    const projectMembership = await transaction.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { projectRole: true },
    });
    if (projectMembership?.projectRole !== "ADMIN") {
      throw new ForbiddenException("Project admin permission is required.");
    }
  }

  private async runProjectMembershipTransaction<T>(
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException(
          "Project membership changed while you were editing it. Refresh and try again.",
        );
      }
      throw error;
    }
  }

  private toProjectMemberSummary(member: {
    userId: string;
    projectRole: ProjectMemberRole;
    joinedAt: Date;
    user: { id: string; name: string; email: string };
  }): ProjectMemberSummary {
    return {
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      projectRole: member.projectRole,
      joinedAt: member.joinedAt.toISOString(),
    };
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
