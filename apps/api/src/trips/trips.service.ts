import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Trip, TripRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';

export type TripWithMembers = Trip & {
  members: { userId: string; role: TripRole; user: { displayName: string; email: string } }[];
};

const MEMBERS_INCLUDE = {
  members: {
    include: { user: { select: { displayName: true, email: true } } },
  },
} as const;

@Injectable()
export class TripsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, dto: CreateTripDto): Promise<TripWithMembers> {
    const { startDate, endDate } = parseDates(dto.startDate, dto.endDate);
    return this.prisma.trip.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim(),
        startDate,
        endDate,
        ownerId,
        members: { create: { userId: ownerId, role: TripRole.OWNER } },
      },
      include: MEMBERS_INCLUDE,
    });
  }

  listForUser(userId: string): Promise<TripWithMembers[]> {
    return this.prisma.trip.findMany({
      where: { members: { some: { userId } } },
      orderBy: { startDate: 'desc' },
      include: MEMBERS_INCLUDE,
    });
  }

  /** Returns the trip if `userId` is a member; 404 otherwise (no existence leak). */
  async getForMember(tripId: string, userId: string): Promise<TripWithMembers> {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, members: { some: { userId } } },
      include: MEMBERS_INCLUDE,
    });
    if (!trip) {
      throw new NotFoundException('Trip not found');
    }
    return trip;
  }

  async update(tripId: string, userId: string, dto: UpdateTripDto): Promise<TripWithMembers> {
    const trip = await this.getForMember(tripId, userId);
    this.assertOwner(trip, userId);

    const { startDate, endDate } = parseDates(
      dto.startDate ?? trip.startDate.toISOString(),
      dto.endDate ?? trip.endDate.toISOString(),
    );

    return this.prisma.trip.update({
      where: { id: tripId },
      data: {
        title: dto.title?.trim(),
        description: dto.description?.trim(),
        startDate,
        endDate,
      },
      include: MEMBERS_INCLUDE,
    });
  }

  async remove(tripId: string, userId: string): Promise<void> {
    const trip = await this.getForMember(tripId, userId);
    this.assertOwner(trip, userId);
    await this.prisma.trip.delete({ where: { id: tripId } });
  }

  async addMemberByEmail(tripId: string, userId: string, email: string): Promise<TripWithMembers> {
    const trip = await this.getForMember(tripId, userId);
    this.assertOwner(trip, userId);

    const invitee = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!invitee) {
      throw new NotFoundException('No account with that email on this server');
    }

    await this.prisma.tripMember.upsert({
      where: { tripId_userId: { tripId, userId: invitee.id } },
      create: { tripId, userId: invitee.id, role: TripRole.MEMBER },
      update: {},
    });

    return this.getForMember(tripId, userId);
  }

  async removeMember(tripId: string, userId: string, memberId: string): Promise<void> {
    const trip = await this.getForMember(tripId, userId);
    // Owners can remove anyone; members may remove themselves (leave).
    if (userId !== memberId) {
      this.assertOwner(trip, userId);
    }
    if (memberId === trip.ownerId) {
      throw new BadRequestException('The owner cannot leave their own trip');
    }
    await this.prisma.tripMember.delete({
      where: { tripId_userId: { tripId, userId: memberId } },
    });
  }

  private assertOwner(trip: Trip, userId: string): void {
    if (trip.ownerId !== userId) {
      throw new ForbiddenException('Only the trip owner can do this');
    }
  }
}

function parseDates(start: string, end: string): { startDate: Date; endDate: Date } {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (endDate < startDate) {
    throw new BadRequestException('endDate must be on or after startDate');
  }
  return { startDate, endDate };
}
