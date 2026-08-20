import { BadRequestException, Injectable } from '@nestjs/common';
import { PointSource } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TripsService } from '../trips/trips.service';

export interface TrackImportResult {
  /** Points the file contained that could be placed in time. */
  found: number;
  added: number;
  /** In the file, but outside this trip's dates — those belong to another trip. */
  outsideTrip: number;
  /** No timestamp, so nothing could be said about where they belong. */
  undated: number;
}

interface ParsedPoint {
  at: number;
  lat: number;
  lng: number;
  altitude?: number;
}

/** A file with more points than this is not a trip, it is a mistake. */
const MAX_POINTS = 200_000;

/**
 * GPX and KML, in and out.
 *
 * Tracks recorded elsewhere - a watch, OsmAnd, an older phone, an export from
 * something being left behind - are still this trip's route, and a trip that
 * lives here should be able to leave again in a form other maps can read.
 */
@Injectable()
export class TrackFileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trips: TripsService,
  ) {}

  /** The trip as GPX 1.1: one track per traveller, stops as waypoints. */
  async exportGpx(tripId: string, userId: string): Promise<{ filename: string; body: string }> {
    const { trip, tracks, stops } = await this.gather(tripId, userId);

    const waypoints = stops
      .map(
        (stop) =>
          `  <wpt lat="${stop.latitude}" lon="${stop.longitude}">\n` +
          `    <name>${escapeXml(stop.name)}</name>\n` +
          `  </wpt>`,
      )
      .join('\n');

    const trackXml = tracks
      .map(
        ({ displayName, points }) =>
          `  <trk>\n    <name>${escapeXml(displayName)}</name>\n    <trkseg>\n` +
          points
            .map(
              (p) =>
                `      <trkpt lat="${p.latitude}" lon="${p.longitude}">` +
                (p.altitude !== null ? `<ele>${p.altitude}</ele>` : '') +
                `<time>${p.recordedAt.toISOString()}</time></trkpt>`,
            )
            .join('\n') +
          `\n    </trkseg>\n  </trk>`,
      )
      .join('\n');

    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<gpx version="1.1" creator="MarkMySteps" xmlns="http://www.topografix.com/GPX/1/1">\n` +
      `  <metadata>\n    <name>${escapeXml(trip.title)}</name>\n` +
      `    <time>${new Date().toISOString()}</time>\n  </metadata>\n` +
      (waypoints ? `${waypoints}\n` : '') +
      (trackXml ? `${trackXml}\n` : '') +
      `</gpx>\n`;

    return { filename: `${slug(trip.title)}.gpx`, body };
  }

  /** The same trip as KML, for Google Earth and anything that reads it. */
  async exportKml(tripId: string, userId: string): Promise<{ filename: string; body: string }> {
    const { trip, tracks, stops } = await this.gather(tripId, userId);

    const placemarks = stops
      .map(
        (stop) =>
          `    <Placemark>\n      <name>${escapeXml(stop.name)}</name>\n` +
          `      <Point><coordinates>${stop.longitude},${stop.latitude},0</coordinates></Point>\n` +
          `    </Placemark>`,
      )
      .join('\n');

    const lines = tracks
      .map(
        ({ displayName, points }) =>
          `    <Placemark>\n      <name>${escapeXml(displayName)}</name>\n` +
          `      <LineString>\n        <tessellate>1</tessellate>\n        <coordinates>\n` +
          points
            .map((p) => `          ${p.longitude},${p.latitude},${p.altitude ?? 0}`)
            .join('\n') +
          `\n        </coordinates>\n      </LineString>\n    </Placemark>`,
      )
      .join('\n');

    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n` +
      `    <name>${escapeXml(trip.title)}</name>\n` +
      (placemarks ? `${placemarks}\n` : '') +
      (lines ? `${lines}\n` : '') +
      `  </Document>\n</kml>\n`;

    return { filename: `${slug(trip.title)}.kml`, body };
  }

  /**
   * Reads a GPX or KML file into this trip as the caller's own track.
   *
   * Points are dated, and a point outside the trip's dates is left alone: it
   * belongs to a different trip, and quietly stretching this one around it
   * would put a line across a continent nobody travelled that week.
   *
   * Re-importing the same file changes nothing: each point's client id is
   * derived from its own time and place.
   */
  async importFile(
    tripId: string,
    userId: string,
    filename: string,
    xml: string,
  ): Promise<TrackImportResult> {
    await this.trips.assertCanTrack(tripId, userId);
    const trip = await this.prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: { startDate: true, endDate: true },
    });

    const isKml = /\.kml$/i.test(filename) || xml.includes('<kml');
    const parsed = isKml ? parseKml(xml) : parseGpx(xml);
    if (parsed.points.length === 0 && parsed.undated === 0) {
      throw new BadRequestException('No track points found in this file');
    }

    const from = trip.startDate.getTime();
    const to = trip.endDate.getTime() + 86_400_000;
    const inTrip = parsed.points.filter((p) => p.at >= from && p.at <= to);

    const { count } = await this.prisma.locationPoint.createMany({
      data: inTrip.map((p) => ({
        tripId,
        userId,
        // Same point, same id: importing a file twice adds it once.
        clientId: `file:${createHash('sha1')
          .update(`${p.at}:${p.lat.toFixed(5)}:${p.lng.toFixed(5)}`)
          .digest('hex')
          .slice(0, 24)}`,
        recordedAt: new Date(p.at),
        latitude: p.lat,
        longitude: p.lng,
        altitude: p.altitude,
        source: PointSource.IMPORTED,
      })),
      skipDuplicates: true,
    });

    return {
      found: parsed.points.length,
      added: count,
      outsideTrip: parsed.points.length - inTrip.length,
      undated: parsed.undated,
    };
  }

  /** Everything an export needs, with the membership check done once. */
  private async gather(tripId: string, userId: string) {
    await this.trips.getForMember(tripId, userId);
    const [trip, points, stops] = await Promise.all([
      this.prisma.trip.findUniqueOrThrow({
        where: { id: tripId },
        select: { title: true },
      }),
      this.prisma.locationPoint.findMany({
        where: { tripId },
        select: {
          userId: true,
          recordedAt: true,
          latitude: true,
          longitude: true,
          altitude: true,
          user: { select: { displayName: true } },
        },
        orderBy: { recordedAt: 'asc' },
        take: MAX_POINTS,
      }),
      this.prisma.stop.findMany({
        where: { tripId, latitude: { not: null }, longitude: { not: null } },
        select: { name: true, latitude: true, longitude: true },
        orderBy: { orderIndex: 'asc' },
      }),
    ]);

    const byUser = new Map<string, { displayName: string; points: typeof points }>();
    for (const point of points) {
      const entry = byUser.get(point.userId) ?? {
        displayName: point.user.displayName,
        points: [] as typeof points,
      };
      entry.points.push(point);
      byUser.set(point.userId, entry);
    }

    return {
      trip,
      tracks: [...byUser.values()],
      stops: stops as { name: string; latitude: number; longitude: number }[],
    };
  }
}

