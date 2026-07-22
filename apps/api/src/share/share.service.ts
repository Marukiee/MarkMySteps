import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TripsService } from '../trips/trips.service';

export interface ShareLinkInfo {
  id: string;
  slug: string;
  url: string; // path only; frontend prefixes its origin
  hasPassword: boolean;
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
  ) {}

  // ---- Management (trip owner) ----

  async create(tripId: string, userId: string, password?: string): Promise<ShareLinkInfo> {
    const trip = await this.trips.getForMember(tripId, userId);
    if (trip.ownerId !== userId) {
      throw new ForbiddenException('Only the trip owner can create share links');
    }

    const link = await this.prisma.shareLink.create({
      data: {
        tripId,
        slug: randomBytes(SLUG_BYTES).toString('base64url'),
        passwordHash: password ? await argon2.hash(password, { type: argon2.argon2id }) : null,
      },
    });
    return toInfo(link);
  }

  async list(tripId: string, userId: string): Promise<ShareLinkInfo[]> {
    const trip = await this.trips.getForMember(tripId, userId);
    if (trip.ownerId !== userId) return [];
    const links = await this.prisma.shareLink.findMany({
      where: { tripId },
      orderBy: { createdAt: 'desc' },
    });
    return links.map(toInfo);
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

function toInfo(link: {
  id: string;
  slug: string;
  passwordHash: string | null;
  createdAt: Date;
}): ShareLinkInfo {
  return {
    id: link.id,
    slug: link.slug,
    url: `/s/${link.slug}`,
    hasPassword: link.passwordHash !== null,
    createdAt: link.createdAt,
  };
}
