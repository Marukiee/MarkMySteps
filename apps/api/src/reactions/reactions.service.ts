import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TripsService } from '../trips/trips.service';

/** The five a photo or a comment can get. The page maps each to its emoji. */
export const REACTION_KINDS = ['heart', 'laugh', 'wow', 'love', 'clap'] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

/** What an emoji is on: a photo, or a comment under a photo or a day. */
export type ReactionTarget = { mediaId: string } | { commentId: string };

/**
 * Targets in the view are strings: a photo by its media id, a comment as
 * `c:<comment id>`, so the page keeps one map for both.
 */
export interface ReactionsView {
  counts: { target: string; kind: string; count: number }[];
  /** The caller's own pick, per target. */
  mine: Record<string, string>;
  /** Who reacted, when known; only for the people on the trip. */
  names?: Record<string, { kind: string; name: string }[]>;
}

const commentKey = (id: string) => `c:${id}`;

@Injectable()
export class ReactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trips: TripsService,
  ) {}

  /** Visitors on the share page, by their browser key. */
  listPublic(tripId: string, reactorKey: string | undefined): Promise<ReactionsView> {
    return this.view(tripId, reactorKey, false);
  }

  async setPublic(
    tripId: string,
    target: ReactionTarget,
    reactorKey: string,
    kind: string | null,
    name: string | null,
  ): Promise<void> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(reactorKey)) {
      throw new BadRequestException('Invalid reactor key');
    }
    await this.set(tripId, target, reactorKey, kind, name);
  }

  /** The people on the trip, under their own account. */
  async list(tripId: string, userId: string): Promise<ReactionsView> {
    await this.trips.getForMember(tripId, userId);
    return this.view(tripId, `user:${userId}`, true);
  }

  async setMine(
    tripId: string,
    userId: string,
    target: ReactionTarget,
    kind: string | null,
  ): Promise<void> {
    await this.trips.getForMember(tripId, userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { displayName: true },
    });
    await this.set(tripId, target, `user:${userId}`, kind, user.displayName);
  }

  /** Picking one swaps it, picking none takes it away. */
  private async set(
    tripId: string,
    target: ReactionTarget,
    reactorKey: string,
    kind: string | null,
    name: string | null,
  ): Promise<void> {
    if (kind !== null && !(REACTION_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException('Unknown reaction');
    }

    if ('mediaId' in target) {
      const { mediaId } = target;
      const count = await this.prisma.mediaRef.count({ where: { id: mediaId, tripId } });
      if (count === 0) throw new NotFoundException('Media not found');
      if (kind === null) {
        await this.prisma.photoReaction.deleteMany({ where: { mediaId, reactorKey } });
        return;
      }
      await this.prisma.photoReaction.upsert({
        where: { mediaId_reactorKey: { mediaId, reactorKey } },
        create: { tripId, mediaId, reactorKey, kind, name },
        update: { kind, ...(name ? { name } : {}) },
      });
      return;
    }

    const { commentId } = target;
    const count = await this.prisma.photoComment.count({ where: { id: commentId, tripId } });
    if (count === 0) throw new NotFoundException('Comment not found');
    if (kind === null) {
      await this.prisma.commentReaction.deleteMany({ where: { commentId, reactorKey } });
      return;
    }
    await this.prisma.commentReaction.upsert({
      where: { commentId_reactorKey: { commentId, reactorKey } },
      create: { tripId, commentId, reactorKey, kind, name },
      update: { kind, ...(name ? { name } : {}) },
    });
  }

  private async view(
    tripId: string,
    reactorKey: string | undefined,
    withNames: boolean,
  ): Promise<ReactionsView> {
    const [photoCounts, commentCounts, photoMine, commentMine, photoNamed, commentNamed] =
      await Promise.all([
        this.prisma.photoReaction.groupBy({
          by: ['mediaId', 'kind'],
          where: { tripId },
          _count: { _all: true },
        }),
        this.prisma.commentReaction.groupBy({
          by: ['commentId', 'kind'],
          where: { tripId },
          _count: { _all: true },
        }),
        reactorKey
          ? this.prisma.photoReaction.findMany({
              where: { tripId, reactorKey },
              select: { mediaId: true, kind: true },
            })
          : Promise.resolve([]),
        reactorKey
          ? this.prisma.commentReaction.findMany({
              where: { tripId, reactorKey },
              select: { commentId: true, kind: true },
            })
          : Promise.resolve([]),
        withNames
          ? this.prisma.photoReaction.findMany({
              where: { tripId, name: { not: null } },
              orderBy: { createdAt: 'asc' },
              select: { mediaId: true, kind: true, name: true },
            })
          : Promise.resolve([]),
        withNames
          ? this.prisma.commentReaction.findMany({
              where: { tripId, name: { not: null } },
              orderBy: { createdAt: 'asc' },
              select: { commentId: true, kind: true, name: true },
            })
          : Promise.resolve([]),
      ]);

    const view: ReactionsView = {
      counts: [
        ...photoCounts.map((c) => ({ target: c.mediaId, kind: c.kind, count: c._count._all })),
        ...commentCounts.map((c) => ({
          target: commentKey(c.commentId),
          kind: c.kind,
          count: c._count._all,
        })),
      ],
      mine: Object.fromEntries([
        ...photoMine.map((m) => [m.mediaId, m.kind]),
        ...commentMine.map((m) => [commentKey(m.commentId), m.kind]),
      ]),
    };
    if (withNames) {
      const names: NonNullable<ReactionsView['names']> = {};
      const add = (key: string, kind: string, name: string) =>
        (names[key] ??= []).push({ kind, name });
      for (const r of photoNamed) add(r.mediaId, r.kind, r.name!);
      for (const r of commentNamed) add(commentKey(r.commentId), r.kind, r.name!);
      view.names = names;
    }
    return view;
  }
}
