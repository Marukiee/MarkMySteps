import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Stop } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TripsService } from '../trips/trips.service';
import { CreateStopDto, ReorderStopsDto, TravelModeDto, UpdateStopDto } from './dto/stop.dto';

/** Stop enriched with dates derived from trip start + preceding nights. */
export interface PlannedStop extends Stop {
  arrivalDate: string; // ISO date (yyyy-mm-dd)
  departureDate: string;
}

const DAY_MS = 86_400_000;

/** A `@db.Date` column comes back as UTC midnight, so this is exact. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

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
        select: { id: true, orderIndex: true, parentStopId: true },
      });

      let parentStopId: string | null = null;
      if (dto.parentStopId) {
        const parent = stops.find((s) => s.id === dto.parentStopId);
        if (!parent) throw new BadRequestException('parentStopId is not a stop of this trip');
        if (parent.parentStopId) {
          throw new BadRequestException('A day trip cannot itself have day trips');
        }
        parentStopId = parent.id;
      }

      // Parked at the end first; resequence() then puts every row in the
      // canonical order (route stops, each followed by its own day trips).
      const maxIndex = stops.reduce((max, s) => Math.max(max, s.orderIndex), -1);
      const created = await tx.stop.create({
        data: {
          ...(dto.id ? { id: dto.id } : {}),
          tripId,
          name: dto.name.trim(),
          // A day trip never consumes a night — that is the whole point: you
          // sleep at the parent stop and the dates after it don't move.
          nights: parentStopId ? 0 : dto.nights,
          latitude: dto.latitude,
          longitude: dto.longitude,
          countryCode: dto.countryCode?.toUpperCase(),
          travelMode: dto.travelMode,
          flightNumber: dto.flightNumber?.trim().toUpperCase(),
          fromAirport: dto.fromAirport?.trim().toUpperCase(),
          toAirport: dto.toAirport?.trim().toUpperCase(),
          viaAirports: dto.viaAirports?.map((a) => a.trim().toUpperCase()),
          notes: dto.notes?.trim(),
          parentStopId,
          dayTripDate: parentStopId && dto.dayTripDate ? new Date(dto.dayTripDate) : null,
          orderIndex: maxIndex + 1,
        },
        select: { id: true },
      });

      let routeOrder: string[] | undefined;
      if (!parentStopId) {
        const route = stops.filter((s) => !s.parentStopId).map((s) => s.id);
        let insertAt = route.length;
        if (dto.afterStopId) {
          const index = route.indexOf(dto.afterStopId);
          if (index === -1) throw new BadRequestException('afterStopId is not a stop of this trip');
          insertAt = index + 1;
        }
        route.splice(insertAt, 0, created.id);
        routeOrder = route;
      }
      await resequence(tx, tripId, routeOrder);
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
        ...(dto.dayTripDate !== undefined
          ? { dayTripDate: dto.dayTripDate ? new Date(dto.dayTripDate) : null }
          : {}),
        latitude: dto.latitude,
        longitude: dto.longitude,
        countryCode: dto.countryCode?.toUpperCase(),
        travelMode: dto.travelMode,
        flightNumber: clearFlight ? null : dto.flightNumber?.trim().toUpperCase(),
        fromAirport: clearFlight ? null : dto.fromAirport?.trim().toUpperCase(),
        toAirport: clearFlight ? null : dto.toAirport?.trim().toUpperCase(),
        viaAirports: clearFlight ? [] : dto.viaAirports?.map((a) => a.trim().toUpperCase()),
        notes: dto.notes?.trim(),
        hideLeg: dto.hideLeg,
      },
    });
    if (count === 0) throw new NotFoundException('Stop not found');

    // The other direction: a leg that BECOMES a flight must lose any road route
    // that was drawn along it, otherwise the old car line keeps being painted
    // next to the new flight arc.
    if (dto.travelMode === TravelModeDto.FLIGHT) {
      await this.clearRouteFillForLeg(tripId, stopId);
    }

    // Day trips are listed under their parent in date order, so moving one to
    // another day changes where it sits.
    if (dto.dayTripDate !== undefined) {
      await this.prisma.$transaction((tx) => resequence(tx, tripId));
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
      // Deleting a stop takes its day trips with it (ON DELETE CASCADE), so the
      // gap can be any size — resequence closes it whatever happened.
      await tx.stop.delete({ where: { id: stop.id } });
      await resequence(tx, tripId);
    });

    await this.syncTripEndDate(tripId);
    return this.list(tripId, userId);
  }

  /** Drag-and-drop reorder: client sends every stop id in the new order. */
  async reorder(tripId: string, userId: string, dto: ReorderStopsDto): Promise<PlannedStop[]> {
    await this.trips.getForEditor(tripId, userId);

    await this.prisma.$transaction(async (tx) => {
      const stops = await tx.stop.findMany({
        where: { tripId },
        select: { id: true, parentStopId: true },
      });
      // Only the route is draggable; day trips travel with their parent, so
      // their ids are simply ignored if the client sends them along.
      const route = new Set(stops.filter((s) => !s.parentStopId).map((s) => s.id));
      const order = dto.stopIds.filter((id) => route.has(id));
      if (order.length !== route.size || new Set(order).size !== order.length) {
        throw new BadRequestException('stopIds must contain every stop of the trip exactly once');
      }
      await resequence(tx, tripId, order);
    });

    return this.list(tripId, userId);
  }

  /** Trip end date follows the planner: start + total nights. Day trips are
   *  excursions, not nights, so they are excluded. */
  private async syncTripEndDate(tripId: string): Promise<void> {
    const trip = await this.prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      include: { stops: { where: { parentStopId: null }, select: { nights: true } } },
    });
    if (trip.stops.length === 0) return;
    const totalNights = trip.stops.reduce((sum, s) => sum + s.nights, 0);
    const endDate = new Date(trip.startDate.getTime() + totalNights * DAY_MS);
    if (endDate.getTime() !== trip.endDate.getTime()) {
      await this.prisma.trip.update({ where: { id: tripId }, data: { endDate } });
    }
  }
}

