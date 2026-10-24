import { BadRequestException } from '@nestjs/common';
import { deflateRawSync, crc32 } from 'node:zlib';
import { PolarstepsImportService } from './polarsteps-import.service';

jest.mock('@prisma/client', () => ({
  PrismaClient: class {},
  PointSource: { IMPORTED: 'IMPORTED' },
  TripRole: { OWNER: 'OWNER' },
}));

const MiB = 1024 * 1024;

interface Entry {
  name: string;
  data: Buffer;
  /** What the zip *claims* the entry unpacks to. A bomb is a small file that claims a lot. */
  claimedSize?: number;
}

/** A zip written by hand, so the claimed size can be whatever the test needs. */
function buildZip(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const packed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data) >>> 0;
    const size = entry.claimedSize ?? entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(size, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);

    parts.push(local, name, packed);
    central.push(dir, name);
    offset += 30 + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

const tripJson = (name = 'Spain') =>
  Buffer.from(JSON.stringify({ name, start_date: 1_700_000_000, end_date: 1_700_864_000, all_steps: [] }));

const locationsJson = () =>
  Buffer.from(JSON.stringify([{ lat: 41.4, lon: 2.17, time: 1_700_000_100 }, { lat: 41.5, lon: 2.2, time: 1_700_000_200 }]));

function makeService() {
  const prisma = {
    trip: {
      create: jest.fn(async ({ data }: { data: { title: string; startDate: Date; endDate: Date } }) => ({
        id: 'trip-1',
        title: data.title,
        startDate: data.startDate,
        endDate: data.endDate,
      })),
    },
    locationPoint: { createMany: jest.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })) },
    stop: { createMany: jest.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })) },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new PolarstepsImportService(prisma as any), prisma };
}

describe('PolarstepsImportService.importZip', () => {
  it('imports a normal export', async () => {
    const { service, prisma } = makeService();
    const zip = buildZip([
      { name: 'Spain_1/trip.json', data: tripJson() },
      { name: 'Spain_1/locations.json', data: locationsJson() },
    ]);
    const result = await service.importZip('user-1', zip);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: 'Spain', pointsImported: 2 });
    expect(prisma.trip.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a file that unpacks to far more than any real export, without unpacking it', async () => {
    const { service, prisma } = makeService();
    // 200 MiB of zeros packs to about 200 KiB: a few kilobytes to upload,
    // a gigabyte or more to hold in memory once unpacked.
    const bomb = buildZip([
      { name: 'x/trip.json', data: tripJson() },
      { name: 'x/locations.json', data: Buffer.alloc(200 * MiB) },
    ]);
    expect(bomb.length).toBeLessThan(1 * MiB);

    const before = process.memoryUsage().rss;
    await expect(service.importZip('user-1', bomb)).rejects.toThrow(BadRequestException);
    await expect(service.importZip('user-1', bomb)).rejects.toThrow(/too large/i);
    expect(prisma.trip.create).not.toHaveBeenCalled();
    // Nothing near 200 MiB was ever allocated.
    expect(process.memoryUsage().rss - before).toBeLessThan(100 * MiB);
  });

  it('refuses a zip whose entries are each fine but together too much', async () => {
    const { service, prisma } = makeService();
    const entries: Entry[] = [];
    for (const folder of ['a', 'b', 'c']) {
      entries.push({ name: `${folder}/trip.json`, data: tripJson(folder) });
      entries.push({ name: `${folder}/locations.json`, data: Buffer.alloc(50 * MiB) });
    }
    await expect(service.importZip('user-1', buildZip(entries))).rejects.toThrow(/too large/i);
    expect(prisma.trip.create).not.toHaveBeenCalled();
  });

  it('refuses an entry that claims less than it holds, instead of crashing', async () => {
    const { service } = makeService();
    const liar = buildZip([
      { name: 'x/trip.json', data: tripJson() },
      { name: 'x/locations.json', data: Buffer.alloc(5 * MiB), claimedSize: 100 },
    ]);
    await expect(service.importZip('user-1', liar)).rejects.toThrow(BadRequestException);
  });

  it('does not count the photos in an export, only the two files it reads', async () => {
    const { service } = makeService();
    const zip = buildZip([
      { name: 'Spain_1/trip.json', data: tripJson() },
      { name: 'Spain_1/locations.json', data: locationsJson() },
      { name: 'Spain_1/photos/big.jpg', data: Buffer.alloc(300 * MiB) },
    ]);
    await expect(service.importZip('user-1', zip)).resolves.toHaveLength(1);
  });
});
