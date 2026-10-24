import { Injectable } from '@nestjs/common';

export interface AttemptLimit {
  /** Failures inside the window that lock the account. */
  max: number;
  windowMs: number;
  lockMs: number;
}

/**
 * A wrong password is cheap to try ten times and expensive to try a million, so
 * the generous limit is what keeps a person who mistyped from being locked out.
 */
export const PASSWORD_ATTEMPTS: AttemptLimit = {
  max: 10,
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
};

/**
 * A six-digit code has a million values and three of them are valid at any
 * moment, so this is the limit that has to hold: five tries per quarter hour is
 * a few hundred a day.
 */
export const CODE_ATTEMPTS: AttemptLimit = {
  max: 5,
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
};

const MAX_TRACKED = 10_000;

interface Entry {
  failures: number[];
  lockedUntil: number;
}

/**
 * Counts failed sign-ins per account, whatever address they come from.
 *
 * The per-address limit in front of the API stops one machine from hammering;
 * it does nothing about an attacker with a thousand addresses and one target.
 * This is the other half: after a handful of misses the account itself refuses
 * to be tried for a while.
 *
 * Keyed on what was typed rather than on the account it matched, so a name that
 * does not exist is locked after the same number of tries as one that does and
 * the lock cannot be used to find out who has an account. Kept in memory: a
 * restart forgets, which costs an attacker nothing they did not already have
 * and avoids a table that grows with every guess.
 */
@Injectable()
export class LoginAttemptsService {
  private readonly entries = new Map<string, Entry>();

  /** Overridable, so tests do not have to wait a quarter of an hour. */
  protected now(): number {
    return Date.now();
  }

  /** Milliseconds left on a lock, or 0 when the account may be tried. */
  lockedForMs(key: string): number {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    const left = entry.lockedUntil - this.now();
    return left > 0 ? left : 0;
  }

  /**
   * Notes a miss. `justLocked` is true only for the miss that tipped it over,
   * which is the moment somebody should be told.
   */
  recordFailure(key: string, limit: AttemptLimit): { justLocked: boolean; failures: number } {
    const now = this.now();
    const entry = this.entries.get(key) ?? { failures: [], lockedUntil: 0 };
    entry.failures = entry.failures.filter((at) => now - at < limit.windowMs);
    entry.failures.push(now);

    let justLocked = false;
    const failures = entry.failures.length;
    if (failures >= limit.max) {
      entry.lockedUntil = now + limit.lockMs;
      entry.failures = [];
      justLocked = true;
    }

    // Re-inserted so the map stays in order of last use.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.trim(now, limit.windowMs);
    return { justLocked, failures };
  }

  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  /** Keeps the map from growing without bound under a flood of made-up names. */
  private trim(now: number, windowMs: number): void {
    if (this.entries.size <= MAX_TRACKED) return;
    for (const [key, entry] of this.entries) {
      const idle = entry.lockedUntil <= now && entry.failures.every((at) => now - at >= windowMs);
      if (idle) this.entries.delete(key);
    }
    // Still full of live entries: forget the longest untouched ones.
    for (const key of this.entries.keys()) {
      if (this.entries.size <= MAX_TRACKED) break;
      this.entries.delete(key);
    }
  }
}
