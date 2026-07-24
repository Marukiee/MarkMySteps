import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TripsService } from '../trips/trips.service';

export interface TripNoteView {
  id: string;
  day: string; // yyyy-mm-dd
  title: string | null;
  body: string;
  authorId: string;
  authorName: string;
}

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trips: TripsService,
  ) {}

  async list(tripId: string, userId: string): Promise<TripNoteView[]> {
    await this.trips.getForMember(tripId, userId);
    const notes = await this.prisma.tripNote.findMany({
      where: { tripId },
      orderBy: { day: 'asc' },
      include: { author: { select: { displayName: true } } },
    });
    return notes.map((n) => ({
      id: n.id,
      day: n.day.toISOString().slice(0, 10),
      title: n.title,
      body: n.body,
      authorId: n.authorId,
      authorName: n.author.displayName,
    }));
  }

  /** One note per author per day: upsert on save. */
  async upsert(
    tripId: string,
    userId: string,
    day: string,
    body: string,
    title?: string,
  ): Promise<TripNoteView[]> {
    await this.trips.getForEditor(tripId, userId);
    const dayDate = new Date(day);
    await this.prisma.tripNote.upsert({
      where: { tripId_authorId_day: { tripId, authorId: userId, day: dayDate } },
      create: { tripId, authorId: userId, day: dayDate, body: body.trim(), title: title?.trim() },
      update: { body: body.trim(), title: title?.trim() },
    });
    return this.list(tripId, userId);
  }

  async remove(tripId: string, userId: string, noteId: string): Promise<void> {
    // Authors delete their own notes only.
    const { count } = await this.prisma.tripNote.deleteMany({
      where: { id: noteId, tripId, authorId: userId },
    });
    if (count === 0) throw new NotFoundException('Note not found');
  }
}