/** `<trkpt lat lon>` with a `<time>`, in whatever order the attributes came. */
function parseGpx(xml: string): { points: ParsedPoint[]; undated: number } {
  const points: ParsedPoint[] = [];
  let undated = 0;

  const pattern = /<(?:trkpt|rtept)\b([^>]*?)(\/?)>([\s\S]*?)(?:<\/(?:trkpt|rtept)>|(?=<))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null && points.length < MAX_POINTS) {
    const lat = Number(attr(match[1] ?? '', 'lat'));
    const lng = Number(attr(match[1] ?? '', 'lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const inner = match[2] === '/' ? '' : (match[3] ?? '');
    const time = /<time>([^<]+)<\/time>/.exec(inner)?.[1];
    const at = time ? Date.parse(time) : NaN;
    if (!Number.isFinite(at)) {
      undated++;
      continue;
    }
    const ele = Number(/<ele>([^<]+)<\/ele>/.exec(inner)?.[1]);
    points.push({ at, lat, lng, altitude: Number.isFinite(ele) ? ele : undefined });
  }

  return { points, undated };
}

/**
 * KML's timed form (`gx:Track`) is the one worth reading: a bare LineString
 * has coordinates and no clock, and a route without times cannot be placed on
 * a trip's days.
 */
function parseKml(xml: string): { points: ParsedPoint[]; undated: number } {
  const points: ParsedPoint[] = [];

  const whens = [...xml.matchAll(/<when>([^<]+)<\/when>/g)].map((m) => Date.parse(m[1] ?? ''));
  const coords = [...xml.matchAll(/<gx:coord>([^<]+)<\/gx:coord>/g)].map((m) =>
    (m[1] ?? '').trim().split(/\s+/).map(Number),
  );

  for (let i = 0; i < Math.min(whens.length, coords.length, MAX_POINTS); i++) {
    const at = whens[i]!;
    const [lng, lat, altitude] = coords[i]!;
    if (!Number.isFinite(at) || !Number.isFinite(lat!) || !Number.isFinite(lng!)) continue;
    points.push({
      at,
      lat: lat!,
      lng: lng!,
      altitude: Number.isFinite(altitude!) ? altitude : undefined,
    });
  }

  // Untimed coordinates are counted so the answer can say why they were left.
  const untimed = [...xml.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)].reduce(
    (sum, m) => sum + (m[1] ?? '').trim().split(/\s+/).filter(Boolean).length,
    0,
  );

  return { points, undated: points.length === 0 ? untimed : 0 };
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1];
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'reis'
  );
}
