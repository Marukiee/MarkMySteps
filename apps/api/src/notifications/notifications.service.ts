import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessRequestStatus,
  NotificationKind,
  Prisma,
  TripRole,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/** One line under the bell, with everything the app needs to draw it. */
export interface NotificationView {
  id: string;
  kind: NotificationKind;
  createdAt: string;
  read: boolean;
  actor: { id: string; displayName: string; username: string; hasAvatar: boolean } | null;
  trip: { id: string; title: string } | null;
  /** Present on ACCESS_REQUESTED; null once the request has been answered. */
  request: { id: string; status: AccessRequestStatus; message: string | null } | null;
}

/** What the "no access" screen is allowed to say about a trip you can't open. */
export interface TripAccessPreview {
  tripId: string;
  title: string;
  startDate: string;
  endDate: string;
  owner: { id: string; displayName: string; username: string; hasAvatar: boolean };
  /** Where you stand: not asked, waiting, refused, or already on the trip. */
  status: 'NONE' | 'PENDING' | 'APPROVED' | 'DENIED' | 'MEMBER';
}

/** What a polling phone is told. Deliberately small. */
export interface DevicePoll {
  unread: number;
  pending: number;
  /** The newest thing this phone has not been told about yet. */
  latest: { id: string; title: string; body: string; tripId: string | null } | null;
}

const NOTIFICATION_INCLUDE = {
  actor: { select: { id: true, displayName: true, username: true, avatarMime: true } },
  trip: { select: { id: true, title: true } },
  request: { select: { id: true, status: true, message: true } },
} satisfies Prisma.NotificationInclude;

