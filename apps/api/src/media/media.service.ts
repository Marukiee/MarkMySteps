import { Injectable, NotFoundException } from '@nestjs/common';
import { MediaRef } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TripsService } from '../trips/trips.service';
import { coverSuccessor } from './cover-succession';

export type MediaItem = Pick<
  MediaRef,
  | 'id'
  | 'userId'
  | 'immichAssetId'
  | 'assetType'
  | 'takenAt'
  | 'latitude'
  | 'longitude'
  | 'width'
  | 'height'
>;

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trips: TripsService,
  ) {}

  /**
   * Lists a trip's media, ordered by capture time.
   * `userIds` narrows to specific travellers (map person-filter).
   */
  async listForTrip(tripId: string, requesterId: string, userIds?: string[]): Promise<MediaItem[]> {
    await this.trips.getForMember(tripId, requesterId); // membership check

    return this.prisma.mediaRef.findMany({
      where: {
        tripId,
        ...(userIds && userIds.length > 0 ? { userId: { in: userIds } } : {}),
      },
      orderBy: { takenAt: 'asc' },
      select: {
        id: true,
        userId: true,
        immichAssetId: true,
        assetType: true,
        takenAt: true,
        latitude: true,
        longitude: true,
        width: true,
        height: true,
      },
    });
  }

  /** Returns the MediaRef if the requester shares the trip; 404 otherwise. */
  /**
   * Drops a reference to a photo Immich no longer has, and anything pointing
   * at it.
   *
   * A cover is stored as a plain media id rather than a relation, so a photo
   * deleted in Immich left the trip (or the stop) fronted by a picture nobody
   * can fetch: a white rectangle that never finished loading, and no way back
   * to a working cover short of picking a new one by hand. The next sync would
   * drop the reference anyway; this does it the moment the gap is discovered,
   * so the cover moves on to the replacement photo, or failing that falls back
   * to the trip's own first photo, straight away.
   */
  async forgetMissing(mediaRefId: string): Promise<void> {
    const dead = await this.prisma.mediaRef.findUnique({ where: { id: mediaRefId } });
    if (!dead) return;
    // A photo that was re-edited and re-added is the same photograph under a
    // new id, and a cover that pointed at the old one follows it there.
    const heir = await coverSuccessor(this.prisma, dead);
    await this.prisma.$transaction([
      this.prisma.trip.updateMany({
        where: { coverMediaId: mediaRefId },
        data: { coverMediaId: heir },
      }),
      this.prisma.stop.updateMany({
        where: { coverMediaId: mediaRefId },
        data: { coverMediaId: heir },
      }),
      this.prisma.mediaRef.deleteMany({ where: { id: mediaRefId } }),
    ]);
  }

  async getForRequester(mediaRefId: string, requesterId: string): Promise<MediaRef> {
    const media = await this.prisma.mediaRef.findFirst({
      where: {
        id: mediaRefId,
        trip: { members: { some: { userId: requesterId } } },
      },
    });
    if (!media) {
      throw new NotFoundException('Media not found');
    }
    return media;
  }
}
