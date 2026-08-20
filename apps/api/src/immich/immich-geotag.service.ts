import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ImmichClientService } from './immich-client.service';
import { ImmichConnectionService } from './immich-connection.service';

export interface GeotagResult {
  /** Photos that had no position and now have one. */
  matched: number;
  /** Of those, the ones also written back into Immich. */
  pushed: number;
  /** Still without a position: nothing was tracked near that minute. */
  unmatched: number;
}

/**
 * Two fixes on either side of the photo count as "you were on your way" only
 * if they are close enough together in time; interpolating across a four-hour
 * gap would invent a position halfway down a road you may never have taken.
 */
const INTERPOLATE_GAP_MS = 30 * 60_000;
/** Otherwise the nearest single fix is used, but only if it is this recent. */
const NEAREST_MS = 2 * 60 * 60_000;
/** Immich takes one asset per request, so the pushes are fired in batches. */
const PUSH_CONCURRENCY = 4;

interface Fix {
  t: number;
  lat: number;
  lng: number;
}

/**
 * Gives photos without GPS a position from the trip's own tracked route.
 *
 * Phones write EXIF coordinates only when location was on for the camera, so a
 * trip that was tracked all day still ends up with photos that sit nowhere on
 * its map. The route knows where their owner was at that minute, which is the
 * same answer the camera would have written down.
 *
 * The position is marked as derived and written back into Immich as well, so
 * the photo has a place in the library it actually lives in.
 */
@Injectable()
export class ImmichGeotagService {
  private readonly logger = new Logger(ImmichGeotagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ImmichClientService,
    private readonly connections: ImmichConnectionService,
  ) {}

  /** Matches every position-less photo in one trip. Safe to run repeatedly. */
  async geotagTrip(tripId: string, pushToImmich = true): Promise<GeotagResult> {
    const result: GeotagResult = { matched: 0, pushed: 0, unmatched: 0 };

    const missing = await this.prisma.mediaRef.findMany({
      where: { tripId, latitude: null },
      select: { id: true, userId: true, takenAt: true, immichAssetId: true },
      orderBy: { takenAt: 'asc' },
    });
    if (missing.length === 0) return result;

    const points = await this.prisma.locationPoint.findMany({
      where: { tripId },
      select: { userId: true, recordedAt: true, latitude: true, longitude: true },
      orderBy: { recordedAt: 'asc' },
    });
    if (points.length === 0) {
      result.unmatched = missing.length;
      return result;
    }

    // Your own fixes answer first: on a shared trip everyone carries their own
    // phone, and two travellers are not always in the same place. The whole
    // trip's track is the fallback for someone who never tracked at all.
    const byUser = new Map<string, Fix[]>();
    const all: Fix[] = [];
    for (const p of points) {
      const fix = { t: p.recordedAt.getTime(), lat: p.latitude, lng: p.longitude };
      const own = byUser.get(p.userId);
      if (own) own.push(fix);
      else byUser.set(p.userId, [fix]);
      all.push(fix);
    }

    const pushes: { userId: string; assetId: string; lat: number; lng: number; refId: string }[] =
      [];

    for (const photo of missing) {
      const own = byUser.get(photo.userId);
      const guess =
        (own && locate(own, photo.takenAt.getTime())) ?? locate(all, photo.takenAt.getTime());
      if (!guess) {
        result.unmatched++;
        continue;
      }

      await this.prisma.mediaRef.update({
        where: { id: photo.id },
        data: { latitude: guess.lat, longitude: guess.lng, geoDerived: true },
      });
      result.matched++;
      if (pushToImmich) {
        pushes.push({
          userId: photo.userId,
          assetId: photo.immichAssetId,
          lat: guess.lat,
          lng: guess.lng,
          refId: photo.id,
        });
      }
    }

    if (pushes.length > 0) {
      result.pushed = await this.pushAll(pushes);
    }
    return result;
  }

  /**
   * Writes the derived positions into each owner's Immich, a few at a time.
   *
   * A failed write is not a failed match: the photo keeps its position here and
   * `geoPushedAt` stays null, so the next run tries that asset again.
   */
  private async pushAll(
    pushes: { userId: string; assetId: string; lat: number; lng: number; refId: string }[],
  ): Promise<number> {
    const credentials = new Map<string, { serverUrl: string; apiKey: string } | null>();
    for (const userId of new Set(pushes.map((p) => p.userId))) {
      credentials.set(userId, await this.connections.getCredentials(userId));
    }

    let pushed = 0;
    for (let i = 0; i < pushes.length; i += PUSH_CONCURRENCY) {
      const slice = pushes.slice(i, i + PUSH_CONCURRENCY);
      const done = await Promise.all(
        slice.map(async (push) => {
          const creds = credentials.get(push.userId);
          if (!creds) return null;
          try {
            await this.client.setAssetLocation(
              creds.serverUrl,
              creds.apiKey,
              push.assetId,
              push.lat,
              push.lng,
            );
            return push.refId;
          } catch (err) {
            this.logger.warn(
              `Could not write location to Immich for asset ${push.assetId}: ${String(err)}`,
            );
            return null;
          }
        }),
      );
      const ok = done.filter((id): id is string => id !== null);
      if (ok.length > 0) {
        await this.prisma.mediaRef.updateMany({
          where: { id: { in: ok } },
          data: { geoPushedAt: new Date() },
        });
        pushed += ok.length;
      }
    }
    return pushed;
  }
}

/**
 * Where the owner of this photo was at `when`, according to their fixes.
 *
 * Between two fixes it interpolates along the straight line between them
 * (weighted by time), which is as close to the truth as a track can get
 * without knowing the road. Outside any pair it falls back to the nearest
 * fix, and beyond `NEAREST_MS` it gives up rather than guess.
 */
function locate(fixes: Fix[], when: number): { lat: number; lng: number } | null {
  if (fixes.length === 0) return null;

  // Binary search for the first fix at or after `when`.
  let lo = 0;
  let hi = fixes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fixes[mid]!.t < when) lo = mid + 1;
    else hi = mid;
  }
  const after = fixes[lo] ?? null;
  const before = fixes[lo - 1] ?? null;

  if (before && after && after.t - before.t <= INTERPOLATE_GAP_MS) {
    const span = after.t - before.t;
    const f = span === 0 ? 0 : (when - before.t) / span;
    return {
      lat: before.lat + (after.lat - before.lat) * f,
      lng: before.lng + (after.lng - before.lng) * f,
    };
  }

  const candidates = [before, after].filter((f): f is Fix => f !== null);
  let best: Fix | null = null;
  for (const fix of candidates) {
    if (!best || Math.abs(fix.t - when) < Math.abs(best.t - when)) best = fix;
  }
  if (!best || Math.abs(best.t - when) > NEAREST_MS) return null;
  return { lat: best.lat, lng: best.lng };
}
