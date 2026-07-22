import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PointSource, TripRole } from '@prisma/client';
import AdmZip from 'adm-zip';
import { PrismaService } from '../prisma/prisma.service';

export interface ImportedTripSummary {
  tripId: string;
  title: string;
  startDate: string;
  endDate: string;
  pointsImported: number;
  stopsImported: number;
}

/** Shape of trip.json inside a Polarsteps "Download my data" export. */
interface PolarstepsTrip {
  name?: string;
  summary?: string;
  start_date?: number; // epoch seconds
  end_date?: number;
  all_steps?: PolarstepsStep[];
}

interface PolarstepsStep {
  name?: string | null;
  display_name?: string | null;
  description?: string | null;
  start_time?: number; // epoch seconds (sometimes milliseconds)
  location?: {
    name?: string | null;
    detail?: string | null;
    lat?: number;
    lon?: number;
    country_code?: string | null;
  };
}

/** Polarsteps exports use epoch seconds, but be tolerant of milliseconds. */
function toMs(epoch: number): number {
  return epoch > 1e11 ? epoch : epoch * 1000;
}

interface PolarstepsLocation {
  lat: number;
  lon: number;
  time: number; // epoch seconds (fractional)
}

const MAX_POINTS_PER_TRIP = 200_000;

/**
 * Imports trips from a Polarsteps GDPR export ("Download my data" zip).
 * Each trip folder contains trip.json (metadata) and locations.json
 * (raw GPS track). Points are stored with source = IMPORTED.
 */
@Injectable()
export class PolarstepsImportService {
  private readonly logger = new Logger(PolarstepsImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async importZip(userId: string, zipBuffer: Buffer): Promise<ImportedTripSummary[]> {
    let zip: AdmZip;
    try {
      zip = new AdmZip(zipBuffer);
    } catch {
      throw new BadRequestException('Not a valid zip file');
    }

    // Group entries by their containing folder; a trip folder is one that
    // holds a trip.json. locations.json in the same folder has the track.
    const folders = new Map<string, { trip?: Buffer; locations?: Buffer }>();
    for (const entry of zip.getEntries()) {
      const name = entry.entryName;
      const base = name.split('/').pop() ?? '';
      if (base !== 'trip.json' && base !== 'locations.json') continue;
      const folder = name.slice(0, name.length - base.length);
      const bucket = folders.get(folder) ?? {};
      bucket[base === 'trip.json' ? 'trip' : 'locations'] = entry.getData();
      folders.set(folder, bucket);
    }

    const tripFolders = [...folders.entries()].filter(([, files]) => files.trip);
    if (tripFolders.length === 0) {
      throw new BadRequestException(
        'No trip.json found in the zip — upload the unmodified Polarsteps "Download my data" export',
      );
    }

    const summaries: ImportedTripSummary[] = [];
    for (const [folder, files] of tripFolders) {
      try {
        summaries.push(await this.importTrip(userId, files.trip!, files.locations));
      } catch (err) {
        this.logger.warn(`Skipping trip folder "${folder}": ${String(err)}`);
      }
    }

    if (summaries.length === 0) {
      throw new BadRequestException('Found trip folders, but none could be imported');
    }
    return summaries;
  }

  private async importTrip(
    userId: string,
    tripJson: Buffer,
    locationsJson?: Buffer,
  ): Promise<ImportedTripSummary> {
    const meta = JSON.parse(tripJson.toString('utf8')) as PolarstepsTrip;
    const points = locationsJson ? parseLocations(locationsJson) : [];

    const startDate = meta.start_date
      ? new Date(meta.start_date * 1000)
      : earliest(points) ?? new Date();
    const endDate = meta.end_date ? new Date(meta.end_date * 1000) : latest(points) ?? startDate;

    const trip = await this.prisma.trip.create({
      data: {
        title: meta.name?.trim() || 'Imported trip',
        description: meta.summary?.trim(),
        startDate,
        endDate,
        ownerId: userId,
        members: { create: { userId, role: TripRole.OWNER } },
      },
    });

    let imported = 0;
    // Insert in chunks to keep memory and query size bounded.
    for (let i = 0; i < points.length; i += 5000) {
      const chunk = points.slice(i, i + 5000);
      const { count } = await this.prisma.locationPoint.createMany({
        data: chunk.map((p) => ({
          tripId: trip.id,
          userId,
          recordedAt: new Date(toMs(p.time)),
          latitude: p.lat,
          longitude: p.lon,
          source: PointSource.IMPORTED,
        })),
      });
      imported += count;
    }

    const stopsImported = await this.importSteps(trip.id, meta, endDate).catch((err) => {
      // A failing steps import must never lose the trip + route that were
      // already created; log loudly and report 0 stops instead.
      this.logger.error(`Steps import failed for trip "${trip.title}": ${String(err)}`);
      return 0;
    });

    return {
      tripId: trip.id,
      title: trip.title,
      startDate: trip.startDate.toISOString(),
      endDate: trip.endDate.toISOString(),
      pointsImported: imported,
      stopsImported,
    };
  }

  /**
   * Polarsteps "steps" → planner stops. Nights per stop are derived from the
   * time gap to the next step (or to the trip end for the last one).
   */
  private async importSteps(tripId: string, meta: PolarstepsTrip, tripEnd: Date): Promise<number> {
    const steps = (meta.all_steps ?? [])
      .filter((s) => typeof s.start_time === 'number')
      .sort((a, b) => a.start_time! - b.start_time!);
    if (steps.length === 0) {
      this.logger.warn(
        `trip.json has no usable all_steps (keys: ${Object.keys(meta).join(', ')})`,
      );
      return 0;
    }

    const data = steps.map((step, index) => {
      const nextTime =
        index + 1 < steps.length ? toMs(steps[index + 1]!.start_time!) : tripEnd.getTime();
      const nights = Math.max(0, Math.round((nextTime - toMs(step.start_time!)) / 86_400_000));
      const countryCode = step.location?.country_code?.trim().toUpperCase();
      return {
        tripId,
        name:
          step.display_name?.trim() ||
          step.name?.trim() ||
          step.location?.name?.trim() ||
          `Stop ${index + 1}`,
        notes: step.description?.trim() || undefined,
        nights,
        orderIndex: index,
        latitude: step.location?.lat,
        longitude: step.location?.lon,
        countryCode: countryCode?.length === 2 ? countryCode : undefined,
      };
    });

    const { count } = await this.prisma.stop.createMany({ data });
    return count;
  }
}

function parseLocations(buffer: Buffer): PolarstepsLocation[] {
  const parsed = JSON.parse(buffer.toString('utf8')) as unknown;
  // Both layouts exist in the wild: a bare array, or { locations: [...] }.
  const list = Array.isArray(parsed)
    ? parsed
    : ((parsed as { locations?: unknown[] }).locations ?? []);

  return (list as PolarstepsLocation[])
    .filter(
      (p) =>
        typeof p?.lat === 'number' &&
        typeof p?.lon === 'number' &&
        typeof p?.time === 'number' &&
        Math.abs(p.lat) <= 90 &&
        Math.abs(p.lon) <= 180,
    )
    .slice(0, MAX_POINTS_PER_TRIP);
}

function earliest(points: PolarstepsLocation[]): Date | undefined {
  return points.length ? new Date(Math.min(...points.map((p) => p.time)) * 1000) : undefined;
}

function latest(points: PolarstepsLocation[]): Date | undefined {
  return points.length ? new Date(Math.max(...points.map((p) => p.time)) * 1000) : undefined;
}
