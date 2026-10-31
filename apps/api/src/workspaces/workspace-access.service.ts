import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { WorkspaceRole } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class WorkspaceAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async requireMembership(
    workspaceId: string,
    userId: string,
  ): Promise<{ workspaceId: string; userId: string; role: WorkspaceRole }> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { workspaceId: true, userId: true, role: true },
    });

    if (!membership) {
      throw new NotFoundException("Workspace not found.");
    }

    return membership;
  }

  async requireWorkspaceManager(
    workspaceId: string,
    userId: string,
  ): Promise<{ workspaceId: string; userId: string; role: WorkspaceRole }> {
    const membership = await this.requireMembership(workspaceId, userId);
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      throw new ForbiddenException("Workspace owner or admin permission is required.");
    }

    return membership;
  }
}
