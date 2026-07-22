import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Trip, TripRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';

export type TripMemberView = {
  userId: string;
  role: TripRole;
  user: { displayName: string; username: string; hasAvatar: boolean };
};
export type TripWithMembers = Trip & {
  members: TripMemberView[];
  /** coverMediaId when set, else the first trip photo — for the card cover. */
  resolvedCoverId: string | null;
  /** [lng, lat] anchor for the globe, if any stop has coordinates. */
  anchor: [number, number] | null;
  /** Route distance in km (0 when unknown); only populated by listForUser. */
  distanceKm?: number;
};

const MEMBERS_INCLUDE = {
  members: {
    include: { user: { select: { displayName: true, username: true, avatarMime: true } } },
  },
  // One photo to fall back on as an automatic cover.
  mediaRefs: {
    take: 1,
    orderBy: { takenAt: 'asc' },
    select: { id: true },
  },
  // A geo anchor for the globe overview: prefer a planned stop's city.
  stops: {
    where: { latitude: { not: null } },
    take: 1,
    orderBy: { orderIndex: 'asc' },
    select: { latitude: true, longitude: true },
  },
} as const;

export interface TripStats {
  distanceKm: number;
  countries: string[];
  days: number;
  photoCount: number;
}

type RawStop = { latitude: number | null; longitude: number | null };

type RawTripRow = Trip & {
  members: RawMember[];
  mediaRefs: { id: string }[];
  stops: RawStop[];
};

/** Maps Prisma rows (avatarMime, mediaRefs, stops) to the API shape. */
function mapMembers(trip: RawTripRow): TripWithMembers {
  const { mediaRefs, stops, members, ...rest } = trip;
  const stop = stops[0];
  const anchor: [number, number] | null =
    stop?.latitude != null && stop.longitude != null ? [stop.longitude, stop.latitude] : null;
  return {
    ...rest,
    resolvedCoverId: trip.coverMediaId ?? mediaRefs[0]?.id ?? null,
    anchor,
    members: members.map((m) => ({
      userId: m.userId,
      role: m.role,
      user: {
        displayName: m.user.displayName,
        username: m.user.username,
        hasAvatar: m.user.avatarMime !== null,
      },
    })),
  };
}

type RawMember = {
  userId: string;
  role: TripRole;
  user: { displayName: string; username: string; avatarMime: string | null };
};

