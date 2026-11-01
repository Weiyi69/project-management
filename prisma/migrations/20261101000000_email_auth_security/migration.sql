-- CreateEnum
CREATE TYPE "AuthCodePurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- Treat every account that predates verification as verified.
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP;

-- Enforce normalized email uniqueness for future registrations.
CREATE UNIQUE INDEX "User_email_lower_key" ON "User"(LOWER("email"));

-- CreateTable
CREATE TABLE "AuthCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "AuthCodePurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "AuthCode_userId_purpose_createdAt_idx" ON "AuthCode"("userId", "purpose", "createdAt");
CREATE INDEX "AuthCode_expiresAt_idx" ON "AuthCode"("expiresAt");
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

-- AddForeignKey
ALTER TABLE "AuthCode" ADD CONSTRAINT "AuthCode_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
