import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { CryptoService } from '../common/crypto/crypto.service';
import { LoginAttemptsService } from './login-attempts.service';
import { SecurityAlertsService } from './security-alerts.service';
import { base32Encode, timeStep, totpCode } from './totp';
import { TwoFactorService } from './two-factor.service';

const crypto = new CryptoService({
  getOrThrow: () => Buffer.alloc(32, 7).toString('base64'),
} as unknown as ConfigService);

const SECRET = base32Encode(Buffer.from('12345678901234567890'));

function build() {
  const prisma = {
    user: { updateMany: jest.fn(async () => ({ count: 1 })) },
    recoveryCode: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const service = new TwoFactorService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma as any,
    crypto,
    new LoginAttemptsService(),
    { loginTrouble: jest.fn() } as unknown as SecurityAlertsService,
  );
  return { service, prisma };
}

const subject = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  email: 'mark@example.com',
  username: 'mark',
  totpSecretEnc: crypto.encrypt(SECRET),
  totpEnabledAt: new Date(),
  totpLastStep: null,
  ...overrides,
});

describe('TwoFactorService.verifySecondFactor', () => {
  it('takes a current code from the app and claims its step in the database', async () => {
    const { service, prisma } = build();
    const code = totpCode(SECRET);
    expect(await service.verifySecondFactor(subject(), code)).toBe(true);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', OR: [{ totpLastStep: null }, { totpLastStep: { lt: timeStep() } }] },
      data: { totpLastStep: timeStep() },
    });
  });

  it('refuses a code if another request claimed that step first', async () => {
    const { service, prisma } = build();
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    expect(await service.verifySecondFactor(subject(), totpCode(SECRET))).toBe(false);
  });

  it('refuses a code whose step was already used', async () => {
    const { service, prisma } = build();
    expect(
      await service.verifySecondFactor(subject({ totpLastStep: timeStep() }), totpCode(SECRET)),
    ).toBe(false);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a wrong code, and any code at all while the app is not set up', async () => {
    const { service } = build();
    expect(await service.verifySecondFactor(subject(), '000000')).toBe(false);
    expect(
      await service.verifySecondFactor(subject({ totpEnabledAt: null }), totpCode(SECRET)),
    ).toBe(false);
  });

  it('accepts a recovery code as typed, with dashes, spaces or lower case, once', async () => {
    const { service, prisma } = build();
    const stored = 'ABCDEFGHJKLMNPQR'.replace(/[IO01]/g, '2');
    const typed = `${stored.slice(0, 4)}-${stored.slice(4, 8)} ${stored.slice(8, 12).toLowerCase()}-${stored.slice(12)}`;
    expect(await service.verifySecondFactor(subject(), typed)).toBe(true);
    expect(prisma.recoveryCode.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        codeHash: createHash('sha256').update(stored).digest('hex'),
        usedAt: null,
      },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('refuses a recovery code that was already used', async () => {
    const { service, prisma } = build();
    prisma.recoveryCode.updateMany.mockResolvedValue({ count: 0 });
    expect(await service.verifySecondFactor(subject(), 'ABCD-EFGH-JKLM-NPQR')).toBe(false);
  });

  it('does not even look up something that cannot be a code', async () => {
    const { service, prisma } = build();
    for (const junk of ['', '12345', '1234567', 'hello', 'ABCD-EFGH', "'; drop table users;--"]) {
      expect(await service.verifySecondFactor(subject(), junk)).toBe(false);
    }
    expect(prisma.recoveryCode.updateMany).not.toHaveBeenCalled();
  });
});
