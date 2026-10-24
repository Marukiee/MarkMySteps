-- Emoji on comments: one per person per comment.
CREATE TABLE "comment_reactions" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "commentId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "reactorKey" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comment_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "comment_reactions_commentId_reactorKey_key" ON "comment_reactions"("commentId", "reactorKey");
CREATE INDEX "comment_reactions_tripId_idx" ON "comment_reactions"("tripId");

ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "photo_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
