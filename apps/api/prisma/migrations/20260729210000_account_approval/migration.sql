-- Registration becomes a request: an account is unusable until an admin says
-- otherwise. Enforced server side — the token a pending user gets is refused
-- everywhere except the one endpoint that reports their status.
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "users" ADD COLUMN "status" "AccountStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "users" ADD COLUMN "decidedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "decidedById" UUID;
ALTER TABLE "users" ADD COLUMN "approvalSeen" BOOLEAN NOT NULL DEFAULT false;

-- Everyone who already had an account keeps it: they were let in under the old
-- rules, and locking them out on upgrade would be a nasty surprise.
UPDATE "users" SET "status" = 'APPROVED', "approvalSeen" = true;
