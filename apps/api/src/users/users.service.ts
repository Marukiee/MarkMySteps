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
  async listFriends(
    id: string,
  ): Promise<{ id: string; username: string; displayName: string; sharedTrips: number }[]> {
    const rows = await this.prisma.tripMember.findMany({
      where: {
        userId: { not: id },
        trip: { members: { some: { userId: id } } },
      },
      include: { user: { select: { id: true, username: true, displayName: true } } },
    });

    const byUser = new Map<
      string,
      { id: string; username: string; displayName: string; sharedTrips: number }
    >();
    for (const row of rows) {
      const existing = byUser.get(row.userId);
      if (existing) existing.sharedTrips++;
      else byUser.set(row.userId, { ...row.user, sharedTrips: 1 });
    }
    return [...byUser.values()].sort((a, b) => b.sharedTrips - a.sharedTrips);
  }
}
