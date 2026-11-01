import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { hashRateLimitKey } from "../auth/auth-crypto";

@Injectable()
export class RateLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpired().catch(() => {
        this.logger.error("Could not clean expired authentication rate-limit records.");
      });
    }, 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async enforce(
    scope: string,
    subject: string,
    limit: number,
    windowMs: number,
  ): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + windowMs);
    const key = hashRateLimitKey(scope, subject);
    const rows = await this.prisma.$queryRaw<Array<{ hits: number }>>`
      INSERT INTO "RateLimitBucket" ("key", "hits", "expiresAt")
      VALUES (${key}, 1, ${expiresAt})
      ON CONFLICT ("key") DO UPDATE
      SET
        "hits" = CASE
          WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN 1
          ELSE "RateLimitBucket"."hits" + 1
        END,
        "expiresAt" = CASE
          WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN ${expiresAt}
          ELSE "RateLimitBucket"."expiresAt"
        END
      RETURNING "hits"
    `;

    if ((rows[0]?.hits ?? limit + 1) > limit) {
      throw new HttpException(
        "Too many attempts. Please wait before trying again.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async cleanupExpired(): Promise<number> {
    const now = new Date();
    const [buckets, codes] = await Promise.all([
      this.prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.authCode.deleteMany({ where: { expiresAt: { lt: now } } }),
    ]);
    return buckets.count + codes.count;
  }
}
