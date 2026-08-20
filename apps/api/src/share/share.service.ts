import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { TripRole } from '@prisma/client';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { TripsService } from '../trips/trips.service';

export interface ShareLinkInfo {
  id: string;
  slug: string;
  url: string; // path only; frontend prefixes its origin
  hasPassword: boolean;
  /**
   * Whether this caller may change the link itself. Travel companions see the
   * links their trip's owner made and can pass them on, but making, revoking
   * and re-passwording one stays with the owner.
   */
  canManage: boolean;
  createdAt: Date;
}

/** Payload of a share session token — read-only access to one trip. */
export interface ShareTokenPayload {
  scope: 'share';
  slug: string;
  tripId: string;
}

const SLUG_BYTES = 12; // 16 base64url chars — unguessable
const SHARE_TOKEN_TTL = '7d';

@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trips: TripsService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
  ) {}

  // ---- Management (trip owner) + reading (travel companions) ----

  async create(tripId: string, userId: string, password?: string): Promise<ShareLinkInfo> {
    const trip = await this.trips.getForMember(tripId, userId);
    if (trip.ownerId !== userId) {
      throw new ForbiddenException('Only the trip owner can create share links');
    }

    const link = await this.prisma.shareLink.create({
      data: {
        tripId,
        slug: randomBytes(SLUG_BYTES).toString('base64url'),
        ...(await this.passwordFields(password ?? null)),
      },
    });
    return toInfo(link, true);
  }

  /**
   * The trip's links, for everybody travelling on it.
   *
   * A companion is on the same trip; when the owner has made a link to send
   * home, they should be able to send it too, rather than asking for it back.
   * A guest was invited to look at this trip and is given nothing to hand on.
   */
  async list(tripId: string, userId: string): Promise<ShareLinkInfo[]> {
    const trip = await this.trips.getForMember(tripId, userId);
    const role = roleOf(trip, userId);
    if (role === TripRole.GUEST) return [];
    const links = await this.prisma.shareLink.findMany({
      where: { tripId },
      orderBy: { createdAt: 'desc' },
    });
    return links.map((link) => toInfo(link, trip.ownerId === userId));
  }

  /**
   * Hands back the password of one link, for the people already on the trip.
   *
   * `password: null` with `recoverable: false` is a link from before passwords
   * were kept recoverable: only its hash exists, so nobody can read it back
   * and the honest answer is to set a new one.
   */
  async revealPassword(
    tripId: string,
    userId: string,
    linkId: string,
  ): Promise<{ password: string | null; recoverable: boolean }> {
    const trip = await this.trips.getForMember(tripId, userId);
    if (roleOf(trip, userId) === TripRole.GUEST) {
      throw new ForbiddenException('Guests cannot see share passwords');
    }
    const link = await this.prisma.shareLink.findFirst({ where: { id: linkId, tripId } });
    if (!link) throw new NotFoundException('Share link not found');
    if (!link.passwordHash) return { password: null, recoverable: true };
    if (!link.passwordEnc) return { password: null, recoverable: false };
    return { password: this.crypto.decrypt(link.passwordEnc), recoverable: true };
  }

  /**
   * Sets or clears a link's password without changing its slug.
   *
   * Rotating the link is the destructive option: everyone who already has it
   * loses access. Deciding afterwards that the link should be protected (or no
   * longer needs to be) is the common case, and it should not cost the URL you
   * already sent round.
   */
  async setPassword(
    tripId: string,
    userId: string,
    linkId: string,
    password: string | null,
  ): Promise<ShareLinkInfo> {
    const trip = await this.trips.getForMember(tripId, userId);
    if (trip.ownerId !== userId) {
      throw new ForbiddenException('Only the trip owner can change share links');
    }
    const link = await this.prisma.shareLink.findFirst({ where: { id: linkId, tripId } });
    if (!link) throw new NotFoundException('Share link not found');

    const updated = await this.prisma.shareLink.update({
      where: { id: link.id },
      data: await this.passwordFields(password),
    });
    return toInfo(updated, true);
  }

  async remove(tripId: string, userId: string, linkId: string): Promise<void> {
    const trip = await this.trips.getForMember(tripId, userId);
    if (trip.ownerId !== userId) {
      throw new ForbiddenException('Only the trip owner can remove share links');
    }
    await this.prisma.shareLink.deleteMany({ where: { id: linkId, tripId } });
  }

  // ---- Public access ----

  /** Basic info shown before unlocking: trip title + whether a password is needed. */
  async publicInfo(slug: string): Promise<{ title: string; hasPassword: boolean }> {
    const link = await this.findBySlug(slug);
    return { title: link.trip.title, hasPassword: link.passwordHash !== null };
  }

  /** Exchanges slug (+ password when set) for a read-only session token. */
  async createSession(slug: string, password?: string): Promise<{ token: string }> {
    const link = await this.findBySlug(slug);

    if (link.passwordHash) {
      const valid = password
        ? await argon2.verify(link.passwordHash, password).catch(() => false)
        : false;
      if (!valid) {
        throw new UnauthorizedException('Wrong password');
      }
    }

    const payload: ShareTokenPayload = { scope: 'share', slug, tripId: link.tripId };
    return { token: await this.jwt.signAsync(payload, { expiresIn: SHARE_TOKEN_TTL }) };
  }

  /** Validates a share token and confirms the link still exists. */
  async verifyToken(token: string): Promise<ShareTokenPayload> {
    let payload: ShareTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<ShareTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid share token');
    }
    if (payload.scope !== 'share') {
      throw new UnauthorizedException('Invalid share token');
    }
    // Revoking the link kills existing sessions too.
    const link = await this.prisma.shareLink.findUnique({ where: { slug: payload.slug } });
    if (!link || link.tripId !== payload.tripId) {
      throw new UnauthorizedException('This share link has been revoked');
    }
    return payload;
  }

  /** Hash to check against, ciphertext to read back. Both cleared together. */
  private async passwordFields(
    password: string | null,
  ): Promise<{ passwordHash: string | null; passwordEnc: string | null }> {
    if (!password) return { passwordHash: null, passwordEnc: null };
    return {
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      passwordEnc: this.crypto.encrypt(password),
    };
  }

  private async findBySlug(slug: string) {
    const link = await this.prisma.shareLink.findUnique({
      where: { slug },
      include: { trip: { select: { title: true } } },
    });
    if (!link) {
      throw new NotFoundException('Share link not found');
    }
    return link;
  }
}

function toInfo(
  link: {
    id: string;
    slug: string;
    passwordHash: string | null;
    createdAt: Date;
  },
  canManage: boolean,
): ShareLinkInfo {
  return {
    id: link.id,
    slug: link.slug,
    url: `/s/${link.slug}`,
    hasPassword: link.passwordHash !== null,
    canManage,
    createdAt: link.createdAt,
  };
}

function roleOf(
  trip: { ownerId: string; members: { userId: string; role: TripRole }[] },
  userId: string,
): TripRole {
  if (trip.ownerId === userId) return TripRole.OWNER;
  return trip.members.find((m) => m.userId === userId)?.role ?? TripRole.GUEST;
}
