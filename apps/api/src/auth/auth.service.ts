import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import type { AuthenticatedUser } from "@orbit/contracts";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SESSION_DURATION_SECONDS, createSessionToken, hashSessionToken } from "./auth-session";

const userWithWorkspace = {
  workspaceMemberships: {
    orderBy: { joinedAt: "asc" as const },
    take: 1,
    include: { workspace: true },
  },
};

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(input: { name: string; email: string; password: string }): Promise<{
    user: AuthenticatedUser;
    sessionToken: string;
  }> {
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const workspaceName = `${name}'s workspace`;
    const workspaceSlug = `${this.slugify(name)}-${randomBytes(8).toString("hex")}`;
    const sessionToken = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000);

    try {
      const user = await this.prisma.$transaction(async (transaction) => {
        const createdUser = await transaction.user.create({
          data: { name, email, passwordHash },
        });
        const workspace = await transaction.workspace.create({
          data: {
            name: workspaceName,
            slug: workspaceSlug,
            ownerId: createdUser.id,
            members: {
              create: { userId: createdUser.id, role: "OWNER" },
            },
          },
        });
        await transaction.refreshSession.create({
          data: {
            userId: createdUser.id,
            tokenHash: hashSessionToken(sessionToken),
            expiresAt,
          },
        });

        return {
          id: createdUser.id,
          name: createdUser.name,
          email: createdUser.email,
          workspaceName: workspace.name,
        };
      });

      return { user, sessionToken };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("An account with this email already exists.");
      }

      throw error;
    }
  }

  async login(input: { email: string; password: string }): Promise<{
    user: AuthenticatedUser;
    sessionToken: string;
  }> {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: userWithWorkspace,
    });

    if (!user || !(await argon2.verify(user.passwordHash, input.password))) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    return this.startSession({
      id: user.id,
      name: user.name,
      email: user.email,
      workspaceName: user.workspaceMemberships[0]?.workspace.name ?? "Workspace",
    });
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) {
      return;
    }

    await this.prisma.refreshSession.updateMany({
      where: { tokenHash: hashSessionToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async startSession(user: AuthenticatedUser): Promise<{
    user: AuthenticatedUser;
    sessionToken: string;
  }> {
    const sessionToken = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000);

    await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(sessionToken),
        expiresAt,
      },
    });

    return {
      user,
      sessionToken,
    };
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "workspace";
  }
}
