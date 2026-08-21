import { Injectable, NotFoundException } from '@nestjs/common';
import { MediaRef } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TripsService } from '../trips/trips.service';

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
