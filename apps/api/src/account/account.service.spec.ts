import "reflect-metadata";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { test } from "node:test";
import sharp from "sharp";
import type { EmailService } from "../email/email.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { RateLimitService } from "../rate-limits/rate-limit.service";
import type { RealtimeGateway } from "../realtime/realtime.gateway";
import { AccountService } from "./account.service";

function createService(prisma: Partial<PrismaService>): AccountService {
  return new AccountService(
    prisma as PrismaService,
    {} as EmailService,
    {} as RateLimitService,
    {} as RealtimeGateway,
  );
}

test("profile photo uploads validate real JPEG, PNG, and WebP content and store 512px WebP", async () => {
  const stored: Uint8Array[] = [];
  const prisma = {
    user: {
      update: async (args: { data: { profilePhotoBytes: Uint8Array } }) => {
        stored.push(args.data.profilePhotoBytes);
        return {};
      },
    },
  };
  const service = createService(prisma as unknown as Partial<PrismaService>);

  for (const format of ["jpeg", "png", "webp"] as const) {
    const source = await sharp({
      create: { width: 40, height: 24, channels: 3, background: "#6259d9" },
    })
      .toFormat(format)
      .toBuffer();
    await service.uploadProfilePhoto("user-id", source);
  }

  assert.equal(stored.length, 3);
  for (const bytes of stored) {
    const metadata = await sharp(Buffer.from(bytes)).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
  }
});

test("profile photo uploads reject spoofed content and files over five megabytes", async () => {
  let writeCount = 0;
  const service = createService({
    user: {
      update: async () => {
        writeCount += 1;
        return {};
      },
    },
  } as unknown as Partial<PrismaService>);

  await assert.rejects(
    service.uploadProfilePhoto("user-id", Buffer.from("not actually an image")),
    BadRequestException,
  );
  await assert.rejects(
    service.uploadProfilePhoto("user-id", Buffer.alloc(5 * 1024 * 1024 + 1)),
    BadRequestException,
  );
  assert.equal(writeCount, 0);
});

test("profile responses expose account metadata without image bytes", async () => {
  const now = new Date("2026-11-04T00:00:00.000Z");
  let selection: unknown;
  const service = createService({
    user: {
      findUnique: async (args: { select: unknown }) => {
        selection = args.select;
        return {
          id: "user-id",
          name: "Member",
          email: "member@example.test",
          pendingEmail: null,
          emailVerifiedAt: now,
          createdAt: now,
          avatarUrl: "/api/v1/account/profile-photo",
        };
      },
    },
  } as unknown as Partial<PrismaService>);

  const profile = await service.getProfile("user-id");
  assert.deepEqual(profile, {
    id: "user-id",
    name: "Member",
    email: "member@example.test",
    pendingEmail: null,
    emailVerifiedAt: now.toISOString(),
    createdAt: now.toISOString(),
    hasProfilePhoto: true,
  });
  assert.ok(
    !Object.keys(selection as Record<string, unknown>).includes("profilePhotoBytes"),
  );
});
