import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountStatus, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

export interface AdminUserRow {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: AccountStatus;
  mustChangePassword: boolean;
  createdAt: Date;
  decidedAt: Date | null;
  tripCount: number;
}

const ROW_SELECT = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  role: true,
  status: true,
  mustChangePassword: true,
  createdAt: true,
  decidedAt: true,
  _count: { select: { tripMemberships: true } },
} as const;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(): Promise<AdminUserRow[]> {
    const users = await this.prisma.user.findMany({
      select: ROW_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return users.map(toRow);
  }

  /** Creates an account with a temporary password the friend must replace. */
  async createUser(
    email: string,
    username: string,
    displayName: string,
    tempPassword: string,
  ): Promise<AdminUserRow> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim().toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: normalizedEmail }, { username: normalizedUsername }] },
    });
    if (existing) {
      throw new ConflictException('Email or username already in use');
    }

    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        username: normalizedUsername,
        displayName: displayName.trim(),
        passwordHash: await argon2.hash(tempPassword, { type: argon2.argon2id }),
        mustChangePassword: true,
        // An admin creating the account IS the approval.
        status: AccountStatus.APPROVED,
        approvalSeen: true,
        decidedAt: new Date(),
      },
      select: ROW_SELECT,
    });
    return toRow(user);
  }

  async resetPassword(userId: string, tempPassword: string): Promise<void> {
    await this.requireUser(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await argon2.hash(tempPassword, { type: argon2.argon2id }),
        mustChangePassword: true,
      },
    });
    // Kick every session of that account.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Lets a waiting account in.
   *
   * Their existing tokens still say "pending", so every session is revoked:
   * the app signs in again (or refreshes) and gets a full token. Leaving the
   * old ones alive would mean the guard kept refusing someone who had just
   * been approved.
   */
  async approve(userId: string, adminId: string): Promise<void> {
    const user = await this.requireUser(userId);
    if (user.status === AccountStatus.APPROVED) return;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: AccountStatus.APPROVED,
        decidedAt: new Date(),
        decidedById: adminId,
        approvalSeen: false,
      },
    });
  }

  /**
   * Refuses one. The row stays: it keeps the email and username taken, and a
   * refusal that quietly frees them up invites the same request again.
   */
  async reject(userId: string, adminId: string): Promise<void> {
    const user = await this.requireUser(userId);
    if (user.id === adminId) {
      throw new BadRequestException('You cannot reject your own account');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: AccountStatus.REJECTED, decidedAt: new Date(), decidedById: adminId },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async setRole(userId: string, role: UserRole, actingAdminId: string): Promise<void> {
    if (userId === actingAdminId && role !== UserRole.ADMIN) {
      throw new BadRequestException('You cannot demote yourself');
    }
    await this.requireUser(userId);
    await this.prisma.user.update({ where: { id: userId }, data: { role } });
  }

  async deleteUser(userId: string, actingAdminId: string): Promise<void> {
    if (userId === actingAdminId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    await this.requireUser(userId);
    // Cascades: trips they own, memberships, points, media refs, connection.
    await this.prisma.user.delete({ where: { id: userId } });
  }

  private async requireUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}

function toRow(user: {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: AccountStatus;
  mustChangePassword: boolean;
  createdAt: Date;
  decidedAt: Date | null;
  _count: { tripMemberships: number };
}): AdminUserRow {
  const { _count, ...rest } = user;
  return { ...rest, tripCount: _count.tripMemberships };
}
