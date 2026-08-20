import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TripsService } from '../trips/trips.service';

/** A place the trip stood still long enough for it to have been a stop. */
export interface StaySuggestion {
  /** Stable across runs, so "not this one" can be remembered by the client. */
  key: string;
  latitude: number;
  longitude: number;
  /** First and last fix of the stay, ISO. */
  from: string;
  to: string;
  /** Nights slept there, which is what a planned stop is measured in. */
  nights: number;
  photos: number;
}

/** Fixes within this of the stay's centre still count as the same place. */
const STAY_RADIUS_KM = 2.5;
/** Shorter than this is a visit, not a stop: it has to cover a night. */
const MIN_STAY_MS = 10 * 60 * 60_000;
/** A stay this close to a stop that already exists is that stop. */
const EXISTING_STOP_KM = 6;
/** Two travellers standing in the same town produce one suggestion. */
const SAME_PLACE_KM = 3;

interface Fix {
  t: number;
  lat: number;
  lng: number;
}

/**
 * Reads the trip's own track back as an itinerary.
 *
 * A trip that was tracked but never planned has all its places in it already:
 * every night you slept somewhere is a run of fixes that stayed put for hours.
 * Finding those means the map's route can become the list of stops without
 * anyone typing the towns in afterwards.
 */
@Injectable()
export class StayDetectorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trips: TripsService,
  ) {}

  async suggest(tripId: string, userId: string): Promise<StaySuggestion[]> {
    await this.trips.getForMember(tripId, userId);

    const [points, stops, photos] = await Promise.all([
      this.prisma.locationPoint.findMany({
        where: { tripId },
        select: { userId: true, recordedAt: true, latitude: true, longitude: true },
        orderBy: { recordedAt: 'asc' },
      }),
      this.prisma.stop.findMany({
        where: { tripId },
        select: { latitude: true, longitude: true },
      }),
      this.prisma.mediaRef.findMany({
        where: { tripId, latitude: { not: null } },
        select: { takenAt: true },
        orderBy: { takenAt: 'asc' },
      }),
    ]);
    if (points.length === 0) return [];

    // Per traveller: two people on the same trip are not always in the same
    // place, and merging their fixes into one sequence makes a stay look like
    // constant movement between two towns.
    const byUser = new Map<string, Fix[]>();
    for (const p of points) {
      const fix = { t: p.recordedAt.getTime(), lat: p.latitude, lng: p.longitude };
      const list = byUser.get(p.userId);
      if (list) list.push(fix);
      else byUser.set(p.userId, [fix]);
    }

    let stays: StaySuggestion[] = [];
    for (const fixes of byUser.values()) {
      stays.push(...detectStays(fixes));
    }

    // Same town, same days, two phones: one suggestion.
    stays.sort((a, b) => a.from.localeCompare(b.from));
    stays = stays.filter((stay, index) =>
      stays.every(
        (other, otherIndex) =>
          otherIndex >= index ||
          !(
            haversineKm(stay, other) <= SAME_PLACE_KM &&
            overlaps(stay, other)
          ),
      ),
    );

    // Anything the plan already knows about is not a suggestion.
    const planned = stops.filter(
      (s): s is { latitude: number; longitude: number } =>
        s.latitude !== null && s.longitude !== null,
    );
    stays = stays.filter(
      (stay) => !planned.some((stop) => haversineKm(stay, stop) <= EXISTING_STOP_KM),
    );

    // How much of the trip's photography happened there, which is the honest
    // measure of whether a stay was a place or a long wait at a border.
    for (const stay of stays) {
      const from = new Date(stay.from).getTime();
      const to = new Date(stay.to).getTime();
      stay.photos = photos.filter((p) => {
        const t = p.takenAt.getTime();
        return t >= from && t <= to;
      }).length;
    }

    return stays;
  }
}

/** Runs of consecutive fixes that never left a small circle. */
function detectStays(fixes: Fix[]): StaySuggestion[] {
  const stays: StaySuggestion[] = [];
  let i = 0;

  while (i < fixes.length) {
    let sumLat = fixes[i]!.lat;
    let sumLng = fixes[i]!.lng;
    let centre = { lat: sumLat, lng: sumLng };
    let j = i + 1;

    while (j < fixes.length && haversineKm(centre, fixes[j]!) <= STAY_RADIUS_KM) {
      sumLat += fixes[j]!.lat;
      sumLng += fixes[j]!.lng;
      const count = j - i + 1;
      centre = { lat: sumLat / count, lng: sumLng / count };
      j++;
    }

    const first = fixes[i]!;
    const last = fixes[j - 1]!;
    const duration = last.t - first.t;
    if (duration >= MIN_STAY_MS) {
      const from = new Date(first.t);
      const to = new Date(last.t);
      stays.push({
        key: `${centre.lat.toFixed(3)},${centre.lng.toFixed(3)}@${from.toISOString().slice(0, 10)}`,
        latitude: round6(centre.lat),
        longitude: round6(centre.lng),
        from: from.toISOString(),
        to: to.toISOString(),
        nights: nightsBetween(from, to),
        photos: 0,
      });
    }
    // A stay ends where the circle broke; a short run is simply passed over.
    i = Math.max(j, i + 1);
  }

  return stays;
}

/** Midnights crossed — a stay that starts at nine and ends at six is one night. */
function nightsBetween(from: Date, to: Date): number {
  const startDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const endDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.max(1, Math.round((endDay - startDay) / 86_400_000));
}

function overlaps(a: StaySuggestion, b: StaySuggestion): boolean {
  return a.from <= b.to && b.from <= a.to;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function haversineKm(
  a: { lat?: number; latitude?: number; lng?: number; longitude?: number },
  b: { lat?: number; latitude?: number; lng?: number; longitude?: number },
): number {
  const lat1 = a.lat ?? a.latitude ?? 0;
  const lng1 = a.lng ?? a.longitude ?? 0;
  const lat2 = b.lat ?? b.latitude ?? 0;
  const lng2 = b.lng ?? b.longitude ?? 0;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sin =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(sin)));
}
