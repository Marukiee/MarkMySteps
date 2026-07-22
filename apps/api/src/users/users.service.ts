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
  createdAt: Date;
}

const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  createdAt: true,
} as const;

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
    return user;
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
    return this.prisma.user.update({
      where: { id },
      data: { displayName: displayName.trim(), username: normalizedUsername },
      select: PUBLIC_USER_SELECT,
    });
  }

  async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    const valid = await argon2.verify(user.passwordHash, currentPassword).catch(() => false);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await argon2.hash(newPassword, { type: argon2.argon2id }) },
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
