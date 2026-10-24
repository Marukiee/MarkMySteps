import { Injectable, Logger } from '@nestjs/common';
import { AccountStatus, NotificationKind, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ONE_HOUR_MS = 60 * 60_000;

/**
 * Tells the admins, in the bell, when an account is under attack.
 *
 * There is no mail server here, and the admins are the people who open the app
 * anyway. The same row feeds the phone's background poller, so it also shows up
 * as a notification on the phone.
 */
@Injectable()
export class SecurityAlertsService {
  private readonly logger = new Logger(SecurityAlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * An account has just been locked because its password or code kept being
   * wrong. Said once per account per hour however long the attack lasts.
   */
  async loginTrouble(
    account: { username: string },
    what: 'password' | 'code',
    attempts: number,
    lockMinutes: number,
  ): Promise<void> {
    this.logger.warn(
      `${attempts} wrong ${what} attempts for "${account.username}" — locked for ${lockMinutes} minutes`,
    );
    const detail =
      `${attempts} keer een ${what === 'code' ? 'verkeerde code' : 'verkeerd wachtwoord'} voor ` +
      `"${account.username}". Het account is ${lockMinutes} minuten vergrendeld. ` +
      'Gebeurt dit zonder dat iemand zich vergist heeft, dan probeert iemand in te breken.';

    try {
      const admins = await this.prisma.user.findMany({
        where: { role: UserRole.ADMIN, status: AccountStatus.APPROVED },
        select: { id: true },
      });
      const since = new Date(Date.now() - ONE_HOUR_MS);
      for (const admin of admins) {
        const recent = await this.prisma.notification.count({
          where: {
            userId: admin.id,
            kind: NotificationKind.SECURITY_LOGIN_ATTEMPTS,
            createdAt: { gt: since },
            detail: { contains: `"${account.username}"` },
          },
        });
        if (recent > 0) continue;
        await this.prisma.notification.create({
          data: { userId: admin.id, kind: NotificationKind.SECURITY_LOGIN_ATTEMPTS, detail },
        });
      }
    } catch (err) {
      // A signal that could not be delivered must never turn into a different
      // answer for the person (or the attacker) at the door.
      this.logger.error(`Could not raise the login alert: ${String(err)}`);
    }
  }
}
