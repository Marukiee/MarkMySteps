import { PrismaService } from '../prisma/prisma.service';

/**
 * Ends every session of an account, immediately.
 *
 * For the cases where somebody should be signed out *now* — a password change,
 * an admin resetting or refusing an account, a second factor that was reset.
 *
 * Two things have to happen. Tokens that are still good are revoked. And tokens
 * that were swapped for a new one a moment ago lose their one-minute grace (the
 * allowance for a response that never arrived): left alone, such a token could
 * still be traded for a fresh pair after the account had supposedly been cut off,
 * and the fresh pair would be as good as the one that was just revoked.
 */
export async function revokeAllSessions(prisma: PrismaService, userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, rotatedAt: { not: null } },
      data: { rotatedAt: null },
    }),
  ]);
}
