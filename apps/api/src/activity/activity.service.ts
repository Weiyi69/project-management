import { Injectable, NotFoundException } from "@nestjs/common";
import type { WorkspaceActivitySummary } from "@orbit/contracts";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

interface ActivityInput {
  workspaceId: string;
  projectId?: string | null;
  actorId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async record(transaction: Prisma.TransactionClient, input: ActivityInput): Promise<void> {
    await transaction.activityLog.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        actorId: input.actorId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    });
  }

  async listWorkspaceActivity(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceActivitySummary[]> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException("Workspace not found.");

    const records = await this.prisma.activityLog.findMany({
      where: {
        workspaceId,
        entityType: { in: ["TASK", "PROJECT", "MEMBERSHIP"] },
      },
      include: {
        actor: { select: { name: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
    });

    return records.map((record) => {
      const metadata =
        typeof record.metadata === "object" && record.metadata !== null && !Array.isArray(record.metadata)
          ? record.metadata
          : null;
      const metadataName =
        metadata && "name" in metadata && typeof metadata.name === "string"
          ? metadata.name
          : metadata && "title" in metadata && typeof metadata.title === "string"
            ? metadata.title
            : metadata && "memberName" in metadata && typeof metadata.memberName === "string"
              ? metadata.memberName
              : null;

      return {
        id: record.id,
        actorName: record.actor?.name ?? null,
        action: record.action,
        entityType: record.entityType,
        entityId: record.entityId,
        entityName: metadataName ?? record.project?.name ?? "Workspace activity",
        project: record.project,
        createdAt: record.createdAt.toISOString(),
      };
    });
  }
}
