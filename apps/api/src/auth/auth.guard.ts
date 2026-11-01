import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { getSessionToken, hashSessionToken } from "./auth-session";
import type { AuthenticatedRequest } from "./auth.types";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = getSessionToken(request.headers.cookie);

    if (!token) {
      throw new UnauthorizedException("Sign in to continue.");
    }

    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: {
        user: {
          include: {
            workspaceMemberships: {
              orderBy: { joinedAt: "asc" },
              take: 1,
              include: { workspace: true },
            },
          },
        },
      },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.user.emailVerifiedAt
    ) {
      throw new UnauthorizedException("Your session has expired. Please sign in again.");
    }

    const membership = session.user.workspaceMemberships[0];
    request.user = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      workspaceId: membership?.workspace.id ?? "",
      workspaceName: membership?.workspace.name ?? "Workspace",
    };

    return true;
  }
}
