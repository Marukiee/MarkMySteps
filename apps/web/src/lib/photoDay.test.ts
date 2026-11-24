import { describe, expect, it } from 'vitest';
import { localClock, photoDay } from './photoDay';

describe('photoDay', () => {
  it('puts 05:30 in Bangkok (22:30 UTC the day before) on the Bangkok day', () => {
    expect(photoDay({ takenAt: '2026-04-01T22:30:00.000Z', takenAtLocal: '2026-04-02T05:30:00.000Z' })).toBe(
      '2026-04-02',
    );
  });

  it('puts 20:00 in New York (01:00 UTC the day after) on the New York day', () => {
    expect(photoDay({ takenAt: '2026-07-05T00:00:00.000Z', takenAtLocal: '2026-07-04T20:00:00.000Z' })).toBe(
      '2026-07-04',
    );
  });

  it('falls back to the UTC date of takenAt without a local time', () => {
    expect(photoDay({ takenAt: '2026-04-01T22:30:00.000Z' })).toBe('2026-04-01');
    expect(photoDay({ takenAt: '2026-04-01T22:30:00.000Z', takenAtLocal: null })).toBe('2026-04-01');
  });
});

describe('localClock', () => {
  it("writes this device's clock as if it were UTC", () => {
    const ms = Date.UTC(2026, 3, 1, 22, 30);
    const d = new Date(ms);
    const wall = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(localClock(ms).slice(0, 10)).toBe(wall);
    expect(localClock(ms).slice(11, 16)).toBe(
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    );
  });
});
