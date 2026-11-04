import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  NotificationSummary,
  NotificationType,
  NotificationsResponse,
} from "@orbit/contracts";
import type { Prisma } from "../generated/prisma/client";
import { NotificationEmailDeliveryStatus } from "../generated/prisma/enums";
import { randomUUID } from "node:crypto";
import { EmailDeliveryError, EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

export interface CreatedNotification {
  recipientId: string;
  summary: NotificationSummary;
  inAppEnabled: boolean;
  hasEmailDelivery: boolean;
}

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const REMINDER_MISSED_GRACE_MS = 24 * 60 * 60 * 1000;
const MAX_DELIVERY_ATTEMPTS = 5;
const DELIVERY_LEASE_MS = 60 * 1000;
const DELIVERY_LEASE_RENEWAL_MS = 20 * 1000;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly email: EmailService,
  ) {}

  async list(userId: string): Promise<NotificationsResponse> {
    const [records, unreadCount, user] = await Promise.all([
      this.prisma.notification.findMany({
        where: { recipientId: userId, inApp: true },
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      this.prisma.notification.count({
        where: { recipientId: userId, inApp: true, readAt: null },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    ]);

    const taskIds = records
      .filter((record) => record.entityType === "TASK")
      .map((record) => record.entityId);
    const tasks = taskIds.length
      ? await this.prisma.task.findMany({
          where: {
            id: { in: taskIds },
            project: { workspace: { members: { some: { userId } } } },
          },
          select: {
            id: true,
            title: true,
            projectId: true,
            project: { select: { name: true } },
          },
        })
      : [];
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const projectUpdateProjectIds = new Set([
      ...records
        .filter((record) => record.type === "PROJECT_UPDATED" && record.entityType === "PROJECT")
        .map((record) => record.entityId),
      ...records
        .filter((record) => record.type === "PROJECT_UPDATED" && record.entityType === "TASK")
        .map((record) => taskById.get(record.entityId)?.projectId)
        .filter((id): id is string => Boolean(id)),
    ]);
    const authorizedProjectMemberships = projectUpdateProjectIds.size
      ? await this.prisma.projectMember.findMany({
          where: { userId, projectId: { in: [...projectUpdateProjectIds] } },
          select: { projectId: true },
        })
      : [];
    const authorizedProjectIds = new Set(authorizedProjectMemberships.map(({ projectId }) => projectId));
    const visibleRecords = records.filter((record) => {
      if (record.type !== "PROJECT_UPDATED") return true;
      const projectId = record.entityType === "PROJECT"
        ? record.entityId
        : taskById.get(record.entityId)?.projectId;
      return projectId !== undefined && authorizedProjectIds.has(projectId);
    });
    const projectIds = visibleRecords
      .filter((record) => record.entityType === "PROJECT")
      .map((record) => record.entityId);
    const projects = projectIds.length
      ? await this.prisma.project.findMany({
          where: {
            id: { in: projectIds },
            workspace: { members: { some: { userId } } },
            members: { some: { userId } },
          },
          select: { id: true, name: true },
        })
      : [];
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const invitationIds = visibleRecords
      .filter((record) => record.entityType === "WORKSPACE_INVITATION")
      .map((record) => record.entityId);
    const invitations = invitationIds.length && user
      ? await this.prisma.workspaceInvitation.findMany({
          where: {
            id: { in: invitationIds },
            email: user.email,
            acceptedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: {
            id: true,
            workspaceId: true,
            workspace: { select: { name: true } },
          },
        })
      : [];
    const invitationById = new Map(invitations.map((invitation) => [invitation.id, invitation]));

    return {
      notifications: visibleRecords.map((record) => {
        const task = taskById.get(record.entityId);
        const invitation = invitationById.get(record.entityId);
        return {
          id: record.id,
          type: record.type,
          entityType: record.entityType,
          entityId: record.entityId,
          createdAt: record.createdAt.toISOString(),
          readAt: record.readAt?.toISOString() ?? null,
          actor: record.actor,
          task: task
            ? {
                title: task.title,
                projectId: task.projectId,
                projectName: task.project.name,
              }
            : null,
          project: projectById.has(record.entityId)
            ? { id: record.entityId, name: projectById.get(record.entityId)!.name }
            : null,
          workspaceInvitation: invitation
              ? {
                  id: invitation.id,
                  workspaceId: invitation.workspaceId,
                  workspaceName: invitation.workspace.name,
                }
              : null,
        };
      }),
      unreadCount,
    };
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const readAt = new Date();
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId: userId, readAt: null },
      data: { readAt },
    });
    if (result.count > 0) {
      this.realtime.publishNotificationRead(userId, notificationId, readAt.toISOString());
      return;
    }

    const existing = await this.prisma.notification.findFirst({
      where: { id: notificationId, recipientId: userId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Notification not found.");
  }

  async markAllRead(userId: string): Promise<void> {
    const readAt = new Date();
    const result = await this.prisma.notification.updateMany({
      where: { recipientId: userId, readAt: null },
      data: { readAt },
    });
    if (result.count > 0) {
      this.realtime.publishNotificationsReadAll(userId, readAt.toISOString());
    }
  }

  async createTaskAssignment(
    transaction: Prisma.TransactionClient,
    actorId: string,
    taskId: string,
    recipientId: string | null,
  ): Promise<CreatedNotification | undefined> {
    if (!recipientId || recipientId === actorId) return undefined;
    return this.create(transaction, actorId, recipientId, "TASK_ASSIGNED", taskId);
  }

  async createCommentNotifications(
    transaction: Prisma.TransactionClient,
    actorId: string,
    taskId: string,
    body: string,
  ): Promise<CreatedNotification[]> {
    const task = await transaction.task.findUnique({
      where: { id: taskId },
      select: {
        assigneeId: true,
        project: {
          select: {
            workspace: {
              select: { members: { select: { user: { select: { id: true, email: true } } } } },
            },
          },
        },
      },
    });
    if (!task) return [];

    const members = task.project.workspace.members.map(({ user }) => user);
    const mentionedEmails = new Set(
      [...body.matchAll(/@([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi)].map((match) =>
        match[1]!.toLowerCase(),
      ),
    );
    const recipients = members.filter(
      (member) => member.id !== actorId && mentionedEmails.has(member.email.toLowerCase()),
    );

    if (recipients.length > 0) {
      return Promise.all(
        recipients.map((recipient) =>
          this.create(transaction, actorId, recipient.id, "TASK_MENTIONED", taskId),
        ),
      );
    }

    if (task.assigneeId && task.assigneeId !== actorId) {
      return [
        await this.create(transaction, actorId, task.assigneeId, "COMMENT_ADDED", taskId),
      ];
    }
    return [];
  }

  publishCreated(notification: CreatedNotification): void {
    if (notification.inAppEnabled) {
      this.realtime.publishNotification(notification.recipientId, notification.summary);
    }
  }

  async createProjectUpdateNotifications(
    transaction: Prisma.TransactionClient,
    actorId: string,
    entityType: "TASK" | "PROJECT",
    entityId: string,
    eventId: string,
  ): Promise<CreatedNotification[]> {
    const project = await transaction.project.findFirst({
      where: entityType === "PROJECT"
        ? { id: entityId, workspace: { members: { some: { userId: actorId } } } }
        : {
            tasks: { some: { id: entityId } },
            workspace: { members: { some: { userId: actorId } } },
          },
      select: { id: true, workspaceId: true, name: true },
    });
    if (!project) return [];

    const members = await transaction.projectMember.findMany({
      where: {
        projectId: project.id,
        userId: { not: actorId },
        user: { workspaceMemberships: { some: { workspaceId: project.workspaceId } } },
      },
      select: {
        user: { select: { id: true, emailVerifiedAt: true } },
      },
    });
    if (members.length === 0) return [];

    const memberIds = members.map(({ user }) => user.id);
    const preferences = await transaction.notificationPreference.findMany({
      where: { userId: { in: memberIds }, type: "PROJECT_UPDATED" },
      select: { userId: true, inApp: true, email: true },
    });
    const preferenceByUser = new Map(preferences.map((preference) => [preference.userId, preference]));
    const eligible = members.filter(({ user }) => {
      const preference = preferenceByUser.get(user.id);
      return (preference?.inApp ?? true) || Boolean(preference?.email && user.emailVerifiedAt);
    });
    if (eligible.length === 0) return [];

    const task = entityType === "TASK"
      ? await transaction.task.findUniqueOrThrow({
          where: { id: entityId },
          select: { title: true },
        })
      : null;
    const records = await Promise.all(eligible.map(async ({ user }) => {
      const preference = preferenceByUser.get(user.id);
      const inAppEnabled = preference?.inApp ?? true;
      const hasEmailDelivery = Boolean(preference?.email && user.emailVerifiedAt);
      const record = await transaction.notification.create({
        data: {
          recipientId: user.id,
          actorId,
          type: "PROJECT_UPDATED",
          entityType,
          entityId,
          eventKey: `project-update:${eventId}:${user.id}`,
          inApp: inAppEnabled,
          ...(hasEmailDelivery ? { emailDelivery: { create: {} } } : {}),
        },
        include: { actor: { select: { id: true, name: true } } },
      });
      return {
        recipientId: user.id,
        inAppEnabled,
        hasEmailDelivery,
        summary: {
          id: record.id,
          type: record.type,
          entityType: record.entityType,
          entityId: record.entityId,
          createdAt: record.createdAt.toISOString(),
          readAt: null,
          actor: record.actor,
          task: entityType === "TASK"
            ? {
                title: task!.title,
                projectId: project.id,
                projectName: project.name,
              }
            : null,
          project: entityType === "PROJECT" ? { id: project.id, name: project.name } : null,
          workspaceInvitation: null,
        },
      } satisfies CreatedNotification;
    }));
    return records;
  }

  async createDueDateReminders(now = new Date()): Promise<number> {
    let cursor: { dueDate: Date; id: string } | undefined;
    let createdCount = 0;
    while (true) {
      const tasks = await this.prisma.task.findMany({
        where: {
          assigneeId: { not: null },
          dueDate: {
            gte: new Date(now.getTime() - REMINDER_MISSED_GRACE_MS),
            lte: new Date(now.getTime() + REMINDER_WINDOW_MS),
          },
          status: { isCompleted: false },
          ...(cursor
            ? {
                OR: [
                  { dueDate: { gt: cursor.dueDate } },
                  { dueDate: cursor.dueDate, id: { gt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        take: 500,
        select: {
          id: true,
          dueDate: true,
          assigneeId: true,
        },
      });
      if (tasks.length === 0) break;
      const candidates = tasks.filter(
        (task): task is typeof task & { dueDate: Date; assigneeId: string } =>
          task.dueDate !== null && task.assigneeId !== null,
      );
      const eventKeys = candidates.map(({ id, assigneeId, dueDate }) =>
        this.dueReminderEventKey(id, assigneeId, dueDate),
      );
      const existing = eventKeys.length
        ? await this.prisma.notification.findMany({
            where: { eventKey: { in: eventKeys } },
            select: { eventKey: true },
          })
        : [];
      const existingKeys = new Set(existing.map(({ eventKey }) => eventKey));

      for (const candidate of candidates) {
        const eventKey = this.dueReminderEventKey(
          candidate.id,
          candidate.assigneeId,
          candidate.dueDate,
        );
        if (existingKeys.has(eventKey)) continue;
        const created = await this.prisma.$transaction(async (transaction) => {
          const task = await transaction.task.findFirst({
            where: {
              id: candidate.id,
              assigneeId: candidate.assigneeId,
              dueDate: candidate.dueDate,
              status: { isCompleted: false },
              project: {
                workspace: { members: { some: { userId: candidate.assigneeId } } },
              },
            },
            select: {
              id: true,
              title: true,
              dueDate: true,
              status: { select: { name: true, isCompleted: true } },
              assignee: { select: { id: true, emailVerifiedAt: true } },
              project: { select: { id: true, name: true } },
            },
          });
          if (
            !task?.dueDate ||
            !task.assignee ||
            task.status.isCompleted ||
            ["cancelled", "canceled"].includes(task.status.name.trim().toLowerCase())
          ) {
            return null;
          }
          const currentEventKey = this.dueReminderEventKey(
            task.id,
            task.assignee.id,
            task.dueDate,
          );
          if (currentEventKey !== eventKey) return null;

          const preference = await transaction.notificationPreference.findUnique({
            where: {
              userId_type: { userId: task.assignee.id, type: "DUE_DATE_REMINDER" },
            },
            select: { inApp: true, email: true },
          });
          const inAppEnabled = preference?.inApp ?? true;
          const hasEmailDelivery = Boolean(preference?.email && task.assignee.emailVerifiedAt);
          if (!inAppEnabled && !hasEmailDelivery) return null;

          const inserted = await transaction.notification.createMany({
            data: [{
              recipientId: task.assignee.id,
              actorId: null,
              type: "DUE_DATE_REMINDER",
              entityType: "TASK",
              entityId: task.id,
              eventKey,
              inApp: inAppEnabled,
            }],
            skipDuplicates: true,
          });
          if (inserted.count === 0) return null;
          const notification = await transaction.notification.findUniqueOrThrow({
            where: { eventKey },
            select: { id: true, type: true, entityType: true, entityId: true, createdAt: true },
          });
          if (hasEmailDelivery) {
            await transaction.notificationEmailDelivery.create({
              data: { notificationId: notification.id },
            });
          }
          return {
            recipientId: task.assignee.id,
            inAppEnabled,
            hasEmailDelivery,
            summary: {
              id: notification.id,
              type: notification.type,
              entityType: notification.entityType,
              entityId: notification.entityId,
              createdAt: notification.createdAt.toISOString(),
              readAt: null,
              actor: null,
              task: {
                title: task.title,
                projectId: task.project.id,
                projectName: task.project.name,
              },
              project: null,
              workspaceInvitation: null,
            },
          } satisfies CreatedNotification;
        });
        if (!created) continue;
        createdCount += 1;
        if (created.inAppEnabled) {
          this.realtime.publishNotification(created.recipientId, created.summary);
        }
      }
      const last = tasks[tasks.length - 1]!;
      if (!last.dueDate) break;
      cursor = { dueDate: last.dueDate, id: last.id };
      if (tasks.length < 500) break;
    }
    return createdCount;
  }

  async invalidateTaskReminders(
    transaction: Prisma.TransactionClient,
    taskId: string,
    validEventKey?: string,
  ): Promise<void> {
    const staleWhere = {
      notification: {
        entityType: "TASK",
        entityId: taskId,
        type: "DUE_DATE_REMINDER" as const,
        ...(validEventKey ? { eventKey: { not: validEventKey } } : {}),
      },
      status: {
        in: [
          NotificationEmailDeliveryStatus.PENDING,
          NotificationEmailDeliveryStatus.PROCESSING,
        ],
      },
    };
    await transaction.notificationEmailDelivery.updateMany({
      where: staleWhere,
      data: { status: "CANCELLED", leaseExpiresAt: null, claimToken: null },
    });
    await transaction.notification.updateMany({
      where: {
        entityType: "TASK",
        entityId: taskId,
        type: "DUE_DATE_REMINDER",
        readAt: null,
        ...(validEventKey ? { eventKey: { not: validEventKey } } : {}),
      },
      data: { readAt: new Date() },
    });
  }

  async processPendingEmailDeliveries(batchSize = 25): Promise<number> {
    await this.prisma.notificationEmailDelivery.updateMany({
      where: {
        status: "PROCESSING",
        leaseExpiresAt: { lte: new Date() },
        attemptCount: { gte: MAX_DELIVERY_ATTEMPTS },
      },
      data: { status: "FAILED", leaseExpiresAt: null, claimToken: null, failureCode: "RETRY_LIMIT" },
    });
    let processedCount = 0;
    while (processedCount < batchSize) {
      const claimToken = randomUUID();
      const claims = await this.prisma.$transaction(async (transaction) =>
        transaction.$queryRaw<Array<{ notificationId: string }>>`
          WITH candidate AS (
            SELECT "notificationId"
            FROM "NotificationEmailDelivery"
            WHERE
              (
                ("status" = 'PENDING' AND "nextAttemptAt" <= NOW())
                OR ("status" = 'PROCESSING' AND "leaseExpiresAt" <= NOW())
              )
              AND "attemptCount" < ${MAX_DELIVERY_ATTEMPTS}
            ORDER BY "nextAttemptAt", "createdAt"
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          UPDATE "NotificationEmailDelivery" AS delivery
          SET
            "status" = 'PROCESSING',
            "attemptCount" = delivery."attemptCount" + 1,
            "attemptedAt" = NOW(),
            "leaseExpiresAt" = NOW() + INTERVAL '60 seconds',
            "claimToken" = ${claimToken}::uuid
          FROM candidate
          WHERE delivery."notificationId" = candidate."notificationId"
          RETURNING delivery."notificationId"
        `,
      );
      const claim = claims[0];
      if (!claim) break;
      await this.deliverClaimedEmail(claim.notificationId, claimToken);
      processedCount += 1;
    }
    return processedCount;
  }

  async notifyWorkspaceInvitation(input: {
    actorId: string;
    recipientId: string;
    invitationId: string;
    workspaceId: string;
    workspaceName: string;
  }): Promise<void> {
    const created = await this.prisma.$transaction(async (transaction) => {
      const preference = await transaction.notificationPreference.findUnique({
        where: {
          userId_type: { userId: input.recipientId, type: "INVITATION_RECEIVED" },
        },
        select: { inApp: true },
      });
      const inAppEnabled = preference?.inApp ?? true;
      const existing = await transaction.notification.findFirst({
        where: {
          recipientId: input.recipientId,
          type: "INVITATION_RECEIVED",
          entityType: "WORKSPACE_INVITATION",
          entityId: input.invitationId,
        },
        select: { id: true },
      });
      const record = existing
        ? await transaction.notification.update({
            where: { id: existing.id },
            data: {
              actorId: input.actorId,
              inApp: inAppEnabled,
              readAt: null,
              createdAt: new Date(),
            },
            include: { actor: { select: { id: true, name: true } } },
          })
        : await transaction.notification.create({
            data: {
              recipientId: input.recipientId,
              actorId: input.actorId,
              type: "INVITATION_RECEIVED",
              entityType: "WORKSPACE_INVITATION",
              entityId: input.invitationId,
              inApp: inAppEnabled,
            },
            include: { actor: { select: { id: true, name: true } } },
          });
      return {
        recipientId: input.recipientId,
        inAppEnabled,
        summary: {
          id: record.id,
          type: record.type,
          entityType: record.entityType,
          entityId: record.entityId,
          createdAt: record.createdAt.toISOString(),
          readAt: record.readAt?.toISOString() ?? null,
          actor: record.actor,
          task: null,
          project: null,
          workspaceInvitation: {
            id: input.invitationId,
            workspaceId: input.workspaceId,
            workspaceName: input.workspaceName,
          },
        },
      };
    });
    if (created.inAppEnabled) {
      this.realtime.publishNotification(created.recipientId, created.summary);
    }
  }

  private async create(
    transaction: Prisma.TransactionClient,
    actorId: string,
    recipientId: string,
    type: NotificationType,
    taskId: string,
  ): Promise<CreatedNotification> {
    const [recipient, preference] = await Promise.all([
      transaction.user.findUnique({
        where: { id: recipientId },
        select: { emailVerifiedAt: true },
      }),
      transaction.notificationPreference.findUnique({
        where: { userId_type: { userId: recipientId, type } },
        select: { inApp: true, email: true },
      }),
    ]);
    const inAppEnabled = preference?.inApp ?? true;
    const hasEmailDelivery = Boolean(preference?.email && recipient?.emailVerifiedAt);
    const record = await transaction.notification.create({
      data: {
        recipientId,
        actorId,
        type,
        entityType: "TASK",
        entityId: taskId,
        inApp: inAppEnabled,
      },
      include: { actor: { select: { id: true, name: true } } },
    });
    if (hasEmailDelivery) {
      await transaction.notificationEmailDelivery.create({
        data: { notificationId: record.id },
      });
    }
    const task = await transaction.task.findUnique({
      where: { id: taskId },
      select: { title: true, projectId: true, project: { select: { name: true } } },
    });

    const summary: NotificationSummary = {
      id: record.id,
      type: record.type,
      entityType: record.entityType,
      entityId: record.entityId,
      createdAt: record.createdAt.toISOString(),
      readAt: record.readAt?.toISOString() ?? null,
      actor: record.actor,
      task: task
        ? {
            title: task.title,
            projectId: task.projectId,
            projectName: task.project.name,
          }
        : null,
      project: null,
      workspaceInvitation: null,
    };
    return { recipientId, summary, inAppEnabled, hasEmailDelivery };
  }

  private async deliverClaimedEmail(notificationId: string, claimToken: string): Promise<void> {
    let attemptCount = 0;
    let leaseLost = false;
    let renewalInFlight = false;
    const renewLease = async (): Promise<void> => {
      if (renewalInFlight || leaseLost) return;
      renewalInFlight = true;
      try {
        const renewed = await this.prisma.notificationEmailDelivery.updateMany({
          where: { notificationId, status: "PROCESSING", claimToken },
          data: { leaseExpiresAt: new Date(Date.now() + DELIVERY_LEASE_MS) },
        });
        if (renewed.count === 0) leaseLost = true;
      } catch (error) {
        this.logger.warn(
          "Could not renew an email delivery lease.",
          error instanceof Error ? error.stack : undefined,
        );
      } finally {
        renewalInFlight = false;
      }
    };
    const renewalTimer = setInterval(() => void renewLease(), DELIVERY_LEASE_RENEWAL_MS);
    renewalTimer.unref();
    try {
      const delivery = await this.prisma.notificationEmailDelivery.findUnique({
        where: { notificationId },
        include: {
          notification: {
            include: {
              recipient: { select: { id: true, email: true, emailVerifiedAt: true } },
              actor: { select: { name: true } },
            },
          },
        },
      });
      if (!delivery || delivery.claimToken !== claimToken) return;
      attemptCount = delivery.attemptCount;
      const { notification } = delivery;
      const preference = await this.prisma.notificationPreference.findUnique({
        where: {
          userId_type: {
            userId: notification.recipient.id,
            type: notification.type,
          },
        },
        select: { email: true },
      });
      if (!preference?.email || !notification.recipient.emailVerifiedAt) {
        await this.prisma.notificationEmailDelivery.updateMany({
          where: { notificationId, status: "PROCESSING", claimToken },
          data: { status: "CANCELLED", leaseExpiresAt: null, claimToken: null },
        });
        return;
      }

      let taskTitle: string | null = null;
      let projectName: string | null = null;
      let dueDate: Date | null = null;
      if (notification.entityType === "TASK") {
        const task = await this.prisma.task.findFirst({
          where: {
            id: notification.entityId,
            project: {
              workspace: {
                members: { some: { userId: notification.recipient.id } },
              },
              ...(notification.type === "PROJECT_UPDATED"
                ? { members: { some: { userId: notification.recipient.id } } }
                : {}),
            },
          },
          select: {
            title: true,
            assigneeId: true,
            dueDate: true,
            status: { select: { name: true, isCompleted: true } },
            project: { select: { name: true } },
          },
        });
        const reminderIsCurrent = notification.type !== "DUE_DATE_REMINDER" ||
          Boolean(
            task?.dueDate &&
            task.assigneeId === notification.recipient.id &&
            !task.status.isCompleted &&
            !["cancelled", "canceled"].includes(task.status.name.trim().toLowerCase()) &&
            notification.eventKey === this.dueReminderEventKey(
              notification.entityId,
              notification.recipient.id,
              task.dueDate,
            ),
          );
        if (!task || !reminderIsCurrent) {
          await this.prisma.notificationEmailDelivery.updateMany({
            where: { notificationId, status: "PROCESSING", claimToken },
            data: { status: "CANCELLED", leaseExpiresAt: null, claimToken: null },
          });
          return;
        }
        taskTitle = task.title;
        projectName = task.project.name;
        dueDate = task.dueDate;
      } else if (notification.entityType === "PROJECT") {
        const project = await this.prisma.project.findFirst({
          where: {
            id: notification.entityId,
            workspace: { members: { some: { userId: notification.recipient.id } } },
            members: { some: { userId: notification.recipient.id } },
          },
          select: { name: true },
        });
        if (!project) {
          await this.prisma.notificationEmailDelivery.updateMany({
            where: { notificationId, status: "PROCESSING", claimToken },
            data: { status: "CANCELLED", leaseExpiresAt: null, claimToken: null },
          });
          return;
        }
        projectName = project.name;
      }
      if (leaseLost) return;
      await this.email.sendNotification({
        email: notification.recipient.email,
        type: notification.type,
        taskTitle,
        projectName,
        actorName: notification.actor?.name ?? null,
        dueDate,
      });
      const completed = await this.prisma.notificationEmailDelivery.updateMany({
        where: { notificationId, status: "PROCESSING", claimToken },
        data: {
          status: "SENT",
          sentAt: new Date(),
          leaseExpiresAt: null,
          claimToken: null,
          failureCode: null,
        },
      });
      if (completed.count === 0) {
        this.logger.warn("Email delivery completed after its lease was lost; its status was not changed.");
      }
    } catch (error) {
      const delivery = await this.prisma.notificationEmailDelivery.findFirst({
        where: { notificationId },
        select: { attemptCount: true, claimToken: true },
      });
      if (!delivery || delivery.claimToken !== claimToken) return;
      attemptCount = delivery.attemptCount;
      const failure = error instanceof EmailDeliveryError
        ? error
        : new EmailDeliveryError("Notification email delivery failed.", true, "DELIVERY_ERROR");
      const retry = failure.retryable && attemptCount < MAX_DELIVERY_ATTEMPTS;
      const backoffMs = Math.min(60_000 * 2 ** Math.max(0, attemptCount - 1), 60 * 60 * 1000);
      await this.prisma.notificationEmailDelivery.updateMany({
        where: { notificationId, status: "PROCESSING", claimToken },
        data: {
          status: retry ? "PENDING" : "FAILED",
          nextAttemptAt: retry ? new Date(Date.now() + backoffMs) : new Date(),
          leaseExpiresAt: null,
          claimToken: null,
          failureCode: failure.failureCode,
        },
      });
      this.logger.warn(`Notification email delivery ${retry ? "will retry" : "failed permanently"} (${failure.failureCode}).`);
    } finally {
      clearInterval(renewalTimer);
    }
  }

  private dueReminderEventKey(taskId: string, recipientId: string, dueDate: Date): string {
    return `due-reminder:${taskId}:${recipientId}:${dueDate.toISOString()}`;
  }

  newEventId(): string {
    return randomUUID();
  }
}
