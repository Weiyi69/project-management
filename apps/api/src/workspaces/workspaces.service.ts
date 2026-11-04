import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type {
  InvitationSummary,
  PendingWorkspaceInvitation,
  WorkspaceMemberSummary,
  WorkspaceSummary,
} from "@orbit/contracts";
import { ActivityService } from "../activity/activity.service";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NotificationsService } from "../notifications/notifications.service";
import { EmailService } from "./email.service";
import { WorkspaceAccessService } from "./workspace-access.service";

const INVITATION_VALID_DAYS = 7;

function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly email: EmailService,
    private readonly realtime: RealtimeGateway,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(userId: string): Promise<WorkspaceSummary[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      orderBy: { joinedAt: "asc" },
      include: { workspace: true },
    });

    return memberships.map(({ workspace, role }) => ({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      role,
    }));
  }

  async create(userId: string, name: string): Promise<WorkspaceSummary> {
    const normalizedName = name.trim();
    const slug = `${this.slugify(normalizedName)}-${randomBytes(8).toString("hex")}`;
    const workspace = await this.prisma.workspace.create({
      data: {
        name: normalizedName,
        slug,
        ownerId: userId,
        members: { create: { userId, role: "OWNER" } },
      },
    });

    return { id: workspace.id, name: workspace.name, slug: workspace.slug, role: "OWNER" };
  }

  async get(workspaceId: string, userId: string): Promise<WorkspaceSummary> {
    const membership = await this.access.requireMembership(workspaceId, userId);
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });

    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      role: membership.role,
    };
  }

  async update(workspaceId: string, userId: string, name: string): Promise<WorkspaceSummary> {
    const membership = await this.access.requireWorkspaceManager(workspaceId, userId);
    if (membership.role !== "OWNER") {
      throw new ForbiddenException("Only a workspace owner can rename the workspace.");
    }

    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: name.trim() },
    });

    return { id: workspace.id, name: workspace.name, slug: workspace.slug, role: membership.role };
  }

  async delete(workspaceId: string, userId: string): Promise<void> {
    const membership = await this.access.requireMembership(workspaceId, userId);
    if (membership.role !== "OWNER") {
      throw new ForbiddenException("Only the workspace owner can delete the workspace.");
    }

    await this.prisma.$transaction(
      async (transaction) => {
        const projectCount = await transaction.project.count({ where: { workspaceId } });
        if (projectCount > 0) {
          throw new ConflictException(
            "Delete or move every project before deleting this workspace. Workspace deletion never removes project data.",
          );
        }

        await transaction.workspace.delete({ where: { id: workspaceId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listMembers(workspaceId: string, userId: string): Promise<WorkspaceMemberSummary[]> {
    await this.access.requireMembership(workspaceId, userId);
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    return memberships.map((membership) => ({
      userId: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      role: membership.role,
      joinedAt: membership.joinedAt.toISOString(),
    }));
  }

  async updateMemberRole(
    workspaceId: string,
    actorId: string,
    targetUserId: string,
    role: "ADMIN" | "MEMBER",
  ): Promise<WorkspaceMemberSummary> {
    const actor = await this.access.requireWorkspaceManager(workspaceId, actorId);
    const target = await this.access.requireMembership(workspaceId, targetUserId);
    if (target.role === "OWNER") {
      throw new ConflictException("The workspace owner role cannot be changed.");
    }
    if (actor.role !== "OWNER" && (role === "ADMIN" || target.role === "ADMIN")) {
      throw new ForbiddenException("Only the workspace owner can manage admin roles.");
    }
    if (target.role === role) {
      const current = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      if (!current) throw new NotFoundException("Workspace member not found.");
      return {
        userId: current.user.id,
        name: current.user.name,
        email: current.user.email,
        role: current.role,
        joinedAt: current.joinedAt.toISOString(),
      };
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const membership = await transaction.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
        data: { role },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      await this.activity.record(transaction, {
        workspaceId,
        actorId,
        entityType: "MEMBERSHIP",
        entityId: targetUserId,
        action: "WORKSPACE_MEMBER_ROLE_CHANGED",
        metadata: {
          memberName: membership.user.name,
          fromRole: target.role,
          toRole: role,
        },
      });
      return membership;
    });

    return {
      userId: updated.user.id,
      name: updated.user.name,
      email: updated.user.email,
      role: updated.role,
      joinedAt: updated.joinedAt.toISOString(),
    };
  }

  async removeMember(workspaceId: string, actorId: string, targetUserId: string): Promise<void> {
    const actor = await this.access.requireWorkspaceManager(workspaceId, actorId);
    const target = await this.access.requireMembership(workspaceId, targetUserId);
    if (target.role === "OWNER") {
      throw new ConflictException("The workspace owner cannot be removed.");
    }
    if (actor.role !== "OWNER" && target.role !== "MEMBER" && targetUserId !== actorId) {
      throw new ForbiddenException("Only the workspace owner can remove another admin.");
    }

    await this.prisma.$transaction(async (transaction) => {
      const target = await transaction.user.findUniqueOrThrow({
        where: { id: targetUserId },
        select: { name: true },
      });
      await transaction.workspaceMember.delete({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      });
      await this.activity.record(transaction, {
        workspaceId,
        actorId,
        entityType: "MEMBERSHIP",
        entityId: targetUserId,
        action: "WORKSPACE_MEMBER_REMOVED",
        metadata: { memberName: target.name },
      });
    });
    await this.realtime.revokeWorkspaceAccess(workspaceId, targetUserId);
  }

  async listInvitations(
    workspaceId: string,
    userId: string,
  ): Promise<InvitationSummary[]> {
    await this.access.requireWorkspaceManager(workspaceId, userId);
    const invitations = await this.prisma.workspaceInvitation.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: { inviter: { select: { name: true } } },
    });

    return this.filterSupportedInvitations(invitations).map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      inviterName: invitation.inviter.name,
      expiresAt: invitation.expiresAt.toISOString(),
      acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
      expired: invitation.acceptedAt === null && invitation.expiresAt <= new Date(),
    }));
  }

  async revokeInvitation(workspaceId: string, userId: string, invitationId: string): Promise<void> {
    await this.access.requireWorkspaceManager(workspaceId, userId);
    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: { id: invitationId, workspaceId },
      select: { id: true, acceptedAt: true },
    });
    if (!invitation) {
      throw new NotFoundException("Invitation not found.");
    }
    if (invitation.acceptedAt) {
      throw new ConflictException("An accepted invitation cannot be revoked.");
    }

    await this.prisma.workspaceInvitation.delete({ where: { id: invitation.id } });
  }

  async createInvitation(
    workspaceId: string,
    actorId: string,
    input: { email: string; role: "ADMIN" | "MEMBER" },
  ): Promise<InvitationSummary> {
    const actor = await this.access.requireWorkspaceManager(workspaceId, actorId);
    if (input.role === "ADMIN" && actor.role !== "OWNER") {
      throw new ForbiddenException("Only the workspace owner can invite an admin.");
    }
    if (!isSupportedInvitationRole(input.role)) {
      this.logger.warn("Rejected workspace invitation creation with an unsupported role.");
      throw new BadRequestException("Workspace invitations support only admin or member roles.");
    }

    const email = input.email.trim().toLowerCase();
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });
    const inviter = await this.prisma.user.findUniqueOrThrow({ where: { id: actorId } });
    const existingUser = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (
      existingUser &&
      (await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: existingUser.id } },
      }))
    ) {
      throw new ConflictException("This person is already a workspace member.");
    }

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = hashInvitationToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITATION_VALID_DAYS * 24 * 60 * 60 * 1000);
    let invitation: {
      id: string;
      email: string;
      role: "ADMIN" | "MEMBER" | "OWNER";
      expiresAt: Date;
      acceptedAt: Date | null;
    };

    try {
      const existing = await this.prisma.workspaceInvitation.findUnique({
        where: { workspaceId_email: { workspaceId, email } },
      });
      invitation = await this.prisma.workspaceInvitation.upsert({
        where: { workspaceId_email: { workspaceId, email } },
        create: {
          workspaceId,
          email,
          role: input.role,
          tokenHash,
          invitedBy: actorId,
          expiresAt,
          acceptedAt: null,
        },
        update: {
          role: input.role,
          tokenHash,
          invitedBy: actorId,
          expiresAt,
          acceptedAt: null,
        },
      });
      this.assertSupportedInvitationRole(invitation.role);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("An invitation already exists for this email.");
      }
      throw error;
    }

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
    const invitationUrl = new URL("/invitations/accept", frontendUrl);
    invitationUrl.searchParams.set("token", rawToken);

    const invitationPreference = existingUser
      ? await this.prisma.notificationPreference.findUnique({
          where: {
            userId_type: {
              userId: existingUser.id,
              type: "INVITATION_RECEIVED",
            },
          },
          select: { email: true },
        })
      : null;
    const sendInvitationEmail = !existingUser || (invitationPreference?.email ?? true);
    try {
      if (sendInvitationEmail) {
        await this.email.sendWorkspaceInvitation({
          email,
          inviterName: inviter.name,
          workspaceName: workspace.name,
          role: input.role,
          invitationUrl: invitationUrl.toString(),
          expiresAt,
        });
      }
    } catch (error) {
      try {
        await this.prisma.workspaceInvitation.deleteMany({
          where: { id: invitation.id, tokenHash },
        });
      } catch (cleanupError) {
        this.logger.error(
          "Could not remove invitation after email delivery failed.",
          cleanupError instanceof Error ? cleanupError.stack : undefined,
        );
        throw new ServiceUnavailableException(
          "Invitation email failed and its pending invitation could not be removed. Contact support before retrying.",
        );
      }

      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException("The invitation could not be emailed.");
    }

    if (existingUser) {
      await this.notifications.notifyWorkspaceInvitation({
        actorId,
        recipientId: existingUser.id,
        invitationId: invitation.id,
        workspaceId,
        workspaceName: workspace.name,
      });
    }

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      inviterName: inviter.name,
      expiresAt: invitation.expiresAt.toISOString(),
      acceptedAt: null,
      expired: false,
    };
  }

  async previewInvitation(token: string): Promise<{
    email: string;
    role: "ADMIN" | "MEMBER";
    workspaceName: string;
    expiresAt: string;
    accepted: boolean;
  }> {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
      include: { workspace: { select: { name: true } } },
    });

    if (!invitation || invitation.expiresAt <= new Date()) {
      throw new NotFoundException("This invitation is invalid or has expired.");
    }
    this.assertSupportedInvitationRole(invitation.role);

    return {
      email: invitation.email,
      role: invitation.role,
      workspaceName: invitation.workspace.name,
      expiresAt: invitation.expiresAt.toISOString(),
      accepted: invitation.acceptedAt !== null,
    };
  }

  async acceptInvitation(userId: string, token: string): Promise<WorkspaceSummary> {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
      include: { workspace: true },
    });
    if (!invitation || invitation.expiresAt <= new Date()) {
      throw new NotFoundException("This invitation is invalid or has expired.");
    }
    this.assertSupportedInvitationRole(invitation.role);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException("Verify your email address before accepting an invitation.");
    }
    if (normalizeEmail(user.email) !== normalizeEmail(invitation.email)) {
      throw new ForbiddenException(`Sign in with ${invitation.email} to accept this invitation.`);
    }
    if (invitation.acceptedAt) {
      const existingMembership = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
      });
      if (existingMembership) {
        return {
          id: invitation.workspace.id,
          name: invitation.workspace.name,
          slug: invitation.workspace.slug,
          role: existingMembership.role,
        };
      }
      throw new ConflictException("This invitation has already been accepted.");
    }

    const membership = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.workspaceInvitation.updateMany({
        where: {
          id: invitation.id,
          tokenHash: hashInvitationToken(token),
          role: invitation.role,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new ConflictException("This invitation is no longer available.");
      }

      const joined = await transaction.workspaceMember.upsert({
        where: {
          workspaceId_userId: { workspaceId: invitation.workspaceId, userId },
        },
        create: {
          workspaceId: invitation.workspaceId,
          userId,
          role: invitation.role,
        },
        update: {},
      });
      await this.activity.record(transaction, {
        workspaceId: invitation.workspaceId,
        actorId: userId,
        entityType: "MEMBERSHIP",
        entityId: userId,
        action: "WORKSPACE_MEMBER_JOINED",
        metadata: { memberName: user.name, role: joined.role },
      });

      return joined;
    });

    return {
      id: invitation.workspace.id,
      name: invitation.workspace.name,
      slug: invitation.workspace.slug,
      role: membership.role,
    };
  }

  async listPendingInvitations(userId: string): Promise<PendingWorkspaceInvitation[]> {
    const user = await this.requireVerifiedUser(userId);
    const invitations = await this.prisma.workspaceInvitation.findMany({
      where: {
        email: normalizeEmail(user.email),
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        workspace: { select: { id: true, name: true } },
        inviter: { select: { name: true } },
      },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }],
    });

    return this.filterSupportedInvitations(invitations).map((invitation) => ({
      id: invitation.id,
      workspaceId: invitation.workspace.id,
      workspaceName: invitation.workspace.name,
      inviterName: invitation.inviter.name,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
    }));
  }

  async acceptPendingInvitation(userId: string, invitationId: string): Promise<WorkspaceSummary> {
    const user = await this.requireVerifiedUser(userId);
    const email = normalizeEmail(user.email);
    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: { id: invitationId, email, acceptedAt: null, expiresAt: { gt: new Date() } },
      include: { workspace: true },
    });
    if (!invitation) {
      throw new NotFoundException("Invitation not found or no longer available.");
    }
    this.assertSupportedInvitationRole(invitation.role);

    const membership = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.workspaceInvitation.updateMany({
        where: {
          id: invitation.id,
          email,
          role: invitation.role,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new ConflictException("This invitation is no longer available.");
      }

      const joined = await transaction.workspaceMember.upsert({
        where: {
          workspaceId_userId: { workspaceId: invitation.workspaceId, userId },
        },
        create: {
          workspaceId: invitation.workspaceId,
          userId,
          role: invitation.role,
        },
        update: {},
      });
      await this.activity.record(transaction, {
        workspaceId: invitation.workspaceId,
        actorId: userId,
        entityType: "MEMBERSHIP",
        entityId: userId,
        action: "WORKSPACE_MEMBER_JOINED",
        metadata: { memberName: user.name, role: joined.role },
      });
      return joined;
    });

    return {
      id: invitation.workspace.id,
      name: invitation.workspace.name,
      slug: invitation.workspace.slug,
      role: membership.role,
    };
  }

  async declinePendingInvitation(userId: string, invitationId: string): Promise<void> {
    const user = await this.requireVerifiedUser(userId);
    const email = normalizeEmail(user.email);
    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: {
        id: invitationId,
        email,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { role: true },
    });
    if (!invitation) {
      throw new NotFoundException("Invitation not found or no longer available.");
    }
    this.assertSupportedInvitationRole(invitation.role);

    const result = await this.prisma.workspaceInvitation.deleteMany({
      where: {
        id: invitationId,
        email,
        role: invitation.role,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (result.count !== 1) {
      throw new NotFoundException("Invitation not found or no longer available.");
    }
  }

  private filterSupportedInvitations<T extends { role: string }>(
    invitations: T[],
  ): Array<T & { role: "ADMIN" | "MEMBER" }> {
    const supported = invitations.filter(
      (invitation): invitation is T & { role: "ADMIN" | "MEMBER" } =>
        isSupportedInvitationRole(invitation.role),
    );
    if (supported.length !== invitations.length) {
      this.logger.warn("Filtered workspace invitations with unsupported roles.");
    }
    return supported;
  }

  private assertSupportedInvitationRole(role: string): asserts role is "ADMIN" | "MEMBER" {
    if (isSupportedInvitationRole(role)) return;
    this.logger.warn("Rejected workspace invitation with an unsupported role.");
    throw new ConflictException("This invitation is invalid or unavailable.");
  }

  private async requireVerifiedUser(userId: string): Promise<{ email: string; name: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, emailVerifiedAt: true },
    });
    if (!user) throw new NotFoundException("User not found.");
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException("Verify your email address to manage invitations.");
    }
    return { email: user.email, name: user.name };
  }

  private slugify(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";
  }
}

function isSupportedInvitationRole(role: string): role is "ADMIN" | "MEMBER" {
  return role === "ADMIN" || role === "MEMBER";
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
