-- A bell notification for admins when somebody signs up and waits to be let in.

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'ACCOUNT_REQUESTED';
