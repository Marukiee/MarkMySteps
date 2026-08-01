import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TripRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ImmichClientService } from './immich-client.service';
import { ImmichConnectionService } from './immich-connection.service';

export interface SyncResult {
  tripId: string;
  usersSynced: number;
  assetsFound: number;
  assetsAdded: number;
  assetsRemoved: number;
}

/** Extra window after a trip's end date; photos often sync to Immich late. */
const GRACE_DAYS = 3;
const DAY_MS = 86_400_000;

@Injectable()
export class ImmichSyncService {
  private readonly logger = new Logger(ImmichSyncService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ImmichClientService,
    private readonly connections: ImmichConnectionService,
  ) {}

  /** Periodic sync of every currently active trip. */
  @Cron('0 */15 * * * *')
  async syncActiveTrips(): Promise<void> {
    // Prevent overlapping runs when a sync takes longer than the interval.
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const activeTrips = await this.prisma.trip.findMany({
        where: {
          startDate: { lte: now },
          endDate: { gte: new Date(now.getTime() - GRACE_DAYS * DAY_MS) },
        },
        select: { id: true },
      });

      for (const trip of activeTrips) {
        await this.syncTrip(trip.id).catch((err) => {
          this.logger.error(`Sync failed for trip ${trip.id}: ${String(err)}`);
        });
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Syncs one trip: for every member with an Immich connection, fetch assets
   * within the trip's date range and upsert MediaRefs (metadata only).
   */
  async syncTrip(tripId: string): Promise<SyncResult> {
    const trip = await this.prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      include: { members: { select: { userId: true, role: true } } },
    });

    // Guests look, they don't contribute. Pulling their Immich library into
    // somebody else's trip would put their private photos in a timeline they
    // were only invited to read — and give them a route on its map.
    const travellers = trip.members.filter((m) => m.role !== TripRole.GUEST);
    const guestIds = trip.members.filter((m) => m.role === TripRole.GUEST).map((m) => m.userId);
    if (guestIds.length > 0) {
      // Somebody turned down to guest keeps whatever earlier syncs added, so
      // the demotion has to take it out again.
      await this.prisma.mediaRef.deleteMany({ where: { tripId, userId: { in: guestIds } } });
    }

    // Trip dates are DATE columns: extend `to` to the end of that day.
    const from = trip.startDate;
    const to = new Date(trip.endDate.getTime() + DAY_MS);

    const result: SyncResult = {
      tripId,
      usersSynced: 0,
      assetsFound: 0,
      assetsAdded: 0,
      assetsRemoved: 0,
    };

    for (const { userId } of travellers) {
      const credentials = await this.connections.getCredentials(userId);
      if (!credentials) continue;

      try {
        const assets = await this.client.searchAssets(
          credentials.serverUrl,
          credentials.apiKey,
          from,
          to,
        );
        result.usersSynced++;
        result.assetsFound += assets.length;

        for (const asset of assets) {
          const { count } = await this.prisma.mediaRef.createMany({
            data: [
              {
                tripId,
                userId,
                immichAssetId: asset.id,
                assetType: asset.type,
                takenAt: asset.takenAt,
                latitude: asset.latitude,
                longitude: asset.longitude,
              },
            ],
            skipDuplicates: true,
          });
          result.assetsAdded += count;
        }

        // Reconcile: drop references that Immich no longer returns for this
        // range — assets that were archived or deleted since the last sync.
        // (searchAssets caps at MAX_PAGES; the guard prevents mass-deletion
        // on a truncated result.)
        if (assets.length < 250 * 40) {
          const { count: removed } = await this.prisma.mediaRef.deleteMany({
            where: {
              tripId,
              userId,
              immichAssetId: { notIn: assets.map((a) => a.id) },
            },
          });
          result.assetsRemoved += removed;
        }

        await this.connections.recordSyncResult(userId, null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Sync failed for user ${userId} in trip ${tripId}: ${message}`);
        await this.connections.recordSyncResult(userId, message);
      }
    }

    return result;
  }
}
