import { toAsset } from '../immich/immich-client.service';
import { onTripDays, parseLocalDateTime, photoDay } from './photo-day';

describe('photoDay', () => {
  it('puts 05:30 in Bangkok (22:30 UTC the day before) on the Bangkok day', () => {
    const takenAt = new Date('2026-04-01T22:30:00.000Z');
    const local = parseLocalDateTime('2026-04-02T05:30:00.000Z');
    expect(photoDay(takenAt, local)).toBe('2026-04-02');
  });

  it('puts 20:00 in New York (01:00 UTC the day after) on the New York day', () => {
    expect(photoDay(new Date('2026-07-05T00:00:00.000Z'), parseLocalDateTime('2026-07-04T20:00:00.000Z'))).toBe(
      '2026-07-04',
    );
  });

  it('falls back to the UTC date of takenAt without a local time', () => {
    expect(photoDay(new Date('2026-04-01T22:30:00.000Z'), null)).toBe('2026-04-01');
    expect(photoDay(new Date('2026-04-01T22:30:00.000Z'))).toBe('2026-04-01');
  });
});

describe('parseLocalDateTime', () => {
  it('reads the clock as written, with or without a Z', () => {
    expect(parseLocalDateTime('2026-04-02T05:30:00.000Z')?.toISOString()).toBe('2026-04-02T05:30:00.000Z');
    expect(parseLocalDateTime('2026-04-02T05:30:00')?.toISOString()).toBe('2026-04-02T05:30:00.000Z');
  });

  it('keeps the clock reading when an offset is written on it', () => {
    expect(parseLocalDateTime('2026-04-02T05:30:00+07:00')?.toISOString()).toBe('2026-04-02T05:30:00.000Z');
  });

  it('is null for nothing or nonsense', () => {
    expect(parseLocalDateTime(undefined)).toBeNull();
    expect(parseLocalDateTime('')).toBeNull();
    expect(parseLocalDateTime('not a date')).toBeNull();
  });
});

describe('onTripDays', () => {
  it('includes the first and last day', () => {
    expect(onTripDays('2026-04-02', '2026-04-02', '2026-04-10')).toBe(true);
    expect(onTripDays('2026-04-10', '2026-04-02', '2026-04-10')).toBe(true);
    expect(onTripDays('2026-04-01', '2026-04-02', '2026-04-10')).toBe(false);
    expect(onTripDays('2026-04-11', '2026-04-02', '2026-04-10')).toBe(false);
  });

  it('keeps a first-morning photo in Bangkok that is the day before in UTC', () => {
    const day = photoDay(new Date('2026-04-01T22:30:00.000Z'), parseLocalDateTime('2026-04-02T05:30:00.000Z'));
    expect(onTripDays(day, '2026-04-02', '2026-04-10')).toBe(true);
  });
});

describe('toAsset', () => {
  const raw = {
    id: 'a1',
    type: 'IMAGE',
    fileCreatedAt: '2026-04-01T22:30:00.000Z',
    exifInfo: { dateTimeOriginal: '2026-04-01T22:30:00.000Z' },
  };

  it("keeps Immich's localDateTime", () => {
    const asset = toAsset({ ...raw, localDateTime: '2026-04-02T05:30:00.000Z' });
    expect(asset.takenAt.toISOString()).toBe('2026-04-01T22:30:00.000Z');
    expect(asset.takenAtLocal?.toISOString()).toBe('2026-04-02T05:30:00.000Z');
  });

  it('has no local time when Immich gives none', () => {
    expect(toAsset(raw).takenAtLocal).toBeNull();
  });
});
