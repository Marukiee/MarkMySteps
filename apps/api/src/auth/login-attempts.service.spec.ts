import { CODE_ATTEMPTS, LoginAttemptsService, PASSWORD_ATTEMPTS } from './login-attempts.service';

class Clock extends LoginAttemptsService {
  time = 1_000_000;
  protected override now(): number {
    return this.time;
  }
}

describe('LoginAttemptsService', () => {
  it('lets an account be tried until the limit is reached', () => {
    const attempts = new Clock();
    for (let i = 1; i < CODE_ATTEMPTS.max; i++) {
      expect(attempts.recordFailure('mark', CODE_ATTEMPTS).justLocked).toBe(false);
      expect(attempts.lockedForMs('mark')).toBe(0);
    }
    const last = attempts.recordFailure('mark', CODE_ATTEMPTS);
    expect(last.justLocked).toBe(true);
    expect(attempts.lockedForMs('mark')).toBe(CODE_ATTEMPTS.lockMs);
  });

  it('reports the tipping miss once, not on every refused try after it', () => {
    const attempts = new Clock();
    const results = Array.from({ length: CODE_ATTEMPTS.max + 3 }, () =>
      attempts.recordFailure('mark', CODE_ATTEMPTS),
    );
    expect(results.filter((r) => r.justLocked)).toHaveLength(1);
  });

  it('unlocks when the time is up', () => {
    const attempts = new Clock();
    for (let i = 0; i < CODE_ATTEMPTS.max; i++) attempts.recordFailure('mark', CODE_ATTEMPTS);
    attempts.time += CODE_ATTEMPTS.lockMs - 1;
    expect(attempts.lockedForMs('mark')).toBeGreaterThan(0);
    attempts.time += 1;
    expect(attempts.lockedForMs('mark')).toBe(0);
  });

  it('forgets misses that fall outside the window', () => {
    const attempts = new Clock();
    for (let i = 0; i < CODE_ATTEMPTS.max - 1; i++) attempts.recordFailure('mark', CODE_ATTEMPTS);
    attempts.time += CODE_ATTEMPTS.windowMs;
    // One more, but the earlier ones are old news.
    expect(attempts.recordFailure('mark', CODE_ATTEMPTS)).toEqual({ justLocked: false, failures: 1 });
  });

  it('forgets everything after a success', () => {
    const attempts = new Clock();
    for (let i = 0; i < CODE_ATTEMPTS.max - 1; i++) attempts.recordFailure('mark', CODE_ATTEMPTS);
    attempts.recordSuccess('mark');
    expect(attempts.recordFailure('mark', CODE_ATTEMPTS).failures).toBe(1);
  });

  it('counts each account on its own', () => {
    const attempts = new Clock();
    for (let i = 0; i < CODE_ATTEMPTS.max; i++) attempts.recordFailure('mark', CODE_ATTEMPTS);
    expect(attempts.lockedForMs('mark')).toBeGreaterThan(0);
    expect(attempts.lockedForMs('simon')).toBe(0);
  });

  it('is more patient with passwords than with codes', () => {
    expect(PASSWORD_ATTEMPTS.max).toBeGreaterThan(CODE_ATTEMPTS.max);
    const attempts = new Clock();
    for (let i = 0; i < CODE_ATTEMPTS.max; i++) attempts.recordFailure('mark', PASSWORD_ATTEMPTS);
    expect(attempts.lockedForMs('mark')).toBe(0);
  });

  it('does not grow without bound under a flood of made-up names', () => {
    const attempts = new Clock();
    for (let i = 0; i < 25_000; i++) attempts.recordFailure(`bot-${i}`, PASSWORD_ATTEMPTS);
    // @ts-expect-error reaching in to look at the size
    expect(attempts.entries.size).toBeLessThanOrEqual(10_000);
  });
});
