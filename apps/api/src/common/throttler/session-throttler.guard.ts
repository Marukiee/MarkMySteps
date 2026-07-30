import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'node:crypto';

/**
 * Counts requests per session instead of per address.
 *
 * Everyone on this server shares one home connection, so an IP-wide limit was
 * really a limit on the household: a phone catching up after a day offline
 * used up the budget for the laptop next to it, and the app said "Too Many
 * Requests" for something nobody did wrong.
 *
 * Signed-in requests are keyed on the access token, which is per device and
 * rotates on its own. Anything without one still counts per address — that is
 * where login and register live, and those limits are the point.
 */
@Injectable()
export class SessionThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, any>): Promise<string> {
    const auth = (req.headers as Record<string, string | undefined>)?.authorization;
    if (auth?.startsWith('Bearer ')) {
      // Hashed, so the token itself is never a key in the storage map.
      const digest = createHash('sha256').update(auth.slice(7)).digest('hex');
      return Promise.resolve(`session:${digest.slice(0, 32)}`);
    }
    const ip = (req.ips as string[] | undefined)?.[0] ?? (req.ip as string | undefined);
    return Promise.resolve(`ip:${ip ?? 'unknown'}`);
  }
}
