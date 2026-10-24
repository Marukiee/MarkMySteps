import { SecurityAlertsService } from './security-alerts.service';

function build(options: { recent?: number; fail?: boolean } = {}) {
  const prisma = {
    user: { findMany: jest.fn(async () => [{ id: 'admin-1' }, { id: 'admin-2' }]) },
    notification: {
      count: jest.fn(async () => options.recent ?? 0),
      create: jest.fn(async () => {
        if (options.fail) throw new Error('db down');
        return {};
      }),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new SecurityAlertsService(prisma as any), prisma };
}

describe('SecurityAlertsService.loginTrouble', () => {
  it('puts one line in the bell of every admin', async () => {
    const { service, prisma } = build();
    await service.loginTrouble({ username: 'mark' }, 'password', 10, 15);
    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'admin-1',
        kind: 'SECURITY_LOGIN_ATTEMPTS',
        detail: expect.stringContaining('10 keer een verkeerd wachtwoord voor "mark"'),
      },
    });
  });

  it('says "verkeerde code" for a code', async () => {
    const { service, prisma } = build();
    await service.loginTrouble({ username: 'mark' }, 'code', 5, 15);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ detail: expect.stringContaining('5 keer een verkeerde code') }),
    });
  });

  it('does not say it twice within the hour', async () => {
    const { service, prisma } = build({ recent: 1 });
    await service.loginTrouble({ username: 'mark' }, 'code', 5, 15);
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('never lets a failed alert change what the person at the door is told', async () => {
    const { service } = build({ fail: true });
    await expect(service.loginTrouble({ username: 'mark' }, 'code', 5, 15)).resolves.toBeUndefined();
  });
});
