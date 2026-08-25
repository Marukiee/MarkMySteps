import type { PrismaService } from '../prisma/prisma.service';

/** The parts of a dropped reference needed to recognise its replacement. */
export interface DeadRef {
  id: string;
  tripId: string;
  userId: string;
  takenAt: Date;
  assetType: string;
}

/**
 * The photo that has taken a deleted one's place, if there is one.
 *
 * Re-editing a photo means exporting a new file and deleting the original, so
 * the picture on the trip is the same picture and its media id is not. Every
 * cover pointing at the old id was left pointing at nothing, and putting it
 * back meant finding that photo again in a timeline of thousands and saying
 * "this one" a second time.
 *
 * An export keeps the capture time it was taken at, which is what identifies
 * the two files as the same photograph: same trip, same photographer, same
 * moment, same kind of thing. The newest such reference is the successor, so
 * a photo edited twice hands the cover on each time.
 *
 * Nothing is guessed beyond that. An editor that strips the EXIF date gives
 * the new file a capture time of its own, and then there is no successor and
 * the cover falls back the way it did before.
 */
export async function coverSuccessor(
  prisma: PrismaService,
  dead: DeadRef,
): Promise<string | null> {
  const heir = await prisma.mediaRef.findFirst({
    where: {
      tripId: dead.tripId,
      userId: dead.userId,
      assetType: dead.assetType,
      takenAt: dead.takenAt,
      id: { not: dead.id },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return heir?.id ?? null;
}
