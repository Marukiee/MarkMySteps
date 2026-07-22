import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
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
}

const REFRESH_TOKEN_BYTES = 48;

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

  async register(
    email: string,
    username: string,
    displayName: string,
    password: string,
  ): Promise<AuthTokens> {
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

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        username: normalizedUsername,
        displayName: displayName.trim(),
        passwordHash,
      },
    });

    return this.issueTokens(user.id, user.email);
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

    return this.issueTokens(user.id, user.email);
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

    return this.issueTokens(stored.user.id, stored.user.email);
  }

  async logout(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(userId: string, email: string): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, email };
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
