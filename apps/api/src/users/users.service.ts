import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AccountStatus, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { assertStrongPassword } from '../auth/password-strength';
import { revokeAllSessions } from '../auth/sessions';
import { coded } from '../common/i18n';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, type FlightEnd, isoDay, LEG_NAMES, PLAN_STOP_SELECT, planTrip } from '../trips/trip-schedule';
import { USERNAME_PATTERN } from './dto/profile.dto';

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
  /** Photos on the days they were on their trips, whoever took them. */
  photoCount: number;
  /** Only the photos they added themselves, for the setting that wants that. */
  ownPhotoCount: number;
  recent: {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    color: string | null;
  }[];
  /** What is behind the tiles, one list per number, counted from the same days. */
  lists: TravelLists;
}

/** One stretch of one trip, to go and look at. */
export interface TravelVisit {
  tripId: string;
  tripTitle: string;
  /** The stop to land on in that trip's timeline. */
  stopId: string;
  from: string;
  to: string;
}

export interface TravelLists {
  trips: {
    id: string;
    title: string;
    color: string | null;
    from: string;
    to: string;
    days: number;
    km: number;
    photos: number;
  }[];
  /** As many as `places`: going back to a city is one more visit, not a place. */
  places: { name: string; countryCode: string | null; visits: TravelVisit[] }[];
  /** As many as `countries`, with every trip that went there. */
  countries: { code: string; visits: (TravelVisit & { places: string[] })[] }[];
  /** As many as `flights`, newest first. */
  flights: {
    tripId: string;
    tripTitle: string;
    stopId: string;
    day: string;
    from: FlightEnd;
    to: FlightEnd;
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
        throw new ConflictException(coded('This username is taken', 'signup.usernameTaken'));
      }
    }
    const updated = await this.prisma.user
      .update({
        where: { id },
        data: { displayName: displayName.trim(), username: normalizedUsername },
        select: PUBLIC_USER_SELECT,
      })
      .catch((err: unknown) => {
        // Someone else took it between the check above and this write.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException(coded('This username is taken', 'signup.usernameTaken'));
        }
        throw err;
      });
    return toPublic(updated);
  }

  /** Whether this user could take `name` as their username right now. */
  async usernameAvailable(id: string, name: string): Promise<boolean> {
    const normalized = name.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(normalized)) return false;
    const taken = await this.prisma.user.findFirst({
      where: { username: normalized, id: { not: id } },
      select: { id: true },
    });
    return !taken;
  }

  async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    const valid = await argon2.verify(user.passwordHash, currentPassword).catch(() => false);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    assertStrongPassword(newPassword, [
      user.username,
      user.displayName,
      user.email.split('@')[0] ?? null,
    ]);
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await argon2.hash(newPassword, { type: argon2.argon2id }),
        mustChangePassword: false,
      },
    });
    // Changing the password invalidates every other session.
    await revokeAllSessions(this.prisma, id);
  }

  /**
   * Everyone you share at least one trip with. Never exposes their email.
   *
   * The count is of trips you both travelled on: a trip one of you only
   * followed as a guest keeps the other in the list, but was not together.
   */
  async listFriends(id: string): Promise<Friend[]> {
    const [rows, mine] = await Promise.all([
      this.prisma.tripMember.findMany({
        where: {
          userId: { not: id },
          trip: { members: { some: { userId: id } } },
        },
        include: {
          user: {
            select: { id: true, username: true, displayName: true, avatarMime: true },
          },
        },
      }),
      this.prisma.tripMember.findMany({ where: { userId: id }, select: { tripId: true, role: true } }),
    ]);
    const myRole = new Map(mine.map((m) => [m.tripId, m.role]));

    const byUser = new Map<string, Friend>();
    for (const row of rows) {
      const together = row.role !== 'GUEST' && myRole.get(row.tripId) !== 'GUEST' ? 1 : 0;
      const existing = byUser.get(row.userId);
      if (existing) {
        existing.sharedTrips += together;
        continue;
      }
      const { avatarMime, ...user } = row.user;
      byUser.set(row.userId, { ...user, hasAvatar: avatarMime !== null, sharedTrips: together });
    }
    return [...byUser.values()].sort((a, b) => b.sharedTrips - a.sharedTrips);
  }

  /**
   * A traveller's numbers, over every trip they are a member of.
   *
   * Only for people you actually travel with: someone else's history is not
   * public just because you both have an account here. Photos count that
   * person's own; days, countries, flights and distance count the trips they
   * were on, because those are shared by definition: a friend who never
   * tracked still travelled the route somebody else kept. A companion who was
   * only there for part of a trip gets only those days.
   *
   * Guests are left out of their own totals. Being invited to look at a trip
   * is not the same as having been on it, and counting a grandmother's fifteen
   * days in Vietnam because she followed along is simply wrong.
   */
  async travelStats(viewerId: string, targetId: string): Promise<TravelStats> {
    let sharedTrips = 0;
    if (viewerId !== targetId) {
      // Seeing somebody's numbers takes any trip in common, a guest's too;
      // "trips together" counts only the ones you both travelled on.
      const common = await this.prisma.tripMember.findMany({
        where: { userId: targetId, trip: { members: { some: { userId: viewerId } } } },
        select: { role: true, trip: { select: { members: { where: { userId: viewerId }, select: { role: true } } } } },
      });
      if (common.length === 0) throw new NotFoundException('User not found');
      sharedTrips = common.filter(
        (m) => m.role !== 'GUEST' && m.trip.members[0]?.role !== 'GUEST',
      ).length;
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, username: true, displayName: true, avatarMime: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const trips = await this.prisma.trip.findMany({
      where: { members: { some: { userId: targetId, role: { not: 'GUEST' } } } },
      select: {
        id: true,
        title: true,
        startDate: true,
        endDate: true,
        color: true,
        members: { where: { userId: targetId }, select: { fromDate: true, toDate: true } },
        stops: { select: PLAN_STOP_SELECT },
      },
      orderBy: { startDate: 'desc' },
    });
    const ownPhotoCount = await this.prisma.mediaRef.count({ where: { userId: targetId } });

    const today = new Date().toISOString().slice(0, 10);
    // A trip you have not left for yet is a plan, not a place you have been.
    // It keeps its dot on the globe and its card on the homepage; it just does
    // not get to claim countries, days or flights before it happens.
    const travelled = trips.filter((t) => t.startDate.toISOString().slice(0, 10) <= today);

    const countries = new Set<string>();
    // Places are counted across trips, not per trip: going back to Stockholm
    // three times is one place you have been.
    const places = new Set<string>();
    let flights = 0;
    // The lists behind the tiles come out of this same loop, so a tile that
    // says 23 never opens a list of 24.
    const lists: TravelLists = { trips: [], places: [], countries: [], flights: [] };
    const placeRows = new Map<string, TravelLists['places'][number]>();
    const countryRows = new Map<string, TravelLists['countries'][number]>();
    let days = 0;
    let ongoing = 0;
    let km = 0;
    let photoCount = 0;
    for (const trip of travelled) {
      // The days this person was there: the whole trip, or the part they were
      // on when they came later or went home sooner. Everything below counts
      // only these days, distance too, which is the trip's own, tracked by
      // whoever tracked it: travelling with somebody who keeps the route is
      // still having travelled it.
      const first = isoDay(trip.startDate);
      const last = isoDay(trip.endDate);
      const member = trip.members[0];
      const from = member?.fromDate && isoDay(member.fromDate) > first ? isoDay(member.fromDate) : first;
      const to = member?.toDate && isoDay(member.toDate) < last ? isoDay(member.toDate) : last;
      const inside = (day: string) => day >= from && day <= to;

      const plan = planTrip(trip.stops, trip.startDate);
      // In the order they were visited, so a trip's first stop in a country
      // is the one its row lands on.
      const visits = [...plan.visits].sort((a, b) => a.from.localeCompare(b.from));
      for (const visit of visits) {
        if (visit.to < from || visit.from > to) continue;
        const code = visit.stop.countryCode?.toUpperCase();
        const stretch: TravelVisit = {
          tripId: trip.id,
          tripTitle: trip.title,
          stopId: visit.stop.id,
          from: visit.from > from ? visit.from : from,
          to: visit.to < to ? visit.to : to,
        };
        const isPlace = !LEG_NAMES.has(visit.stop.name);
        if (code && code !== HOME_COUNTRY) {
          countries.add(code);
          const row = countryRows.get(code) ?? { code, visits: [] };
          countryRows.set(code, row);
          const here = row.visits.find((v) => v.tripId === trip.id);
          if (here) {
            if (stretch.to > here.to) here.to = stretch.to;
            if (isPlace && !here.places.includes(visit.stop.name)) here.places.push(visit.stop.name);
          } else {
            row.visits.push({ ...stretch, places: isPlace ? [visit.stop.name] : [] });
          }
        }
        if (isPlace) {
          const key = `${code ?? ''}/${visit.stop.name.trim().toLowerCase()}`;
          places.add(key);
          const row = placeRows.get(key) ?? { name: visit.stop.name.trim(), countryCode: code ?? null, visits: [] };
          placeRows.set(key, row);
          // A city split over two stops in one trip is one visit to it.
          const again = row.visits.find((v) => v.tripId === trip.id);
          if (again) {
            if (stretch.to > again.to) again.to = stretch.to;
          } else {
            row.visits.push(stretch);
          }
        }
      }
      const flown = plan.flights.filter((f) => inside(f.day));
      flights += flown.length;
      for (const flight of flown) {
        lists.flights.push({ tripId: trip.id, tripTitle: trip.title, ...flight });
      }
      const tripStart = km;
      km += plan.extras.filter((e) => inside(e.day)).reduce((sum, e) => sum + e.km, 0);

      const [tracked] = await this.prisma.$queryRaw<{ meters: number | null }[]>`
        SELECT ST_Length(ST_MakeLine(geom ORDER BY "recordedAt")::geography) AS meters
        FROM location_points
        WHERE "tripId" = ${trip.id}::uuid
          AND "recordedAt" >= ${new Date(`${from}T00:00:00Z`)}
          AND "recordedAt" < ${new Date(`${addDays(to, 1)}T00:00:00Z`)}
      `;
      km += (tracked?.meters ?? 0) / 1000;
      // Often one person takes the pictures for everyone.
      const photos = await this.prisma.mediaRef.count({
        where: {
          tripId: trip.id,
          takenAt: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${addDays(to, 1)}T00:00:00Z`) },
        },
      });
      photoCount += photos;

      const tripDays = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
      days += tripDays;
      if (from <= today && to >= today) ongoing += 1;
      lists.trips.push({
        id: trip.id,
        title: trip.title,
        color: trip.color,
        from,
        to,
        days: tripDays,
        km: Math.round(km - tripStart),
        photos,
      });
    }
    // Trips come newest first, and so do the visits inside each row; the
    // places themselves too, by when you were last there.
    lists.places = [...placeRows.values()];
    lists.countries = [...countryRows.values()].sort((a, b) => a.code.localeCompare(b.code));
    lists.flights.sort((a, b) => b.day.localeCompare(a.day));

    return {
      user: {
        id: target.id,
        username: target.username,
        displayName: target.displayName,
        hasAvatar: target.avatarMime !== null,
      },
      sharedTrips,
      trips: travelled.length,
      ongoing,
      days,
      countries: [...countries].sort(),
      places: places.size,
      flights,
      distanceKm: Math.round(km),
      photoCount,
      ownPhotoCount,
      recent: travelled.slice(0, 5).map((t) => ({
        id: t.id,
        title: t.title,
        startDate: t.startDate.toISOString().slice(0, 10),
        endDate: t.endDate.toISOString().slice(0, 10),
        color: t.color,
      })),
      lists,
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
        // An account still waiting for an admin (or refused) cannot be put on a
        // trip, so offering it would only be a name that fails on Add.
        status: AccountStatus.APPROVED,
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
