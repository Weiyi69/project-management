import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import * as argon2 from "argon2";
import sharp from "sharp";
import type {
  AccountProfile,
  NotificationPreferenceType,
  NotificationPreferencesResponse,
} from "@orbit/contracts";
import { Prisma } from "../generated/prisma/client";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { RateLimitService } from "../rate-limits/rate-limit.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { createOtp, hashOtp, normalizeEmail } from "../auth/auth-crypto";
import { hashSessionToken } from "../auth/auth-session";
import type {
  ChangePasswordDto,
  NotificationPreferenceDto,
  UpdateProfileDto,
} from "./account.dto";

const EMAIL_CHANGE_LIFETIME_MS = 10 * 60 * 1000;
const EMAIL_CHANGE_COOLDOWN_MS = 60 * 1000;
const EMAIL_CHANGE_MAX_ATTEMPTS = 5;
const PHOTO_PATH = "/api/v1/account/profile-photo";
const NOTIFICATION_TYPES: NotificationPreferenceType[] = [
  "TASK_ASSIGNED",
  "TASK_MENTIONED",
  "COMMENT_ADDED",
  "DUE_DATE_REMINDER",
  "PROJECT_UPDATED",
  "INVITATION_RECEIVED",
];

function matchesCode(userId: string, code: string, storedHash: string): boolean {
  const actual = Buffer.from(hashOtp(userId, "EMAIL_CHANGE", code), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return (
    actual.length === expected.length &&
    actual.length === 32 &&
    timingSafeEqual(actual, expected)
  );
}

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly rateLimits: RateLimitService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async getProfile(userId: string): Promise<AccountProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        pendingEmail: true,
        emailVerifiedAt: true,
        createdAt: true,
        avatarUrl: true,
      },
    });
    if (!user) throw new NotFoundException("Account not found.");
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      pendingEmail: user.pendingEmail,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      hasProfilePhoto: user.avatarUrl === PHOTO_PATH,
    };
  }

  async updateProfile(userId: string, input: UpdateProfileDto): Promise<{ name: string }> {
    const name = input.name.trim();
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { name },
      select: { name: true },
    });
    return user;
  }

  async uploadProfilePhoto(userId: string, input: Buffer | undefined): Promise<{ hasProfilePhoto: true }> {
    if (!input?.length) throw new BadRequestException("Choose a profile photo to upload.");
    if (input.length > 5 * 1024 * 1024) {
      throw new BadRequestException("Profile photos must be 5 MB or smaller.");
    }

    let optimized: Buffer;
    try {
      const image = sharp(input, { failOn: "error", limitInputPixels: 25_000_000 });
      const metadata = await image.metadata();
      if (
        !metadata.format ||
        !["jpeg", "png", "webp"].includes(metadata.format) ||
        !metadata.width ||
        !metadata.height
      ) {
        throw new BadRequestException("Use a valid JPEG, PNG, or WebP image.");
      }
      optimized = await image
        .rotate()
        .resize(512, 512, { fit: "cover", position: "centre" })
        .webp({ quality: 82 })
        .toBuffer();
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException("The selected file is not a valid supported image.");
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { profilePhotoBytes: new Uint8Array(optimized), avatarUrl: PHOTO_PATH },
    });
    return { hasProfilePhoto: true };
  }

  async getProfilePhoto(userId: string): Promise<Uint8Array | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profilePhotoBytes: true },
    });
    return user?.profilePhotoBytes ?? null;
  }

  async removeProfilePhoto(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { profilePhotoBytes: null, avatarUrl: null },
    });
  }

  async requestEmailChange(userId: string, emailInput: string): Promise<{ verificationRequired: true }> {
    const email = normalizeEmail(emailInput);
    if (!email || email.length > 254) throw new BadRequestException("Enter a valid email address.");
    await this.rateLimits.enforce("account-email-change-user", userId, 5, 60 * 60 * 1000);
    await this.rateLimits.enforce("account-email-change-address", email, 5, 60 * 60 * 1000);

    let issued: { code: string; expiresAt: Date };
    try {
      issued = await this.prisma.$transaction(async (transaction) => {
      await this.lockUser(transaction, userId);
      const user = await transaction.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!user) throw new NotFoundException("Account not found.");
      if (email === normalizeEmail(user.email)) {
        throw new BadRequestException("That is already your current email address.");
      }
      const existing = await transaction.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" }, id: { not: userId } },
        select: { id: true },
      });
      const pending = await transaction.user.findFirst({
        where: { pendingEmail: { equals: email, mode: "insensitive" }, id: { not: userId } },
        select: { id: true },
      });
      if (existing || pending) throw new ConflictException("That email address is already in use.");

      const now = new Date();
      const latest = await transaction.authCode.findFirst({
        where: { userId, purpose: "EMAIL_CHANGE" },
        orderBy: { createdAt: "desc" },
      });
      if (latest && now.getTime() - latest.createdAt.getTime() < EMAIL_CHANGE_COOLDOWN_MS) {
        throw new ConflictException("Please wait before requesting another verification code.");
      }
      await transaction.authCode.updateMany({
        where: { userId, purpose: "EMAIL_CHANGE", consumedAt: null },
        data: { consumedAt: now },
      });
      const code = createOtp();
      const expiresAt = new Date(now.getTime() + EMAIL_CHANGE_LIFETIME_MS);
      await transaction.user.update({ where: { id: userId }, data: { pendingEmail: email } });
      await transaction.authCode.create({
        data: {
          userId,
          purpose: "EMAIL_CHANGE",
          codeHash: hashOtp(userId, "EMAIL_CHANGE", code),
          expiresAt,
        },
      });
        return { code, expiresAt };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("That email address is already in use.");
      }
      throw error;
    }

    try {
      await this.email.sendAuthenticationCode({
        email,
        code: issued.code,
        purpose: "email-change",
        expiresAt: issued.expiresAt,
      });
    } catch (error) {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.user.updateMany({ where: { id: userId, pendingEmail: email }, data: { pendingEmail: null } });
        await transaction.authCode.updateMany({
          where: { userId, purpose: "EMAIL_CHANGE", consumedAt: null },
          data: { consumedAt: new Date() },
        });
      });
      if (error instanceof ServiceUnavailableException) throw error;
      throw error;
    }
    return { verificationRequired: true };
  }

  async confirmEmailChange(userId: string, code: string, currentToken: string | undefined): Promise<void> {
    const currentTokenHash = currentToken ? hashSessionToken(currentToken) : "";
    const revokedSessionIds = await this.prisma.$transaction(async (transaction) => {
      await this.lockUser(transaction, userId);
      const user = await transaction.user.findUnique({
        where: { id: userId },
        select: { pendingEmail: true },
      });
      const latest = await transaction.authCode.findFirst({
        where: { userId, purpose: "EMAIL_CHANGE", consumedAt: null },
        orderBy: { createdAt: "desc" },
      });
      if (
        !user?.pendingEmail ||
        !latest ||
        latest.expiresAt <= new Date() ||
        latest.attempts >= EMAIL_CHANGE_MAX_ATTEMPTS
      ) {
        return null;
      }
      if (!matchesCode(userId, code, latest.codeHash)) {
        const attempts = latest.attempts + 1;
        await transaction.authCode.update({
          where: { id: latest.id },
          data: { attempts, ...(attempts >= EMAIL_CHANGE_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) },
        });
        return null;
      }
      const duplicate = await transaction.user.findFirst({
        where: { email: { equals: user.pendingEmail, mode: "insensitive" }, id: { not: userId } },
        select: { id: true },
      });
      if (duplicate) throw new ConflictException("That email address is already in use.");

      const now = new Date();
      await transaction.user.update({
        where: { id: userId },
        data: { email: user.pendingEmail, pendingEmail: null, emailVerifiedAt: now },
      });
      await transaction.authCode.update({ where: { id: latest.id }, data: { consumedAt: now } });
      const sessions = await transaction.refreshSession.findMany({
        where: {
          userId,
          revokedAt: null,
          expiresAt: { gt: now },
          ...(currentTokenHash ? { tokenHash: { not: currentTokenHash } } : {}),
        },
        select: { id: true },
      });
      await transaction.refreshSession.updateMany({
        where: {
          userId,
          revokedAt: null,
          expiresAt: { gt: now },
          ...(currentTokenHash ? { tokenHash: { not: currentTokenHash } } : {}),
        },
        data: { revokedAt: now },
      });
      return sessions.map(({ id }) => id);
    });
    if (!revokedSessionIds) {
      throw new BadRequestException("The verification code is invalid or expired.");
    }
    await Promise.all(revokedSessionIds.map((id) => this.realtime.revokeSession(userId, id)));
  }

  async cancelEmailChange(userId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await this.lockUser(transaction, userId);
      await transaction.user.update({ where: { id: userId }, data: { pendingEmail: null } });
      await transaction.authCode.updateMany({
        where: { userId, purpose: "EMAIL_CHANGE", consumedAt: null },
        data: { consumedAt: now },
      });
    });
  }

  async getNotificationPreferences(userId: string): Promise<NotificationPreferencesResponse> {
    const saved = await this.prisma.notificationPreference.findMany({
      where: { userId },
      select: { type: true, inApp: true, email: true },
    });
    const byType = new Map(saved.map((preference) => [preference.type, preference]));
    return {
      preferences: NOTIFICATION_TYPES.map((type) => ({
        type,
        inApp: byType.get(type)?.inApp ?? true,
        email: byType.get(type)?.email ?? type === "INVITATION_RECEIVED",
      })),
    };
  }

  async updateNotificationPreferences(
    userId: string,
    preferences: NotificationPreferenceDto[],
  ): Promise<NotificationPreferencesResponse> {
    if (
      preferences.length !== NOTIFICATION_TYPES.length ||
      new Set(preferences.map(({ type }) => type)).size !== NOTIFICATION_TYPES.length ||
      !NOTIFICATION_TYPES.every((type) => preferences.some((preference) => preference.type === type))
    ) {
      throw new BadRequestException("Provide one preference for every notification type.");
    }
    await this.prisma.$transaction(async (transaction) => {
      for (const preference of preferences) {
        await transaction.notificationPreference.upsert({
          where: { userId_type: { userId, type: preference.type } },
          create: {
            userId,
            type: preference.type,
            inApp: preference.inApp,
            email: preference.email,
          },
          update: { inApp: preference.inApp, email: preference.email },
        });
      }
    });
    return this.getNotificationPreferences(userId);
  }

  async changePassword(
    userId: string,
    input: ChangePasswordDto,
    currentToken: string | undefined,
  ): Promise<void> {
    if (!currentToken) throw new UnauthorizedException("Your session has expired. Please sign in again.");
    await this.rateLimits.enforce("account-password-change-user", userId, 10, 60 * 60 * 1000);
    const tokenHash = hashSessionToken(currentToken);
    const revokedSessionIds = await this.prisma.$transaction(async (transaction) => {
      await this.lockUser(transaction, userId);
      const user = await transaction.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true },
      });
      if (!user) throw new NotFoundException("Account not found.");
      if (!(await argon2.verify(user.passwordHash, input.currentPassword))) {
        throw new UnauthorizedException("The current password is incorrect.");
      }
      const passwordHash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
      const now = new Date();
      await transaction.user.update({ where: { id: userId }, data: { passwordHash } });
      const sessions = await transaction.refreshSession.findMany({
        where: {
          userId,
          revokedAt: null,
          expiresAt: { gt: now },
          tokenHash: { not: tokenHash },
        },
        select: { id: true },
      });
      await transaction.refreshSession.updateMany({
        where: {
          userId,
          revokedAt: null,
          expiresAt: { gt: now },
          tokenHash: { not: tokenHash },
        },
        data: { revokedAt: now },
      });
      return sessions.map(({ id }) => id);
    });
    await Promise.all(revokedSessionIds.map((id) => this.realtime.revokeSession(userId, id)));
  }

  async listSessions(userId: string, currentToken: string | undefined) {
    const currentTokenHash = currentToken ? hashSessionToken(currentToken) : "";
    const sessions = await this.prisma.refreshSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, expiresAt: true, tokenHash: true },
    });
    return {
      sessions: sessions.map(({ id, createdAt, expiresAt, tokenHash }) => ({
        id,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        current: tokenHash === currentTokenHash,
      })),
    };
  }

  async revokeSession(userId: string, sessionId: string, currentToken: string | undefined) {
    const now = new Date();
    const session = await this.prisma.refreshSession.findFirst({
      where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true, tokenHash: true },
    });
    if (!session) throw new NotFoundException("Session not found.");
    await this.prisma.refreshSession.updateMany({
      where: { id: session.id, userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await this.realtime.revokeSession(userId, session.id);
    return {
      revoked: true as const,
      current: Boolean(currentToken && session.tokenHash === hashSessionToken(currentToken)),
    };
  }

  async revokeOtherSessions(userId: string, currentToken: string | undefined): Promise<void> {
    if (!currentToken) throw new UnauthorizedException("Your session has expired. Please sign in again.");
    const tokenHash = hashSessionToken(currentToken);
    const now = new Date();
    const sessionIds = await this.prisma.$transaction(async (transaction) => {
      const sessions = await transaction.refreshSession.findMany({
        where: {
          userId,
          revokedAt: null,
          expiresAt: { gt: now },
          tokenHash: { not: tokenHash },
        },
        select: { id: true },
      });
      await transaction.refreshSession.updateMany({
        where: {
          userId,
          revokedAt: null,
          expiresAt: { gt: now },
          tokenHash: { not: tokenHash },
        },
        data: { revokedAt: now },
      });
      return sessions.map(({ id }) => id);
    });
    await Promise.all(sessionIds.map((id) => this.realtime.revokeSession(userId, id)));
  }

  private async lockUser(transaction: Prisma.TransactionClient, userId: string): Promise<void> {
    await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
  }
}
