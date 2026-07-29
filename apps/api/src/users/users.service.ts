import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: 'ADMIN' | 'USER';
  mustChangePassword: boolean;
  hasAvatar: boolean;
  createdAt: Date;
}

export interface Friend {
  id: string;
  username: string;
  displayName: string;
  hasAvatar: boolean;
  /** How many trips you have been on together. */
  sharedTrips: number;
}

/** Everything the profile screen shows about one traveller. */
export interface TravelStats {
  /** Who this is about, so the page can stand on its own URL. */
  user: {
    id: string;
    username: string;
    displayName: string;
    hasAvatar: boolean;
  };
  /** Trips you and this traveller have both been on (0 when it is yourself). */
  sharedTrips: number;
  trips: number;
  ongoing: number;
  days: number;
  countries: string[];
  /** Distinct places stopped at, day trips included. */
  places: number;
  /** Legs flown, counted per trip leg rather than per airport. */
  flights: number;
  distanceKm: number;
  photoCount: number;
  recent: {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    color: string | null;
  }[];
}

/** Your own country doesn't count as one you visited. */
const HOME_COUNTRY = 'NL';

export interface UserSuggestion {
  id: string;
  username: string;
  displayName: string;
  hasAvatar: boolean;
  /** Trips you already share — companions are offered first. */
  sharedTrips: number;
}

const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  role: true,
  mustChangePassword: true,
  avatarMime: true,
  createdAt: true,
} as const;

type SelectedUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: 'ADMIN' | 'USER';
  mustChangePassword: boolean;
  avatarMime: string | null;
  createdAt: Date;
};

