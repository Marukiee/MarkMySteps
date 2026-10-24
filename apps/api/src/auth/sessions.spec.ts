import { revokeAllSessions } from './sessions';

describe('revokeAllSessions', () => {
  it('revokes what is live, and takes the grace away from what was swapped a moment ago', async () => {
    const calls: { where: object; data: object }[] = [];
    const prisma = {
      refreshToken: {
        updateMany: jest.fn((args: { where: object; data: object }) => {
          calls.push(args);
          return Promise.resolve({ count: 1 });
        }),
      },
      $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await revokeAllSessions(prisma as any, 'user-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      { where: { userId: 'user-1', revokedAt: null }, data: { revokedAt: expect.any(Date) } },
      { where: { userId: 'user-1', rotatedAt: { not: null } }, data: { rotatedAt: null } },
    ]);
  });
});
