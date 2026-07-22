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
import { Throttle } from '@nestjs/throttler';
import { LocationPoint } from '@prisma/client';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ManualPointDto, TrackBatchDto } from './dto/track-points.dto';
import { BatchResult, RouteCollection, TrackingService } from './tracking.service';

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

  /** Hand-placed point to complete the route. */
  @Post('points')
  addManual(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: ManualPointDto,
  ): Promise<LocationPoint> {
    return this.tracking.addManualPoint(tripId, user.sub, dto);
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
}