type NotificationRow = Prisma.NotificationGetPayload<{ include: typeof NOTIFICATION_INCLUDE }>;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- The bell -----------------------------------------------------------

  async list(userId: string): Promise<NotificationView[]> {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 60,
      include: NOTIFICATION_INCLUDE,
    });
    return rows.map(toView);
  }

  /** The number on the bell: what you have not looked at yet. */
  async unreadCount(userId: string): Promise<{ unread: number; pending: number }> {
    const [unread, pending] = await Promise.all([
      this.prisma.notification.count({ where: { userId, readAt: null } }),
      // An unanswered request keeps the bell interesting even after you have
      // read it — it is a question, and it is still open.
      this.prisma.notification.count({
        where: {
          userId,
          kind: NotificationKind.ACCESS_REQUESTED,
          request: { status: AccessRequestStatus.PENDING },
        },
      }),
    ]);
    return { unread, pending };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (count === 0) {
      // Already read, or not yours — same answer either way, and saying which
      // would tell a stranger their guess at an id was right.
      const exists = await this.prisma.notification.count({ where: { id, userId } });
      if (exists === 0) throw new NotFoundException('Notification not found');
    }
  }

  async markAllRead(userId: string): Promise<{ read: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { read: count };
  }

  /** Dismissing one for good — an answered request has nothing left to say. */
  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.notification.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Notification not found');
  }

  /** Somebody put you on their trip. Called from the trips service. */
  async tripAdded(userIds: string[], tripId: string, actorId: string): Promise<void> {
    const targets = userIds.filter((id) => id !== actorId);
    if (targets.length === 0) return;
    await this.prisma.notification.createMany({
      data: targets.map((userId) => ({
        userId,
        kind: NotificationKind.TRIP_ADDED,
        actorId,
        tripId,
      })),
    });
  }

  // ---- Phones that ask for themselves --------------------------------------

  /**
   * Hands a phone a token of its own.
   *
   * One per registration; registering again replaces whatever that phone had,
   * so a reinstall does not leave a live token behind. The raw value is
   * returned exactly once and never stored.
   */
  async registerDevice(userId: string): Promise<{ token: string }> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.notificationDevice.create({
      data: { userId, tokenHash: hashToken(token) },
    });
    // Two per account is already a phone and a tablet; more than that is a
    // string of reinstalls, and the old ones are dead weight that can still be
    // used. Keep the newest few.
    const stale = await this.prisma.notificationDevice.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: 4,
      select: { id: true },
    });
    if (stale.length > 0) {
      await this.prisma.notificationDevice.deleteMany({
        where: { id: { in: stale.map((d) => d.id) } },
      });
    }
    return { token };
  }

  async unregisterDevice(userId: string, token?: string): Promise<void> {
    await this.prisma.notificationDevice.deleteMany({
      where: { userId, ...(token ? { tokenHash: hashToken(token) } : {}) },
    });
  }

  /**
   * "Anything new?", asked by a background worker with no session.
   *
   * Answers with the counts and one line of text, and remembers what it said,
   * so the phone is never told the same thing twice. An unknown token is a
   * plain 404 — it says nothing about whether it was ever valid.
   */
  async pollDevice(token: string): Promise<DevicePoll> {
    const device = await this.prisma.notificationDevice.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, userId: true, lastSeenId: true },
    });
    if (!device) throw new NotFoundException('Unknown device');

    const [{ unread, pending }, newest] = await Promise.all([
      this.unreadCount(device.userId),
      this.prisma.notification.findFirst({
        where: { userId: device.userId },
        orderBy: { createdAt: 'desc' },
        include: NOTIFICATION_INCLUDE,
      }),
    ]);

    await this.prisma.notificationDevice.update({
      where: { id: device.id },
      data: { lastPolledAt: new Date(), lastSeenId: newest?.id ?? device.lastSeenId },
    });

    // Already told about it, or nothing there at all.
    const fresh = newest && newest.id !== device.lastSeenId && newest.readAt === null;
    return {
      unread,
      pending,
      latest: fresh
        ? {
            id: newest.id,
            title: titleFor(newest),
            body: bodyFor(newest),
            tripId: newest.tripId,
          }
        : null,
    };
  }

  // ---- Asking to be let in ------------------------------------------------

  /**
   * What a trip you cannot open may tell you about itself.
   *
   * Only for trips whose travellers you already travel with: a friend's recent
   * trips are listed on their traveller page, which is where the tap that gets
   * you here comes from. Anything else is a plain 404 — the same answer as a
   * trip id that does not exist, so this can't be used to find out that one
   * does.
   */
  async preview(tripId: string, userId: string): Promise<TripAccessPreview> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true,
        title: true,
        startDate: true,
        endDate: true,
        ownerId: true,
        owner: { select: { id: true, displayName: true, username: true, avatarMime: true } },
        members: { select: { userId: true, role: true } },
      },
    });
    if (!trip) throw new NotFoundException('Trip not found');

    const me = trip.members.find((m) => m.userId === userId);
    if (me) {
      // Already on it — the app should simply open the trip.
      return {
        tripId: trip.id,
        title: trip.title,
        startDate: trip.startDate.toISOString().slice(0, 10),
        endDate: trip.endDate.toISOString().slice(0, 10),
        owner: toOwner(trip.owner),
        status: 'MEMBER',
      };
    }

    await this.assertMaySee(trip.members, userId);

    const request = await this.prisma.tripAccessRequest.findUnique({
      where: { tripId_userId: { tripId, userId } },
      select: { status: true },
    });

    return {
      tripId: trip.id,
      title: trip.title,
      startDate: trip.startDate.toISOString().slice(0, 10),
      endDate: trip.endDate.toISOString().slice(0, 10),
      owner: toOwner(trip.owner),
      status: request?.status ?? 'NONE',
    };
  }

  /**
   * Ask the owner for access.
   *
   * Re-asking after a refusal is allowed — people change their minds — and
   * simply reopens the same row, so one person can never pile up requests.
   */
  async request(
    tripId: string,
    userId: string,
    message?: string,
  ): Promise<{ status: AccessRequestStatus }> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { id: true, ownerId: true, members: { select: { userId: true, role: true } } },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.members.some((m) => m.userId === userId)) {
      throw new BadRequestException('Je zit al op deze reis');
    }
    await this.assertMaySee(trip.members, userId);

    const clean = message?.trim().slice(0, 300) || null;
    const existing = await this.prisma.tripAccessRequest.findUnique({
      where: { tripId_userId: { tripId, userId } },
    });
    if (existing?.status === AccessRequestStatus.PENDING) {
      return { status: AccessRequestStatus.PENDING };
    }

    const request = await this.prisma.tripAccessRequest.upsert({
      where: { tripId_userId: { tripId, userId } },
      create: { tripId, userId, message: clean },
      update: {
        status: AccessRequestStatus.PENDING,
        message: clean,
        decidedAt: null,
        decidedById: null,
        grantedRole: null,
      },
    });

    // The owner is asked once per open request: the old notification for a
    // refused ask is gone, so re-asking is a new line rather than a silent
    // change to one they have already scrolled past.
    await this.prisma.notification.deleteMany({ where: { requestId: request.id } });
    await this.prisma.notification.create({
      data: {
        userId: trip.ownerId,
        kind: NotificationKind.ACCESS_REQUESTED,
        actorId: userId,
        tripId,
        requestId: request.id,
      },
    });
    return { status: AccessRequestStatus.PENDING };
  }

  /**
   * The owner answers. Approving adds the member; either way the person who
   * asked is told, and the owner's own notification stops being a question.
   */
  async decide(
    requestId: string,
    ownerId: string,
    approve: boolean,
    role: TripRole = TripRole.GUEST,
  ): Promise<{ status: AccessRequestStatus }> {
    const request = await this.prisma.tripAccessRequest.findUnique({
      where: { id: requestId },
      select: { id: true, tripId: true, userId: true, status: true, trip: { select: { ownerId: true } } },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.trip.ownerId !== ownerId) {
      throw new ForbiddenException('Only the trip owner can answer this');
    }
    if (request.status !== AccessRequestStatus.PENDING) {
      throw new BadRequestException('Dit verzoek is al beantwoord');
    }
    if (role === TripRole.OWNER) {
      throw new BadRequestException('A trip has one owner');
    }

    const status = approve ? AccessRequestStatus.APPROVED : AccessRequestStatus.DENIED;
    await this.prisma.$transaction(async (tx) => {
      await tx.tripAccessRequest.update({
        where: { id: request.id },
        data: {
          status,
          grantedRole: approve ? role : null,
          decidedAt: new Date(),
          decidedById: ownerId,
        },
      });
      if (approve) {
        await tx.tripMember.createMany({
          data: [{ tripId: request.tripId, userId: request.userId, role, seen: true }],
          skipDuplicates: true,
        });
      }
      await tx.notification.create({
        data: {
          userId: request.userId,
          kind: approve ? NotificationKind.ACCESS_APPROVED : NotificationKind.ACCESS_DENIED,
          actorId: ownerId,
          tripId: request.tripId,
        },
      });
      // The owner's copy has been dealt with; it stays in the list as history,
      // but it is no longer unread and no longer counts as an open question.
      await tx.notification.updateMany({
        where: { requestId: request.id, userId: ownerId, readAt: null },
        data: { readAt: new Date() },
      });
    });
    return { status };
  }

  /**
   * You may only learn about a trip through the people on it.
   *
   * The traveller page shows a friend's recent trips, and "friend" there means
   * somebody you share a trip with. The same rule decides whether a trip you
   * are not on may show you its name — anything else is a 404.
   */
  private async assertMaySee(
    members: { userId: string; role: TripRole }[],
    userId: string,
  ): Promise<void> {
    const travellers = members.filter((m) => m.role !== TripRole.GUEST).map((m) => m.userId);
    if (travellers.length === 0) throw new NotFoundException('Trip not found');
    const shared = await this.prisma.tripMember.count({
      where: {
        userId: { in: travellers },
        trip: { members: { some: { userId } } },
      },
    });
    if (shared === 0) throw new NotFoundException('Trip not found');
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The heading on the phone's own notification. */
function titleFor(row: NotificationRow): string {
  switch (row.kind) {
    case NotificationKind.ACCESS_REQUESTED:
      return 'Verzoek om toegang';
    case NotificationKind.ACCESS_APPROVED:
      return 'Je mag meekijken';
    case NotificationKind.ACCESS_DENIED:
      return 'Verzoek afgewezen';
    default:
      return 'Toegevoegd aan een reis';
  }
}

/** The same sentence the bell shows, composed here so the phone needs no logic. */
function bodyFor(row: NotificationRow): string {
  const who = row.actor?.displayName ?? 'Iemand';
  const trip = row.trip?.title ?? 'een reis';
  switch (row.kind) {
    case NotificationKind.ACCESS_REQUESTED:
      return `${who} vraagt toegang tot ${trip}.`;
    case NotificationKind.ACCESS_APPROVED:
      return `${who} heeft je toegelaten tot ${trip}.`;
    case NotificationKind.ACCESS_DENIED:
      return `${who} heeft je verzoek voor ${trip} afgewezen.`;
    default:
      return `${who} heeft je toegevoegd aan ${trip}.`;
  }
}

function toOwner(owner: {
  id: string;
  displayName: string;
  username: string;
  avatarMime: string | null;
}): TripAccessPreview['owner'] {
  return {
    id: owner.id,
    displayName: owner.displayName,
    username: owner.username,
    hasAvatar: owner.avatarMime !== null,
  };
}

function toView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    read: row.readAt !== null,
    actor: row.actor
      ? {
          id: row.actor.id,
          displayName: row.actor.displayName,
          username: row.actor.username,
          hasAvatar: row.actor.avatarMime !== null,
        }
      : null,
    trip: row.trip ? { id: row.trip.id, title: row.trip.title } : null,
    request: row.request
      ? { id: row.request.id, status: row.request.status, message: row.request.message }
      : null,
  };
}
