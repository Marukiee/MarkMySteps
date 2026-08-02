-- A phone that polls for its own notifications, because there is no push
-- service on a de-Googled device to deliver them to it.

CREATE TABLE "notification_devices" (
  "id"           UUID NOT NULL,
  "userId"       UUID NOT NULL,
  "tokenHash"    TEXT NOT NULL,
  "lastSeenId"   UUID,
  "lastPolledAt" TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_devices_tokenHash_key"
  ON "notification_devices" ("tokenHash");
CREATE INDEX "notification_devices_userId_idx" ON "notification_devices" ("userId");

ALTER TABLE "notification_devices"
  ADD CONSTRAINT "notification_devices_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
