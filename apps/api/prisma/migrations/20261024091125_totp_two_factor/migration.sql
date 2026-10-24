-- Second step at sign-in: an authenticator app (TOTP), with one-time recovery
-- codes for when the phone is gone, and a bell notification for admins when an
-- account keeps getting its password or code wrong.
--
-- Written by `prisma migrate dev --create-only`, then trimmed: Prisma also wanted
-- to drop media_refs_tripId_latitude_idx and the DEFAULT on the geom columns,
-- which is drift between schema.prisma and the hand-written PostGIS migrations
-- and has nothing to do with this change.

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'SECURITY_LOGIN_ATTEMPTS';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "detail" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpSecretEnc" TEXT;

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recovery_codes_userId_codeHash_key" ON "recovery_codes"("userId", "codeHash");

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
