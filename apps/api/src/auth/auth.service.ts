import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface JwtPayload {
  sub: string; // user id
  email: string;
  /**
   * Present and true while the account is still waiting for an admin.
   *
   * A pending user gets a real token so the app can ask about its own status,
   * but the guard refuses that token everywhere except the handful of routes
   * that opt in. Denying by default is the point: forgetting to add a check to
   * a new endpoint leaves it closed, not open.
   */
  pending?: true;
}

export interface RegisterResult extends AuthTokens {
  status: 'PENDING' | 'APPROVED';
}

const REFRESH_TOKEN_BYTES = 48;

/**
 * How many sign-ups may be waiting for a decision at once.
 *
 * This is a private server for you and the people you travel with, so the
 * honest number is small. Sitting at the cap is a signal in itself: either
 * there are requests to deal with, or someone is trying it on.
 */
const MAX_PENDING_REQUESTS = 15;

@Injectable()
export class AuthService {
  private readonly refreshTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.refreshTtlMs = parseDuration(config.get<string>('REFRESH_TOKEN_EXPIRES_IN') ?? '30d');
  }

  /**
   * Signing up is a REQUEST, not an account.
   *
   * The row is created straight away (so the name and email are taken and the
   * password is stored hashed) but with PENDING status, which the guard treats
   * as "may do nothing". The one exception is the first account on a fresh
   * server: there would otherwise be nobody who could approve anybody.
   */
  async register(
    email: string,
    username: string,
    displayName: string,
    password: string,
  ): Promise<RegisterResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim().toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: normalizedEmail }, { username: normalizedUsername }] },
    });
    if (existing) {
      throw new ConflictException(
        existing.email === normalizedEmail
          ? 'An account with this email already exists'
          : 'This username is taken',
      );
    }

    const first = (await this.prisma.user.count()) === 0;

    // A sign-up costs an admin a decision, so the queue has a ceiling. Without
    // one, anybody who can reach the server could bury the accounts screen
    // under thousands of rows and make real requests impossible to find. The
    // per-IP rate limit sits in front of this; the cap is what holds when the
    // requests come from many addresses at once.
    if (!first) {
      const waiting = await this.prisma.user.count({
        where: { status: AccountStatus.PENDING },
      });
      if (waiting >= MAX_PENDING_REQUESTS) {
        throw new ForbiddenException(
          'Er staan te veel aanvragen open op deze server. Probeer het later opnieuw.',
        );
      }
    }
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        username: normalizedUsername,
        displayName: displayName.trim(),
        passwordHash,
        role: first ? UserRole.ADMIN : UserRole.USER,
        status: first ? AccountStatus.APPROVED : AccountStatus.PENDING,
        approvalSeen: first,
        decidedAt: first ? new Date() : null,
      },
    });

    return {
      ...(await this.issueTokens(user.id, user.email, user.status)),
      status: first ? 'APPROVED' : 'PENDING',
    };
  }

  /**
   * What a waiting account is allowed to ask: whether it is still waiting.
   *
   * Answered from the database rather than from the token, so an approval takes
   * effect immediately and a rejection cannot be sat out with an old token.
   */
  async approvalStatus(userId: string): Promise<{
    status: AccountStatus;
    /** True the first time the app sees an approval, so it can say so once. */
    justApproved: boolean;
  }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Account no longer exists');
    const justApproved = user.status === AccountStatus.APPROVED && !user.approvalSeen;
    if (justApproved) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { approvalSeen: true },
      });
    }
    return { status: user.status, justApproved };
  }

  /** `identifier` is an email address or a username. */
  async login(identifier: string, password: string): Promise<AuthTokens> {
    const normalized = identifier.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: normalized.includes('@') ? { email: normalized } : { username: normalized },
    });

    // Verify against a dummy hash when the user doesn't exist, so response
    // timing doesn't reveal which emails are registered.
    const hash = user?.passwordHash ?? DUMMY_ARGON2_HASH;
    const valid = await argon2.verify(hash, password).catch(() => false);

    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status === AccountStatus.REJECTED) {
      throw new ForbiddenException('This account has not been approved');
    }

    // A pending account may sign in — it just gets a token that can do nothing
    // but ask whether it is still pending. Refusing the login outright would
    // leave the app with no way to find out it had been approved.
    return this.issueTokens(user.id, user.email, user.status);
  }

  /**
   * Rotates the refresh token: the presented token is revoked and a new pair
   * is issued. Reuse of an already-revoked token revokes the whole family
   * (all sessions of the user) — standard replay-attack containment.
   */
  async refresh(rawToken: string): Promise<AuthTokens> {
    const tokenHash = hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      // Token replay detected → revoke every active token for this user.
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    if (stored.user.status === AccountStatus.REJECTED) {
      throw new ForbiddenException('This account has not been approved');
    }
    // Read from the row, not carried over from the old token: refreshing is
    // how a just-approved session is upgraded to a full one.
    return this.issueTokens(stored.user.id, stored.user.email, stored.user.status);
  }

  async logout(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    userId: string,
    email: string,
    status: AccountStatus,
  ): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, email };
    if (status !== AccountStatus.APPROVED) payload.pending = true;
    const accessToken = await this.jwt.signAsync(payload);

    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(refreshToken),
        userId,
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
      },
    });

    return { accessToken, refreshToken };
  }
}

/** SHA-256 is sufficient for high-entropy random tokens (not passwords). */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Pre-computed argon2id hash of a random string; used for timing-safe login. */
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$WCHXI+PBFVzNS9G7yNQ7dmO4CI/BRnAvhAJl45yJ9V0';

function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration "${value}" — expected e.g. "15m", "30d"`);
  }
  const amount = Number(match[1]);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd'];
  return amount * unit;
}
