import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { LoginAttemptsService, PASSWORD_ATTEMPTS, CODE_ATTEMPTS } from './login-attempts.service';

const PASSWORD = 'Koffie-Zeppelin-Maanlicht-91';
let hash: string;
beforeAll(async () => {
  hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
});

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'mark@example.com',
    username: 'mark',
    passwordHash: hash,
    status: 'APPROVED',
    totpEnabledAt: null,
    ...overrides,
  };
}

function build(found: ReturnType<typeof user> | null = user()) {
  const prisma = {
    user: {
      findFirst: jest.fn(async () => found),
      findUnique: jest.fn(async () => found),
    },
    refreshToken: {
      create: jest.fn(async () => ({})),
      findUnique: jest.fn(),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  const jwt = {
    signAsync: jest.fn(async (payload: object, options?: object) =>
      `jwt:${JSON.stringify({ ...payload, ...(options ?? {}) })}`,
    ),
    verifyAsync: jest.fn(),
  };
  const attempts = new LoginAttemptsService();
  const alerts = { loginTrouble: jest.fn(async () => undefined) };
  const twoFactor = { verifySecondFactor: jest.fn(async () => false) };
  const config = { get: () => '30d' } as unknown as ConfigService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new AuthService(prisma as any, jwt as any, attempts, alerts as any, twoFactor as any, config);
  return { service, prisma, jwt, attempts, alerts, twoFactor };
}

const status = (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (err: { getStatus?: () => number }) => err.getStatus?.() ?? 500,
  );

describe('AuthService.login', () => {
  it('signs in an account without a second step, as before', async () => {
    const { service, prisma } = build();
    const result = await service.login('mark', PASSWORD);
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it('answers with a challenge, and no session, when the account has an authenticator app', async () => {
    const { service, prisma, jwt } = build(user({ totpEnabledAt: new Date() }));
    const result = await service.login('mark', PASSWORD);
    expect(result).toMatchObject({ mfaRequired: true });
    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('refreshToken');
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    // A scope the guard refuses, and a short life.
    expect(jwt.signAsync).toHaveBeenCalledWith(
      { scope: 'mfa', sub: 'user-1' },
      { expiresIn: '5m' },
    );
  });

  it('refuses a wrong password without saying whether the account exists', async () => {
    const { service } = build(null);
    expect(await status(service.login('nobody', PASSWORD))).toBe(401);
  });

  it('locks the name after enough misses and then refuses even the right password', async () => {
    const { service, alerts } = build();
    for (let i = 0; i < PASSWORD_ATTEMPTS.max; i++) {
      expect(await status(service.login('mark', 'wrong-password-123'))).toBe(401);
    }
    expect(alerts.loginTrouble).toHaveBeenCalledTimes(1);
    expect(alerts.loginTrouble).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'mark' }),
      'password',
      PASSWORD_ATTEMPTS.max,
      15,
    );
    expect(await status(service.login('mark', PASSWORD))).toBe(429);
  });

  it('locks a name that does not exist in exactly the same way, and says nothing to the admins', async () => {
    const { service, alerts } = build(null);
    const answers: number[] = [];
    for (let i = 0; i < PASSWORD_ATTEMPTS.max + 2; i++) {
      answers.push(await status(service.login('nobody', 'wrong-password-123')));
    }
    expect(answers.slice(0, PASSWORD_ATTEMPTS.max).every((s) => s === 401)).toBe(true);
    expect(answers.slice(PASSWORD_ATTEMPTS.max)).toEqual([429, 429]);
    expect(alerts.loginTrouble).not.toHaveBeenCalled();
  });

  it('counts a name case-insensitively and by what was typed, whatever the address', async () => {
    const { service } = build();
    for (let i = 0; i < PASSWORD_ATTEMPTS.max; i++) {
      await status(service.login(i % 2 ? 'MARK' : ' mark ', 'wrong-password-123'));
    }
    expect(await status(service.login('Mark', PASSWORD))).toBe(429);
  });

  it('forgets earlier misses once the password is right', async () => {
    const { service, attempts } = build();
    for (let i = 0; i < PASSWORD_ATTEMPTS.max - 1; i++) {
      await status(service.login('mark', 'wrong-password-123'));
    }
    await service.login('mark', PASSWORD);
    expect(attempts.recordFailure('mark', PASSWORD_ATTEMPTS).failures).toBe(1);
  });
});

describe('AuthService.loginMfa', () => {
  const mfaUser = () => user({ totpEnabledAt: new Date() });

  it('refuses tokens that are not an mfa token, whatever else they are', async () => {
    const { service, jwt } = build(mfaUser());
    // An ordinary access token: signed by us, has a subject, but no scope.
    jwt.verifyAsync.mockResolvedValueOnce({ sub: 'user-1', email: 'mark@example.com' });
    expect(await status(service.loginMfa('t', '123456'))).toBe(401);
    // A share-link session.
    jwt.verifyAsync.mockResolvedValueOnce({ scope: 'share', slug: 'abc', tripId: 't1' });
    expect(await status(service.loginMfa('t', '123456'))).toBe(401);
    // Something that does not verify at all.
    jwt.verifyAsync.mockRejectedValueOnce(new Error('expired'));
    expect(await status(service.loginMfa('t', '123456'))).toBe(401);
  });

  it('signs in with a good code', async () => {
    const { service, jwt, twoFactor, prisma } = build(mfaUser());
    jwt.verifyAsync.mockResolvedValue({ scope: 'mfa', sub: 'user-1' });
    twoFactor.verifySecondFactor.mockResolvedValue(true);
    const tokens = await service.loginMfa('t', '123456');
    expect(tokens).toHaveProperty('accessToken');
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it('refuses when the account no longer has a second step', async () => {
    const { service, jwt } = build(user({ totpEnabledAt: null }));
    jwt.verifyAsync.mockResolvedValue({ scope: 'mfa', sub: 'user-1' });
    expect(await status(service.loginMfa('t', '123456'))).toBe(401);
  });

  it('locks the account after five wrong codes, tells the admins once, and then refuses a right one', async () => {
    const { service, jwt, twoFactor, alerts } = build(mfaUser());
    jwt.verifyAsync.mockResolvedValue({ scope: 'mfa', sub: 'user-1' });
    twoFactor.verifySecondFactor.mockResolvedValue(false);
    for (let i = 0; i < CODE_ATTEMPTS.max; i++) {
      expect(await status(service.loginMfa('t', '000000'))).toBe(401);
    }
    expect(alerts.loginTrouble).toHaveBeenCalledTimes(1);
    expect(alerts.loginTrouble).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'mark' }),
      'code',
      CODE_ATTEMPTS.max,
      15,
    );
    twoFactor.verifySecondFactor.mockResolvedValue(true);
    expect(await status(service.loginMfa('t', '123456'))).toBe(429);
    // The check was not even made: a right code must not be a way to probe.
    expect(twoFactor.verifySecondFactor).toHaveBeenCalledTimes(CODE_ATTEMPTS.max);
  });
});