/**
 * Rewrites every orderIndex of a trip into the canonical order: the route in
 * sequence, and directly after each stop its own day trips (by date). One
 * ordering column for both kinds keeps the existing "just sort by orderIndex"
 * consumers working, and closing gaps this way survives a cascade delete that
 * removed several rows at once.
 *
 * `routeOrder` overrides the order of the route stops (a drag, or an insert).
 */
async function resequence(
  tx: Prisma.TransactionClient,
  tripId: string,
  routeOrder?: string[],
): Promise<void> {
  const all = await tx.stop.findMany({
    where: { tripId },
    orderBy: { orderIndex: 'asc' },
    select: { id: true, orderIndex: true, parentStopId: true, dayTripDate: true },
  });

  let route = all.filter((s) => !s.parentStopId);
  if (routeOrder) {
    const rank = new Map(routeOrder.map((id, i) => [id, i]));
    route = [...route].sort(
      (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  const children = new Map<string, typeof all>();
  for (const s of all) {
    if (!s.parentStopId) continue;
    children.set(s.parentStopId, [...(children.get(s.parentStopId) ?? []), s]);
  }

  const ordered: typeof all = [];
  for (const stop of route) {
    ordered.push(stop);
    const kids = (children.get(stop.id) ?? []).sort(
      (a, b) =>
        (a.dayTripDate?.getTime() ?? 0) - (b.dayTripDate?.getTime() ?? 0) ||
        a.orderIndex - b.orderIndex,
    );
    ordered.push(...kids);
    children.delete(stop.id);
  }
  // Defensive: a day trip whose parent is gone would otherwise lose its slot.
  for (const kids of children.values()) ordered.push(...kids);

  if (ordered.every((s, i) => s.orderIndex === i)) return;
  // Park at negative indexes first so the (tripId, orderIndex) unique
  // constraint never trips halfway through.
  for (const [index, stop] of ordered.entries()) {
    await tx.stop.update({ where: { id: stop.id }, data: { orderIndex: -(index + 1) } });
  }
  for (const [index, stop] of ordered.entries()) {
    await tx.stop.update({ where: { id: stop.id }, data: { orderIndex: index } });
  }
}

/**
 * Dates for the whole list. Only route stops advance the calendar: a day trip
 * is an excursion from the stop you are staying at, so it neither consumes a
 * night nor pushes anything after it. Its own date is stored explicitly; when
 * it is missing the day trip simply lands on its parent's arrival day.
 */
function withDates(stops: Stop[], tripStart: Date): PlannedStop[] {
  let cursor = tripStart.getTime();
  const arrivalOf = new Map<string, string>();
  const out: PlannedStop[] = [];

  for (const stop of stops) {
    if (stop.parentStopId) {
      const day =
        stop.dayTripDate != null
          ? isoDay(stop.dayTripDate)
          : arrivalOf.get(stop.parentStopId) ?? isoDay(new Date(cursor));
      out.push({ ...stop, arrivalDate: day, departureDate: day });
      continue;
    }
    const arrival = cursor;
    const departure = arrival + stop.nights * DAY_MS;
    cursor = departure;
    const arrivalDate = isoDay(new Date(arrival));
    arrivalOf.set(stop.id, arrivalDate);
    out.push({
      ...stop,
      arrivalDate,
      departureDate: isoDay(new Date(departure)),
    });
  }
  return out;
}