@Injectable()
export class TripsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, dto: CreateTripDto): Promise<TripWithMembers> {
    const { startDate, endDate } = parseDates(dto.startDate, dto.endDate);
    const trip = await this.prisma.trip.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim(),
        startDate,
        endDate,
        ownerId,
        members: { create: { userId: ownerId, role: TripRole.OWNER } },
      },
      include: MEMBERS_INCLUDE,
    });
    return mapMembers(trip);
  }

  async listForUser(userId: string): Promise<TripWithMembers[]> {
    const trips = await this.prisma.trip.findMany({
      where: { members: { some: { userId } } },
      orderBy: { startDate: 'desc' },
      include: MEMBERS_INCLUDE,
    });
    if (trips.length === 0) return [];

    // One grouped query for route distance per trip (cheap panel stat).
    const distances = await this.prisma.$queryRaw<{ tripId: string; meters: number | null }[]>`
      SELECT "tripId", ST_Length(ST_MakeLine(geom ORDER BY "recordedAt")::geography) AS meters
      FROM location_points
      WHERE "tripId" = ANY(${trips.map((t) => t.id)}::uuid[])
      GROUP BY "tripId"
    `;
    const kmByTrip = new Map(
      distances.map((d) => [d.tripId, Math.round((d.meters ?? 0) / 1000)]),
    );

    return trips.map((t) => ({ ...mapMembers(t), distanceKm: kmByTrip.get(t.id) ?? 0 }));
  }

  /** Returns the trip if `userId` is a member; 404 otherwise (no existence leak). */
  async getForMember(tripId: string, userId: string): Promise<TripWithMembers> {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, members: { some: { userId } } },
      include: MEMBERS_INCLUDE,
    });
    if (!trip) {
      throw new NotFoundException('Trip not found');
    }
    return mapMembers(trip);
  }

  async update(tripId: string, userId: string, dto: UpdateTripDto): Promise<TripWithMembers> {
    const trip = await this.getForMember(tripId, userId);
    this.assertOwner(trip, userId);

    const { startDate, endDate } = parseDates(
      dto.startDate ?? trip.startDate.toISOString(),
      dto.endDate ?? trip.endDate.toISOString(),
    );

    // Cover must reference a photo that actually belongs to this trip.
    if (dto.coverMediaId) {
      const media = await this.prisma.mediaRef.findFirst({
        where: { id: dto.coverMediaId, tripId },
      });
      if (!media) {
        throw new BadRequestException('coverMediaId is not a photo of this trip');
      }
    }

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        title: dto.title?.trim(),
        description: dto.description?.trim(),
        startDate,
        endDate,
        ...(dto.coverMediaId !== undefined ? { coverMediaId: dto.coverMediaId } : {}),
        ...(dto.autoTrack !== undefined ? { autoTrack: dto.autoTrack } : {}),
      },
      include: MEMBERS_INCLUDE,
    });
    return mapMembers(updated);
  }

  /** Headline numbers for the trip: distance, countries, days, photos. */
  async getStats(tripId: string, userId: string): Promise<TripStats> {
    const trip = await this.getForMember(tripId, userId);

    const [distanceRow] = await this.prisma.$queryRaw<{ meters: number | null }[]>`
      SELECT ST_Length(
        ST_MakeLine(geom ORDER BY "recordedAt")::geography
      ) AS meters
      FROM location_points
      WHERE "tripId" = ${tripId}::uuid
    `;

    const [photoCount, stopCountries] = await Promise.all([
      this.prisma.mediaRef.count({ where: { tripId } }),
      this.prisma.stop.findMany({
        where: { tripId, countryCode: { not: null } },
        select: { countryCode: true },
        distinct: ['countryCode'],
      }),
    ]);

    const days =
      Math.round(
        (trip.endDate.getTime() - trip.startDate.getTime()) / 86_400_000,
      ) + 1;

    return {
      distanceKm: Math.round((distanceRow?.meters ?? 0) / 1000),
      countries: stopCountries.map((s) => s.countryCode!).filter(Boolean),
      days,
      photoCount,
    };
  }

  async remove(tripId: string, userId: string): Promise<void> {
    const trip = await this.getForMember(tripId, userId);
    this.assertOwner(trip, userId);
    await this.prisma.trip.delete({ where: { id: tripId } });
  }

  async addMemberByUsername(
    tripId: string,
    userId: string,
    username: string,
  ): Promise<TripWithMembers> {
    const trip = await this.getForMember(tripId, userId);
    this.assertOwner(trip, userId);

    const invitee = await this.prisma.user.findUnique({
      where: { username: username.trim().toLowerCase().replace(/^@/, '') },
    });
    if (!invitee) {
      throw new NotFoundException('No account with that username on this server');
    }

    await this.prisma.tripMember.upsert({
      where: { tripId_userId: { tripId, userId: invitee.id } },
      create: { tripId, userId: invitee.id, role: TripRole.MEMBER },
      update: {},
    });

    return this.getForMember(tripId, userId);
  }

  async removeMember(tripId: string, userId: string, memberId: string): Promise<void> {
    const trip = await this.getForMember(tripId, userId);
    // Owners can remove anyone; members may remove themselves (leave).
    if (userId !== memberId) {
      this.assertOwner(trip, userId);
    }
    if (memberId === trip.ownerId) {
      throw new BadRequestException('The owner cannot leave their own trip');
    }
    await this.prisma.tripMember.delete({
      where: { tripId_userId: { tripId, userId: memberId } },
    });
  }

  private assertOwner(trip: Trip, userId: string): void {
    if (trip.ownerId !== userId) {
      throw new ForbiddenException('Only the trip owner can do this');
    }
  }
}

function parseDates(start: string, end: string): { startDate: Date; endDate: Date } {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (endDate < startDate) {
    throw new BadRequestException('endDate must be on or after startDate');
  }
  return { startDate, endDate };
}