function toPublic(user: SelectedUser): PublicUser {
  const { avatarMime, ...rest } = user;
  return { ...rest, hasAvatar: avatarMime !== null };
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: PUBLIC_USER_SELECT,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return toPublic(user);
  }

  async setAvatar(id: string, buffer: Buffer, mime: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      // Explicit copy into a plain Uint8Array: Prisma's Bytes type does not
      // accept Node's Buffer<ArrayBufferLike> under strict TS.
      data: { avatar: new Uint8Array(buffer), avatarMime: mime },
    });
  }

  async removeAvatar(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { avatar: null, avatarMime: null },
    });
  }

  async getAvatar(id: string): Promise<{ buffer: Buffer; mime: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { avatar: true, avatarMime: true },
    });
    if (!user?.avatar || !user.avatarMime) {
      throw new NotFoundException('No avatar');
    }
    return { buffer: Buffer.from(user.avatar), mime: user.avatarMime };
  }

  async updateProfile(id: string, displayName: string, username?: string): Promise<PublicUser> {
    const normalizedUsername = username?.trim().toLowerCase();
    if (normalizedUsername) {
      const taken = await this.prisma.user.findFirst({
        where: { username: normalizedUsername, id: { not: id } },
      });
      if (taken) {
        throw new ConflictException('This username is taken');
      }
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { displayName: displayName.trim(), username: normalizedUsername },
      select: PUBLIC_USER_SELECT,
    });
    return toPublic(updated);
  }

  async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    const valid = await argon2.verify(user.passwordHash, currentPassword).catch(() => false);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await argon2.hash(newPassword, { type: argon2.argon2id }),
        mustChangePassword: false,
      },
    });
    // Changing the password invalidates every other session.
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Everyone you share at least one trip with. Never exposes their email. */
  async listFriends(id: string): Promise<Friend[]> {
    const rows = await this.prisma.tripMember.findMany({
      where: {
        userId: { not: id },
        trip: { members: { some: { userId: id } } },
      },
      include: {
        user: {
          select: { id: true, username: true, displayName: true, avatarMime: true },
        },
      },
    });

    const byUser = new Map<string, Friend>();
    for (const row of rows) {
      const existing = byUser.get(row.userId);
      if (existing) {
        existing.sharedTrips++;
        continue;
      }
      const { avatarMime, ...user } = row.user;
      byUser.set(row.userId, { ...user, hasAvatar: avatarMime !== null, sharedTrips: 1 });
    }
    return [...byUser.values()].sort((a, b) => b.sharedTrips - a.sharedTrips);
  }

  /**
   * A traveller's numbers, over every trip they are a member of.
   *
   * Only for people you actually travel with: someone else's history is not
   * public just because you both have an account here. Distance and photos
   * count that person's own contribution; days and countries count the trips
   * they were on, because those are shared by definition.
   */
  async travelStats(viewerId: string, targetId: string): Promise<TravelStats> {
    let sharedTrips = 0;
    if (viewerId !== targetId) {
      sharedTrips = await this.prisma.tripMember.count({
        where: { userId: targetId, trip: { members: { some: { userId: viewerId } } } },
      });
      if (sharedTrips === 0) throw new NotFoundException('User not found');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, username: true, displayName: true, avatarMime: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const trips = await this.prisma.trip.findMany({
      where: { members: { some: { userId: targetId } } },
      select: {
        id: true,
        title: true,
        startDate: true,
        endDate: true,
        color: true,
        stops: { select: { countryCode: true, name: true, travelMode: true } },
      },
      orderBy: { startDate: 'desc' },
    });

    const [distanceRow] = await this.prisma.$queryRaw<{ meters: number | null }[]>`
      SELECT SUM(len) AS meters FROM (
        SELECT ST_Length(ST_MakeLine(geom ORDER BY "recordedAt")::geography) AS len
        FROM location_points
        WHERE "userId" = ${targetId}::uuid
        GROUP BY "tripId"
      ) x
    `;
    const photoCount = await this.prisma.mediaRef.count({ where: { userId: targetId } });

    const countries = new Set<string>();
    // Places are counted across trips, not per trip: going back to Stockholm
    // three times is one place you have been.
    const places = new Set<string>();
    let flights = 0;
    let days = 0;
    let ongoing = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const trip of trips) {
      for (const stop of trip.stops) {
        const code = stop.countryCode?.toUpperCase();
        if (code && code !== HOME_COUNTRY) countries.add(code);
        places.add(`${code ?? ''}/${stop.name.trim().toLowerCase()}`);
        if (stop.travelMode === 'FLIGHT') flights += 1;
      }
      days +=
        Math.round((trip.endDate.getTime() - trip.startDate.getTime()) / 86_400_000) + 1;
      const from = trip.startDate.toISOString().slice(0, 10);
      const to = trip.endDate.toISOString().slice(0, 10);
      if (from <= today && to >= today) ongoing += 1;
    }

    return {
      user: {
        id: target.id,
        username: target.username,
        displayName: target.displayName,
        hasAvatar: target.avatarMime !== null,
      },
      sharedTrips,
      trips: trips.length,
      ongoing,
      days,
      countries: [...countries].sort(),
      places: places.size,
      flights,
      distanceKm: Math.round((distanceRow?.meters ?? 0) / 1000),
      photoCount,
      recent: trips.slice(0, 5).map((t) => ({
        id: t.id,
        title: t.title,
        startDate: t.startDate.toISOString().slice(0, 10),
        endDate: t.endDate.toISOString().slice(0, 10),
        color: t.color,
      })),
    };
  }

  /**
   * Who to offer when adding someone to a trip. With no query that's the people
   * you already travel with, so the field is useful the moment it's focused;
   * once you type it searches every account by handle or name.
   */
  async suggestUsers(id: string, query = '', limit = 6): Promise<UserSuggestion[]> {
    const q = query.trim().replace(/^@/, '');
    const friends = await this.listFriends(id);
    const sharedByUser = new Map(friends.map((f) => [f.id, f.sharedTrips]));

    const rows = await this.prisma.user.findMany({
      where: {
        id: { not: id },
        ...(q
          ? {
              OR: [
                { username: { contains: q, mode: 'insensitive' as const } },
                { displayName: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : { id: { in: [...sharedByUser.keys()] } }),
      },
      select: { id: true, username: true, displayName: true, avatarMime: true },
      take: 40,
    });

    return rows
      .map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        hasAvatar: r.avatarMime !== null,
        sharedTrips: sharedByUser.get(r.id) ?? 0,
      }))
      // Travel companions first, then alphabetically.
      .sort(
        (a, b) =>
          b.sharedTrips - a.sharedTrips || a.displayName.localeCompare(b.displayName),
      )
      .slice(0, limit);
  }
}
