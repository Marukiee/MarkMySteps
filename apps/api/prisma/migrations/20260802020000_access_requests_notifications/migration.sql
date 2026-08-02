-- Asking to be let onto somebody else's trip, and the bell that carries the
-- answer back.

CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');

CREATE TYPE "NotificationKind" AS ENUM (
  'TRIP_ADDED',
  'ACCESS_REQUESTED',
  'ACCESS_APPROVED',
  'ACCESS_DENIED'
);

CREATE TABLE "trip_access_requests" (
  "id"          UUID NOT NULL,
  "tripId"      UUID NOT NULL,
  "userId"      UUID NOT NULL,
  "status"      "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
  "grantedRole" "TripRole",
  "message"     TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt"   TIMESTAMP(3),
  "decidedById" UUID,
  CONSTRAINT "trip_access_requests_pkey" PRIMARY KEY ("id")
);

-- One open ask per person per trip: asking again is the same ask.
CREATE UNIQUE INDEX "trip_access_requests_tripId_userId_key"
  ON "trip_access_requests" ("tripId", "userId");
CREATE INDEX "trip_access_requests_userId_idx" ON "trip_access_requests" ("userId");

ALTER TABLE "trip_access_requests"
  ADD CONSTRAINT "trip_access_requests_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "trips" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "trip_access_requests_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "trip_access_requests_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "notifications" (
  "id"        UUID NOT NULL,
  "userId"    UUID NOT NULL,
  "kind"      "NotificationKind" NOT NULL,
  "actorId"   UUID,
  "tripId"    UUID,
  "requestId" UUID,
  "readAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_userId_createdAt_idx"
  ON "notifications" ("userId", "createdAt");

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "notifications_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "notifications_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "trips" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "notifications_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "trip_access_requests" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
