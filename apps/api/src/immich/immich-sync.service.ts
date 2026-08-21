import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TripRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ImmichAsset, ImmichClientService } from './immich-client.service';
import { ImmichConnectionService } from './immich-connection.service';
import { ImmichGeotagService } from './immich-geotag.service';

export interface SyncResult {
  tripId: string;
  usersSynced: number;
  assetsFound: number;
  assetsAdded: number;
  assetsRemoved: number;
  /** Photos that had no GPS and were placed from the tracked route. */
  assetsGeotagged: number;
  /** Of those, the ones whose position was written back into Immich. */
  assetsPushed: number;
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
    private readonly geotag: ImmichGeotagService,
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
      assetsGeotagged: 0,
      assetsPushed: 0,
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
                width: asset.width,
                height: asset.height,
              },
            ],
            skipDuplicates: true,
          });
          result.assetsAdded += count;
        }

        // Refs that predate dimensions being recorded: fill them in from the
        // assets we just fetched. Only rows still missing them are touched, so
        // this costs nothing from the second sync onwards.
        await this.backfillDimensions(tripId, userId, assets);

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

    // Photos the camera never placed get their position from the trip's own
    // track. Runs after every traveller has been pulled in, so a photo can
    // borrow a companion's fixes when its own owner tracked nothing.
    try {
      const placed = await this.geotag.geotagTrip(tripId);
      result.assetsGeotagged = placed.matched;
      result.assetsPushed = placed.pushed;
    } catch (err) {
      this.logger.warn(`Geotagging failed for trip ${tripId}: ${String(err)}`);
    }

    return result;
  }

  /**
   * Writes pixel dimensions onto refs that were synced before we recorded them.
   *
   * Without a shape, the gallery cannot lay a photo out until its bytes have
   * arrived, which is exactly the reflow-per-image jank the justified grid
   * exists to avoid. One query finds the gaps; only those rows are written.
   */
  private async backfillDimensions(
    tripId: string,
    userId: string,
    assets: ImmichAsset[],
  ): Promise<void> {
    const sized = new Map(
      assets.filter((a) => a.width && a.height).map((a) => [a.id, a] as const),
    );
    if (sized.size === 0) return;

    const missing = await this.prisma.mediaRef.findMany({
      where: { tripId, userId, width: null },
      select: { id: true, immichAssetId: true },
    });

    for (const ref of missing) {
      const asset = sized.get(ref.immichAssetId);
      if (!asset) continue;
      await this.prisma.mediaRef.update({
        where: { id: ref.id },
        data: { width: asset.width, height: asset.height },
      });
    }
  }
}
