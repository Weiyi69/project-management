import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  NotificationSummary,
  NotificationType,
  NotificationsResponse,
} from "@orbit/contracts";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

export interface CreatedNotification {
  recipientId: string;
  summary: NotificationSummary;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(userId: string): Promise<NotificationsResponse> {
    const [records, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { recipientId: userId },
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      this.prisma.notification.count({ where: { recipientId: userId, readAt: null } }),
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

    return {
      notifications: records.map((record) => {
        const task = taskById.get(record.entityId);
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
    this.realtime.publishNotification(notification.recipientId, notification.summary);
  }

  private async create(
    transaction: Prisma.TransactionClient,
    actorId: string,
    recipientId: string,
    type: NotificationType,
    taskId: string,
  ): Promise<CreatedNotification> {
    const record = await transaction.notification.create({
      data: {
        recipientId,
        actorId,
        type,
        entityType: "TASK",
        entityId: taskId,
      },
      include: { actor: { select: { id: true, name: true } } },
    });
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
    };
    return { recipientId, summary };
  }
}
