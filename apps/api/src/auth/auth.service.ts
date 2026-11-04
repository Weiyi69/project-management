import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes, timingSafeEqual } from "node:crypto";
import * as argon2 from "argon2";
import type { AuthenticatedUser } from "@orbit/contracts";
import { Prisma } from "../generated/prisma/client";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { RateLimitService } from "../rate-limits/rate-limit.service";
import { createOtp, hashOtp, normalizeEmail } from "./auth-crypto";
import { SESSION_DURATION_SECONDS, createSessionToken, hashSessionToken } from "./auth-session";

const OTP_LIFETIME_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

type AuthCodePurpose = "EMAIL_VERIFICATION" | "PASSWORD_RESET" | "EMAIL_CHANGE";
type AuthTransaction = Prisma.TransactionClient;

const userSelect = {
  id: true,
  name: true,
  email: true,
  passwordHash: true,
  emailVerifiedAt: true,
  createdAt: true,
} as const;

const userWithWorkspace = {
  ...userSelect,
  workspaceMemberships: {
    orderBy: { joinedAt: "asc" as const },
    take: 1,
    select: { workspace: { select: { id: true, name: true } } },
  },
} as const;

function matchesOtp(candidate: string, storedHash: string): boolean {
  const candidateHash = Buffer.from(candidate, "hex");
  const expectedHash = Buffer.from(storedHash, "hex");
  return (
    candidateHash.length === expectedHash.length &&
    candidateHash.length === 32 &&
    timingSafeEqual(candidateHash, expectedHash)
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly email: EmailService,
    private readonly rateLimits: RateLimitService,
  ) {}

  async register(input: { name: string; email: string; password: string }): Promise<{
    email: string;
    verificationRequired: true;
    resendCooldownSeconds: number;
  }> {
    const name = input.name.trim();
    const email = normalizeEmail(input.email);
    const existing = await this.findUserByEmail(email);
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

    if (existing?.emailVerifiedAt) {
      return this.registrationResponse(email);
    }

    if (existing) {
      await this.sendVerificationCode(existing.id, email);
      return this.registrationResponse(email);
    }

    const workspaceName = `${name}'s workspace`;
    const workspaceSlug = `${this.slugify(name)}-${randomBytes(8).toString("hex")}`;

    try {
      const { code, expiresAt } = await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: { name, email, passwordHash },
        });
        await transaction.workspace.create({
          data: {
            name: workspaceName,
            slug: workspaceSlug,
            ownerId: user.id,
            members: { create: { userId: user.id, role: "OWNER" } },
          },
        });
        const issued = await this.issueCode(transaction, user.id, "EMAIL_VERIFICATION");
        return issued;
      });

      try {
        await this.email.sendAuthenticationCode({
          email,
          code,
          purpose: "verification",
          expiresAt,
        });
      } catch (error) {
        if (!(error instanceof ServiceUnavailableException)) throw error;
        this.logger.warn("Could not deliver a registration verification email.");
      }
      return this.registrationResponse(email);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.findUserByEmail(email);
        if (winner && !winner.emailVerifiedAt) {
          await this.sendVerificationCode(winner.id, email);
          return this.registrationResponse(email);
        }
        if (winner?.emailVerifiedAt) {
          return this.registrationResponse(email);
        }
        throw new ConflictException("An account with this email already exists.");
      }
      throw error;
    }
  }

  async verifyEmail(input: { email: string; code: string }): Promise<{ verified: true }> {
    const user = await this.findUserByEmail(normalizeEmail(input.email));
    if (!user || user.emailVerifiedAt) {
      throw new BadRequestException("The verification code is invalid or expired.");
    }

    const verified = await this.prisma.$transaction(async (transaction) => {
      await this.lockUser(transaction, user.id);
      const latest = await transaction.authCode.findFirst({
        where: { userId: user.id, purpose: "EMAIL_VERIFICATION", consumedAt: null },
        orderBy: { createdAt: "desc" },
      });
      if (!latest || latest.expiresAt <= new Date() || latest.attempts >= OTP_MAX_ATTEMPTS) {
        return false;
      }

      if (!matchesOtp(hashOtp(user.id, latest.purpose, input.code), latest.codeHash)) {
        const attempts = latest.attempts + 1;
        await transaction.authCode.update({
          where: { id: latest.id },
          data: {
            attempts,
            ...(attempts >= OTP_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}),
          },
        });
        return false;
      }

      const now = new Date();
      await transaction.authCode.update({
        where: { id: latest.id },
        data: { consumedAt: now },
      });
      await transaction.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: now },
      });
      return true;
    });

    if (!verified) {
      throw new BadRequestException("The verification code is invalid or expired.");
    }
    return { verified: true };
  }

  async resendVerification(
    emailInput: string,
  ): Promise<{ message: string; resendCooldownSeconds: number }> {
    const email = normalizeEmail(emailInput);
    const user = await this.findUserByEmail(email);
    if (user && !user.emailVerifiedAt) {
      await this.sendVerificationCode(user.id, email);
    }
    return {
      message: "If your account needs verification, a code has been sent.",
      resendCooldownSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
    };
  }

  async requestPasswordReset(emailInput: string): Promise<{ message: string }> {
    const email = normalizeEmail(emailInput);
    const user = await this.findUserByEmail(email);
    if (user?.emailVerifiedAt) {
      try {
        const issued = await this.prisma.$transaction((transaction) =>
          this.issueCode(transaction, user.id, "PASSWORD_RESET"),
        );
        await this.email.sendAuthenticationCode({
          email,
          code: issued.code,
          purpose: "password-reset",
          expiresAt: issued.expiresAt,
        });
      } catch (error) {
        if (
          !(error instanceof ServiceUnavailableException) &&
          !(error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS)
        ) {
          throw error;
        }
      }
    }
    return { message: "If an account exists for that email, a reset code has been sent." };
  }

  async resetPassword(input: {
    email: string;
    code: string;
    newPassword: string;
  }): Promise<{ reset: true }> {
    const email = normalizeEmail(input.email);
    const user = await this.findUserByEmail(email);
    if (!user || !user.emailVerifiedAt) {
      throw new BadRequestException("The reset code is invalid or expired.");
    }

    const passwordHash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
    const sessionIds = await this.prisma.$transaction(async (transaction) => {
      await this.lockUser(transaction, user.id);
      const latest = await transaction.authCode.findFirst({
        where: { userId: user.id, purpose: "PASSWORD_RESET", consumedAt: null },
        orderBy: { createdAt: "desc" },
      });
      if (!latest || latest.expiresAt <= new Date() || latest.attempts >= OTP_MAX_ATTEMPTS) {
        return null;
      }

      if (!matchesOtp(hashOtp(user.id, latest.purpose, input.code), latest.codeHash)) {
        const attempts = latest.attempts + 1;
        await transaction.authCode.update({
          where: { id: latest.id },
          data: {
            attempts,
            ...(attempts >= OTP_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}),
          },
        });
        return null;
      }

      const now = new Date();
      await transaction.authCode.update({
        where: { id: latest.id },
        data: { consumedAt: now },
      });
      await transaction.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      const sessions = await transaction.refreshSession.findMany({
        where: { userId: user.id, revokedAt: null },
        select: { id: true },
      });
      await transaction.refreshSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      return sessions.map(({ id }) => id);
    });

    if (!sessionIds) {
      throw new BadRequestException("The reset code is invalid or expired.");
    }
    await Promise.all(sessionIds.map((sessionId) => this.realtime.revokeSession(user.id, sessionId)));
    return { reset: true };
  }

  async login(input: { email: string; password: string }): Promise<{
    user: AuthenticatedUser;
    sessionToken: string;
  }> {
    const email = normalizeEmail(input.email);
    const candidate = await this.findUserByEmail(email);
    if (!candidate) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    return this.prisma.$transaction(async (transaction) => {
      await this.lockUser(transaction, candidate.id);
      const user = await transaction.user.findUnique({
        where: { id: candidate.id },
        select: userWithWorkspace,
      });

      if (!user || !(await argon2.verify(user.passwordHash, input.password))) {
        throw new UnauthorizedException("Invalid email or password.");
      }
      if (!user.emailVerifiedAt) {
        throw new ForbiddenException("Verify your email address before signing in.");
      }

      return this.startSession(transaction, {
        id: user.id,
        name: user.name,
        email: user.email,
        workspaceId: user.workspaceMemberships[0]?.workspace.id ?? "",
        workspaceName: user.workspaceMemberships[0]?.workspace.name ?? "Workspace",
      });
    });
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;

    const tokenHash = hashSessionToken(token);
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, revokedAt: true },
    });
    if (!session || session.revokedAt) return;

    await this.prisma.refreshSession.updateMany({
      where: { id: session.id, tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.realtime.revokeSession(session.userId, session.id);
  }

  async enforceRateLimit(
    scope: string,
    subject: string,
    limit: number,
    windowMs: number,
  ): Promise<void> {
    await this.rateLimits.enforce(scope, subject, limit, windowMs);
  }

  private async sendVerificationCode(userId: string, email: string): Promise<boolean> {
    const issued = await this.prisma.$transaction((transaction) =>
      this.issueCode(transaction, userId, "EMAIL_VERIFICATION"),
    );
    try {
      await this.email.sendAuthenticationCode({
        email,
        code: issued.code,
        purpose: "verification",
        expiresAt: issued.expiresAt,
      });
      return true;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) return false;
      throw error;
    }
  }

  private registrationResponse(email: string): {
    email: string;
    verificationRequired: true;
    resendCooldownSeconds: number;
  } {
    return {
      email,
      verificationRequired: true,
      resendCooldownSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
    };
  }

  private async issueCode(
    transaction: AuthTransaction,
    userId: string,
    purpose: AuthCodePurpose,
  ): Promise<{ code: string; expiresAt: Date }> {
    await this.lockUser(transaction, userId);
    const now = new Date();
    const mostRecent = await transaction.authCode.findFirst({
      where: { userId, purpose },
      orderBy: { createdAt: "desc" },
    });
    if (mostRecent && now.getTime() - mostRecent.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw new HttpException(
        "Please wait before requesting another code.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await transaction.authCode.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: now },
    });
    const code = createOtp();
    const expiresAt = new Date(now.getTime() + OTP_LIFETIME_MS);
    await transaction.authCode.create({
      data: {
        userId,
        purpose,
        codeHash: hashOtp(userId, purpose, code),
        expiresAt,
      },
    });
    return { code, expiresAt };
  }

  private async lockUser(transaction: AuthTransaction, userId: string): Promise<void> {
    await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
  }

  private async findUserByEmail(
    email: string,
  ): Promise<Prisma.UserGetPayload<{ select: typeof userSelect }> | null> {
    return this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: userSelect,
    });
  }

  private async startSession(
    transaction: AuthTransaction,
    user: AuthenticatedUser,
  ): Promise<{
    user: AuthenticatedUser;
    sessionToken: string;
  }> {
    const sessionToken = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000);

    await transaction.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(sessionToken),
        expiresAt,
      },
    });
    return { user, sessionToken };
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "workspace";
  }
}
