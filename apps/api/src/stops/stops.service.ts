import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Stop } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TripsService } from '../trips/trips.service';
import { CreateStopDto, ReorderStopsDto, TravelModeDto, UpdateStopDto } from './dto/stop.dto';

/** Stop enriched with dates derived from trip start + preceding nights. */
export interface PlannedStop extends Stop {
  arrivalDate: string; // ISO date (yyyy-mm-dd)
  departureDate: string;
}

const DAY_MS = 86_400_000;

@Injectable()
export class StopsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trips: TripsService,
  ) {}

  async list(tripId: string, userId: string): Promise<PlannedStop[]> {
    await this.trips.getForMember(tripId, userId);
    return this.listUnchecked(tripId);
  }

  /** No membership check — caller must have authorized access (share links). */
  async listUnchecked(tripId: string): Promise<PlannedStop[]> {
    const trip = await this.prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    const stops = await this.prisma.stop.findMany({
      where: { tripId },
      orderBy: { orderIndex: 'asc' },
    });
    return withDates(stops, trip.startDate);
  }

  async create(tripId: string, userId: string, dto: CreateStopDto): Promise<PlannedStop[]> {
    await this.trips.getForEditor(tripId, userId);

    await this.prisma.$transaction(async (tx) => {
      const stops = await tx.stop.findMany({
        where: { tripId },
        orderBy: { orderIndex: 'asc' },
        select: { id: true },
      });

      let insertAt = stops.length;
      if (dto.afterStopId) {
        const index = stops.findIndex((s) => s.id === dto.afterStopId);
        if (index === -1) throw new BadRequestException('afterStopId is not a stop of this trip');
        insertAt = index + 1;
      }

      // Shift everything at/after the insertion point one slot to the right.
      // Two passes keep the (tripId, orderIndex) unique constraint satisfied.
      const toShift = stops.slice(insertAt).reverse();
      for (const [offset, stop] of toShift.entries()) {
        const currentIndex = stops.length - 1 - offset;
        await tx.stop.update({
          where: { id: stop.id },
          data: { orderIndex: currentIndex + 1 },
        });
      }

      await tx.stop.create({
        data: {
          tripId,
          name: dto.name.trim(),
          nights: dto.nights,
          latitude: dto.latitude,
          longitude: dto.longitude,
          countryCode: dto.countryCode?.toUpperCase(),
          travelMode: dto.travelMode,
          flightNumber: dto.flightNumber?.trim().toUpperCase(),
          fromAirport: dto.fromAirport?.trim().toUpperCase(),
          toAirport: dto.toAirport?.trim().toUpperCase(),
          viaAirports: dto.viaAirports?.map((a) => a.trim().toUpperCase()),
          notes: dto.notes?.trim(),
          orderIndex: insertAt,
        },
      });
    });

    await this.syncTripEndDate(tripId);
    return this.list(tripId, userId);
  }

  async update(
    tripId: string,
    userId: string,
    stopId: string,
    dto: UpdateStopDto,
  ): Promise<PlannedStop[]> {
    await this.trips.getForEditor(tripId, userId);
    // Switching a leg away from FLIGHT clears its airports/flight number, so no
    // stale flight arc keeps drawing on the map/globe.
    const clearFlight =
      dto.travelMode !== undefined && dto.travelMode !== TravelModeDto.FLIGHT;
    const { count } = await this.prisma.stop.updateMany({
      where: { id: stopId, tripId },
      data: {
        name: dto.name?.trim(),
        nights: dto.nights,
        latitude: dto.latitude,
        longitude: dto.longitude,
        countryCode: dto.countryCode?.toUpperCase(),
        travelMode: dto.travelMode,
        flightNumber: clearFlight ? null : dto.flightNumber?.trim().toUpperCase(),
        fromAirport: clearFlight ? null : dto.fromAirport?.trim().toUpperCase(),
        toAirport: clearFlight ? null : dto.toAirport?.trim().toUpperCase(),
        viaAirports: clearFlight ? [] : dto.viaAirports?.map((a) => a.trim().toUpperCase()),
        notes: dto.notes?.trim(),
      },
    });
    if (count === 0) throw new NotFoundException('Stop not found');

    // The other direction: a leg that BECOMES a flight must lose any road route
    // that was drawn along it, otherwise the old car line keeps being painted
    // next to the new flight arc.
    if (dto.travelMode === TravelModeDto.FLIGHT) {
      await this.clearRouteFillForLeg(tripId, stopId);
    }

    await this.syncTripEndDate(tripId);
    return this.list(tripId, userId);
  }

  /**
   * Deletes auto-drawn road points (source ROUTE_FILL) that lie along the leg
   * ending at `stopId`. Matching is geographic: a corridor around the straight
   * line between this stop and the previous one with coordinates. ST_DWithin
   * measures to the SEGMENT, so it doesn't reach past either endpoint and fills
   * belonging to other legs are left alone.
   */
  private async clearRouteFillForLeg(tripId: string, stopId: string): Promise<void> {
    const stops = await this.prisma.stop.findMany({
      where: { tripId },
      orderBy: { orderIndex: 'asc' },
      select: { id: true, latitude: true, longitude: true },
    });
    const index = stops.findIndex((s) => s.id === stopId);
    if (index < 1) return;
    const current = stops[index];
    const previous = stops
      .slice(0, index)
      .reverse()
      .find((s) => s.latitude != null && s.longitude != null);
    if (
      current?.latitude == null ||
      current.longitude == null ||
      previous?.latitude == null ||
      previous.longitude == null
    ) {
      return;
    }

    const CORRIDOR_M = 60_000; // a road can wander a fair way off the straight line
    await this.prisma.$executeRaw`
      DELETE FROM location_points
      WHERE "tripId" = ${tripId}::uuid
        AND source = 'ROUTE_FILL'
        AND ST_DWithin(
              geom,
              ST_MakeLine(
                ST_SetSRID(ST_MakePoint(${previous.longitude}, ${previous.latitude}), 4326),
                ST_SetSRID(ST_MakePoint(${current.longitude}, ${current.latitude}), 4326)
              )::geography,
              ${CORRIDOR_M}
            )
    `;
  }

  async remove(tripId: string, userId: string, stopId: string): Promise<PlannedStop[]> {
    await this.trips.getForEditor(tripId, userId);

    await this.prisma.$transaction(async (tx) => {
      const stop = await tx.stop.findFirst({ where: { id: stopId, tripId } });
      if (!stop) throw new NotFoundException('Stop not found');
      await tx.stop.delete({ where: { id: stop.id } });
      // Close the gap.
      const later = await tx.stop.findMany({
        where: { tripId, orderIndex: { gt: stop.orderIndex } },
        orderBy: { orderIndex: 'asc' },
      });
      for (const s of later) {
        await tx.stop.update({ where: { id: s.id }, data: { orderIndex: s.orderIndex - 1 } });
      }
    });

    await this.syncTripEndDate(tripId);
    return this.list(tripId, userId);
  }

  /** Drag-and-drop reorder: client sends every stop id in the new order. */
  async reorder(tripId: string, userId: string, dto: ReorderStopsDto): Promise<PlannedStop[]> {
    await this.trips.getForEditor(tripId, userId);

    await this.prisma.$transaction(async (tx) => {
      const stops = await tx.stop.findMany({ where: { tripId }, select: { id: true } });
      const known = new Set(stops.map((s) => s.id));
      if (
        dto.stopIds.length !== stops.length ||
        !dto.stopIds.every((id) => known.has(id)) ||
        new Set(dto.stopIds).size !== dto.stopIds.length
      ) {
        throw new BadRequestException('stopIds must contain every stop of the trip exactly once');
      }

      // Park at negative indexes first so the unique constraint never trips.
      for (const [index, id] of dto.stopIds.entries()) {
        await tx.stop.update({ where: { id }, data: { orderIndex: -(index + 1) } });
      }
      for (const [index, id] of dto.stopIds.entries()) {
        await tx.stop.update({ where: { id }, data: { orderIndex: index } });
      }
    });

    return this.list(tripId, userId);
  }

  /** Trip end date follows the planner: start + total nights. */
  private async syncTripEndDate(tripId: string): Promise<void> {
    const trip = await this.prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      include: { stops: { select: { nights: true } } },
    });
    if (trip.stops.length === 0) return;
    const totalNights = trip.stops.reduce((sum, s) => sum + s.nights, 0);
    const endDate = new Date(trip.startDate.getTime() + totalNights * DAY_MS);
    if (endDate.getTime() !== trip.endDate.getTime()) {
      await this.prisma.trip.update({ where: { id: tripId }, data: { endDate } });
    }
  }
}

function withDates(stops: Stop[], tripStart: Date): PlannedStop[] {
  let cursor = tripStart.getTime();
  return stops.map((stop) => {
    const arrival = cursor;
    const departure = arrival + stop.nights * DAY_MS;
    cursor = departure;
    return {
      ...stop,
      arrivalDate: new Date(arrival).toISOString().slice(0, 10),
      departureDate: new Date(departure).toISOString().slice(0, 10),
    };
  });
}
