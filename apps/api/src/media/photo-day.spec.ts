import { toAsset } from '../immich/immich-client.service';
import { onTripDays, parseLocalDateTime, photoDay, photosOnTrip } from './photo-day';

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

describe('photosOnTrip', () => {
  const start = new Date('2026-04-02T00:00:00.000Z');
  const end = new Date('2026-04-10T00:00:00.000Z');
  const photo = (id: string, takenAt: string, local: string | null) => ({
    id,
    takenAt: new Date(takenAt),
    takenAtLocal: parseLocalDateTime(local),
  });

  it('keeps 05:30 on the first morning in Bangkok, the day before in UTC', () => {
    const kept = photosOnTrip([photo('dawn', '2026-04-01T22:30:00.000Z', '2026-04-02T05:30:00.000Z')], start, end);
    expect(kept.map((p) => p.id)).toEqual(['dawn']);
  });

  it('never drops a photo the UTC date kept before: the local day only adds', () => {
    // 06:00 on 11 April in Bangkok is 23:00 UTC on 10 April, the last day. It was on the trip before the local
    // day was known; dropping it would take its comments and reactions with it.
    const kept = photosOnTrip([photo('after', '2026-04-10T23:00:00.000Z', '2026-04-11T06:00:00.000Z')], start, end);
    expect(kept.map((p) => p.id)).toEqual(['after']);
  });

  it('drops a photo outside the trip by both its local day and its UTC date', () => {
    const kept = photosOnTrip([photo('later', '2026-04-12T10:00:00.000Z', '2026-04-12T17:00:00.000Z')], start, end);
    expect(kept).toEqual([]);
  });

  it('keeps the last evening in New York, the day after in UTC', () => {
    const kept = photosOnTrip([photo('dusk', '2026-04-11T01:00:00.000Z', '2026-04-10T21:00:00.000Z')], start, end);
    expect(kept.map((p) => p.id)).toEqual(['dusk']);
  });

  it('goes by the UTC date for a photo without a local time', () => {
    const kept = photosOnTrip(
      [
        photo('before', '2026-04-01T22:30:00.000Z', null),
        photo('first', '2026-04-02T08:00:00.000Z', null),
        photo('after', '2026-04-11T01:00:00.000Z', null),
      ],
      start,
      end,
    );
    expect(kept.map((p) => p.id)).toEqual(['first']);
  });
});
