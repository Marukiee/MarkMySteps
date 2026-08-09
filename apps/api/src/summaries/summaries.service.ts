import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TripsService } from '../trips/trips.service';

/** What the app gets back for one summary. The images are fetched separately. */
export interface TripSummaryInfo {
  id: string;
  tripId: string;
  title: string;
  template: string;
  scopeLabel: string;
  spec: unknown;
  createdAt: Date;
  createdBy: { id: string; displayName: string };
  pages: { index: number; width: number; height: number }[];
}

/** Plenty for a fortnight-long series, small enough to stay a sane request. */
const MAX_PAGES = 12;

@Injectable()
export class SummariesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trips: TripsService,
  ) {}

  /**
   * Everyone on the trip sees every summary made from it.
   *
   * A poster is a thing about the trip, not private correspondence: a
   * reisgenoot who made one has made it for the trip.
   */
  async list(tripId: string, userId: string): Promise<TripSummaryInfo[]> {
    await this.trips.getForMember(tripId, userId);
    const rows = await this.prisma.tripSummary.findMany({
      where: { tripId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, displayName: true } },
        // Never the bytes: a list of ten posters would be thirty megabytes.
        pages: { select: { index: true, width: true, height: true }, orderBy: { index: 'asc' } },
      },
    });
    return rows.map(toInfo);
  }

  async create(
    tripId: string,
    userId: string,
    data: { title: string; template: string; scopeLabel: string; spec: unknown },
    files: { buffer: Buffer; mimetype: string; width: number; height: number }[],
  ): Promise<TripSummaryInfo> {
    await this.trips.getForMember(tripId, userId);
    if (files.length === 0) throw new BadRequestException('A summary needs at least one page');
    if (files.length > MAX_PAGES) throw new BadRequestException(`At most ${MAX_PAGES} pages`);
    if (files.some((f) => !f.mimetype.startsWith('image/'))) {
      throw new BadRequestException('Pages must be images');
    }

    const created = await this.prisma.tripSummary.create({
      data: {
        tripId,
        userId,
        title: data.title,
        template: data.template,
        scopeLabel: data.scopeLabel,
        spec: (data.spec ?? {}) as Prisma.InputJsonValue,
        pages: {
          create: files.map((file, index) => ({
            index,
            // Prisma's Bytes wants a Uint8Array; a Node Buffer is one, but
            // strict TS does not believe it.
            image: new Uint8Array(file.buffer),
            mime: file.mimetype,
            width: file.width,
            height: file.height,
          })),
        },
      },
      include: {
        user: { select: { id: true, displayName: true } },
        pages: { select: { index: true, width: true, height: true }, orderBy: { index: 'asc' } },
      },
    });
    return toInfo(created);
  }

  async rename(
    tripId: string,
    userId: string,
    summaryId: string,
    title: string,
  ): Promise<TripSummaryInfo> {
    await this.assertMayEdit(tripId, userId, summaryId);
    const updated = await this.prisma.tripSummary.update({
      where: { id: summaryId },
      data: { title },
      include: {
        user: { select: { id: true, displayName: true } },
        pages: { select: { index: true, width: true, height: true }, orderBy: { index: 'asc' } },
      },
    });
    return toInfo(updated);
  }

  async remove(tripId: string, userId: string, summaryId: string): Promise<void> {
    await this.assertMayEdit(tripId, userId, summaryId);
    await this.prisma.tripSummary.delete({ where: { id: summaryId } });
  }

  /** One page's bytes, for the app to show or to hand to the share sheet. */
  async page(
    tripId: string,
    userId: string,
    summaryId: string,
    index: number,
  ): Promise<{ buffer: Uint8Array; mime: string }> {
    await this.trips.getForMember(tripId, userId);
    const page = await this.prisma.tripSummaryPage.findFirst({
      where: { index, summary: { id: summaryId, tripId } },
      select: { image: true, mime: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    return { buffer: page.image, mime: page.mime };
  }

  /** Whoever made it, and the owner of the trip it is about. */
  private async assertMayEdit(tripId: string, userId: string, summaryId: string): Promise<void> {
    const trip = await this.trips.getForMember(tripId, userId);
    const summary = await this.prisma.tripSummary.findFirst({
      where: { id: summaryId, tripId },
      select: { userId: true },
    });
    if (!summary) throw new NotFoundException('Summary not found');
    if (summary.userId !== userId && trip.ownerId !== userId) {
      throw new ForbiddenException('Only the maker or the trip owner can change this summary');
    }
  }
}

function toInfo(row: {
  id: string;
  tripId: string;
  title: string;
  template: string;
  scopeLabel: string;
  spec: unknown;
  createdAt: Date;
  user: { id: string; displayName: string };
  pages: { index: number; width: number; height: number }[];
}): TripSummaryInfo {
  return {
    id: row.id,
    tripId: row.tripId,
    title: row.title,
    template: row.template,
    scopeLabel: row.scopeLabel,
    spec: row.spec,
    createdAt: row.createdAt,
    createdBy: row.user,
    pages: row.pages,
  };
}
