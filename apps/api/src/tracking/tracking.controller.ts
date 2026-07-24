import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
// (Get is used by the new manual-points listing endpoint.)
import { Throttle } from '@nestjs/throttler';
import { LocationPoint } from '@prisma/client';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ManualPointDto, RouteFillDto, TrackBatchDto } from './dto/track-points.dto';
import { BatchResult, LiveFix, RouteCollection, TrackingService } from './tracking.service';

@Controller('trips/:tripId')
@UseGuards(JwtAuthGuard)
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  /** Offline-buffered batch upload from the mobile tracker. Idempotent. */
  @Post('points/batch')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  ingest(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: TrackBatchDto,
  ): Promise<BatchResult> {
    return this.tracking.ingestBatch(tripId, user.sub, dto.points);
  }

  /** Manual waypoints (for shaping/detailing the route). */
  @Get('points')
  listManual(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ): Promise<{ id: string; latitude: number; longitude: number; recordedAt: string }[]> {
    return this.tracking.listManualPoints(tripId, user.sub);
  }

  /** Hand-placed point to complete the route. */
  @Post('points')
  addManual(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: ManualPointDto,
  ): Promise<LocationPoint> {
    return this.tracking.addManualPoint(tripId, user.sub, dto);
  }

  /** Wipe the caller's tracked route data (optionally just one day). */
  @Delete('tracked')
  clearTracked(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Query('day') day?: string,
  ): Promise<{ deleted: number }> {
    return this.tracking.clearTracked(tripId, user.sub, day);
  }

  @Delete('points/:pointId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removePoint(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('pointId', ParseUUIDPipe) pointId: string,
  ): Promise<void> {
    await this.tracking.removePoint(tripId, user.sub, pointId);
  }

  /**
   * Simplified per-traveller routes (GeoJSON FeatureCollection).
   * `?users=id1,id2` filters travellers; `?tolerance=` tunes simplification;
   * `?photos=false` excludes photo EXIF locations from the line.
   */
  @Get('route')
  route(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Query('users') users?: string,
    @Query('tolerance') tolerance?: string,
    @Query('photos') photos?: string,
  ): Promise<RouteCollection> {
    return this.tracking.getRoutes(tripId, user.sub, {
      userIds: users
        ?.split(',')
        .map((id) => id.trim())
        .filter(Boolean),
      tolerance: tolerance ? Number(tolerance) : undefined,
      includePhotos: photos !== 'false',
    });
  }

  /** Snap the nearest straight gap in your line to real roads (keyless OSM). */
  @Post('route-fill')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  fillRoute(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: RouteFillDto,
  ): Promise<{ added: number }> {
    return this.tracking.fillRoute(tripId, user.sub, dto.lng, dto.lat);
  }

  /** Latest fix per travelling member — for the live map. */
  @Get('live')
  live(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ): Promise<LiveFix[]> {
    return this.tracking.getLiveFixes(tripId, user.sub);
  }
}