describe('AuthService.refresh', () => {
  const now = () => new Date();
  const ago = (ms: number) => new Date(Date.now() - ms);
  const row = (overrides: Record<string, unknown>) => ({
    id: 'rt-1',
    userId: 'user-1',
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    rotatedAt: null,
    user: user(),
    ...overrides,
  });

  it('swaps a token for a new one and records that it was a swap', async () => {
    const { service, prisma } = build();
    prisma.refreshToken.findUnique.mockResolvedValue(row({}));
    await service.refresh('token');
    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'rt-1' },
      data: { revokedAt: expect.any(Date), rotatedAt: expect.any(Date) },
    });
  });

  it('still answers a token that was swapped a moment ago: the reply may simply have been lost', async () => {
    const { service, prisma } = build();
    prisma.refreshToken.findUnique.mockResolvedValue(
      row({ revokedAt: ago(10_000), rotatedAt: ago(10_000) }),
    );
    await expect(service.refresh('token')).resolves.toHaveProperty('accessToken');
  });

  it('does NOT answer a token that was revoked on purpose, even a second after', async () => {
    const { service, prisma } = build();
    // revoked by a password change, an admin or a logout: no rotatedAt
    prisma.refreshToken.findUnique.mockResolvedValue(row({ revokedAt: ago(1_000) }));
    expect(await status(service.refresh('token'))).toBe(401);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    // …and the account's other sessions go with it, as for any replayed token.
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('does not answer a swapped token once the minute is up', async () => {
    const { service, prisma } = build();
    prisma.refreshToken.findUnique.mockResolvedValue(
      row({ revokedAt: ago(120_000), rotatedAt: ago(120_000) }),
    );
    expect(await status(service.refresh('token'))).toBe(401);
  });

  it('refuses an expired token', async () => {
    const { service, prisma } = build();
    prisma.refreshToken.findUnique.mockResolvedValue(row({ expiresAt: ago(1) }));
    expect(await status(service.refresh('token'))).toBe(401);
    void now;
  });
});
