import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { CODE_ATTEMPTS, LoginAttemptsService } from './login-attempts.service';
import { SecurityAlertsService } from './security-alerts.service';
import { revokeAllSessions } from './sessions';
import { base32Encode, generateTotpSecret, otpauthUri, verifyTotp } from './totp';

export interface TwoFactorStatus {
  enabled: boolean;
  recoveryCodesLeft: number;
}

export interface TwoFactorSetup {
  /** The secret as text, for typing into an app that cannot scan. */
  secret: string;
  /** What the QR code holds. */
  otpauthUri: string;
}

const ISSUER = 'MarkMySteps';
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_PATTERN = /^[A-Z2-7]{16}$/;

/** The part of a user this service needs to look at. */
interface Subject {
  id: string;
  email: string;
  username: string;
  totpSecretEnc: string | null;
  totpEnabledAt: Date | null;
  totpLastStep: number | null;
}

/**
 * The authenticator-app second step, and the recovery codes that stand in for
 * it when the phone is gone.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly attempts: LoginAttemptsService,
    private readonly alerts: SecurityAlertsService,
  ) {}

  async status(userId: string): Promise<TwoFactorStatus> {
    const user = await this.requireUser(userId);
    const recoveryCodesLeft = user.totpEnabledAt
      ? await this.prisma.recoveryCode.count({ where: { userId, usedAt: null } })
      : 0;
    return { enabled: user.totpEnabledAt !== null, recoveryCodesLeft };
  }

  /**
   * Step one of turning it on: a secret for the app to scan.
   *
   * Asks for the password again. A session that has been left open on a phone
   * must not be enough to put somebody else's second factor on the account,
   * which would lock its owner out.
   */
  async beginSetup(userId: string, password: string): Promise<TwoFactorSetup> {
    const user = await this.requireUser(userId);
    if (user.totpEnabledAt) throw new ConflictException('Two-step verification is already on');
    await this.requirePassword(userId, password);

    const secret = generateTotpSecret();
    // Stored but not trusted yet: `totpEnabledAt` stays empty until a code from
    // the app has proved that it really holds the secret.
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEnc: this.crypto.encrypt(secret), totpEnabledAt: null, totpLastStep: null },
    });
    return {
      secret,
      otpauthUri: otpauthUri({ secret, account: user.email, issuer: ISSUER }),
    };
  }

  /** Step two: the first code from the app turns it on and hands out the recovery codes. */
  async confirmSetup(userId: string, code: string): Promise<string[]> {
    const user = await this.requireUser(userId);
    if (user.totpEnabledAt) throw new ConflictException('Two-step verification is already on');
    if (!user.totpSecretEnc) throw new BadRequestException('Start the setup first');

    this.assertNotLocked(userId);
    const match = verifyTotp(this.crypto.decrypt(user.totpSecretEnc), code);
    if (!match) {
      await this.countMiss(user);
      throw new BadRequestException('That code is not right. Check the clock on your phone.');
    }

    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, totpEnabledAt: null },
      data: { totpEnabledAt: new Date(), totpLastStep: match.step },
    });
    if (count !== 1) throw new ConflictException('Two-step verification is already on');
    this.attempts.recordSuccess(mfaKey(userId));
    return this.issueRecoveryCodes(userId);
  }

  /** Turning it off takes the password and a current code: a stolen session is not enough. */
  async disable(userId: string, password: string, code: string): Promise<void> {
    const user = await this.requireUser(userId);
    if (!user.totpEnabledAt) return;
    await this.requirePassword(userId, password);
    await this.requireSecondFactor(user, code);
    await this.clear(userId);
  }

  /** A fresh set of recovery codes; the old ones stop working. */
  async regenerateRecoveryCodes(userId: string, password: string, code: string): Promise<string[]> {
    const user = await this.requireUser(userId);
    if (!user.totpEnabledAt) throw new BadRequestException('Two-step verification is off');
    await this.requirePassword(userId, password);
    await this.requireSecondFactor(user, code);
    return this.issueRecoveryCodes(userId);
  }

  /**
   * An admin switching it off for somebody who has lost both their phone and
   * their recovery codes. Their sessions end too: whoever is signed in is
   * signed in with the old setup.
   */
  async resetForUser(userId: string): Promise<void> {
    await this.requireUser(userId);
    await this.clear(userId);
    await revokeAllSessions(this.prisma, userId);
  }

  /**
   * Does this code, from the app or from the recovery list, belong to the
   * account? A code from the app works once; so does each recovery code.
   *
   * Does not count misses: callers decide what a miss costs.
   */
  async verifySecondFactor(user: Subject, code: string): Promise<boolean> {
    const typed = code.trim();
    // Six digits is the app; anything else can only be a recovery code.
    if (/^\d{6}$/.test(typed.replace(/\s/g, ''))) {
      if (!user.totpSecretEnc || !user.totpEnabledAt) return false;
      const match = verifyTotp(this.crypto.decrypt(user.totpSecretEnc), typed, {
        lastStep: user.totpLastStep,
      });
      if (!match) return false;
      // Claimed in the database, not just compared here: two requests carrying
      // the same code at the same moment both pass the comparison, and only
      // one may win the row.
      const { count } = await this.prisma.user.updateMany({
        where: {
          id: user.id,
          OR: [{ totpLastStep: null }, { totpLastStep: { lt: match.step } }],
        },
        data: { totpLastStep: match.step },
      });
      return count === 1;
    }

    const normalized = typed.replace(/[\s-]/g, '').toUpperCase();
    if (!RECOVERY_CODE_PATTERN.test(normalized)) return false;
    const { count } = await this.prisma.recoveryCode.updateMany({
      where: { userId: user.id, codeHash: hashRecoveryCode(normalized), usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }

  // ---- internals ----------------------------------------------------------

  /** Password plus code, with the same lock as at sign-in. */
  private async requireSecondFactor(user: Subject, code: string): Promise<void> {
    this.assertNotLocked(user.id);
    if (!(await this.verifySecondFactor(user, code))) {
      await this.countMiss(user);
      throw new UnauthorizedException('That code is not right');
    }
    this.attempts.recordSuccess(mfaKey(user.id));
  }

  private async requirePassword(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    this.assertNotLocked(userId);
    const valid = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!valid) {
      await this.countMiss(user);
      throw new UnauthorizedException('Current password is incorrect');
    }
  }

  private assertNotLocked(userId: string): void {
    const left = this.attempts.lockedForMs(mfaKey(userId));
    if (left > 0) throw tooManyAttempts(left);
  }

  private async countMiss(user: { id: string; username: string }): Promise<void> {
    const { justLocked, failures } = this.attempts.recordFailure(mfaKey(user.id), CODE_ATTEMPTS);
    if (justLocked) {
      await this.alerts.loginTrouble(user, 'code', failures, CODE_ATTEMPTS.lockMs / 60_000);
    }
  }

  private async issueRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => base32Encode(randomBytes(10)));
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.createMany({
        data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })),
      }),
    ]);
    // 16 characters, shown in groups of four.
    return codes.map((code) => code.match(/.{4}/g)!.join('-'));
  }

  private async clear(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null },
      }),
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
    ]);
  }

  private async requireUser(userId: string): Promise<Subject> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        totpSecretEnc: true,
        totpEnabledAt: true,
        totpLastStep: true,
      },
    });
    if (!user) throw new UnauthorizedException('Account no longer exists');
    return user;
  }
}

/** Recovery codes carry 80 bits of randomness, so a plain hash is enough. */
function hashRecoveryCode(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}

/** Lock key for everything that guesses at a code. Shared with sign-in. */
export function mfaKey(userId: string): string {
  return `mfa:${userId}`;
}

export function tooManyAttempts(leftMs: number): HttpException {
  const minutes = Math.max(1, Math.ceil(leftMs / 60_000));
  return new HttpException(
    `Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
