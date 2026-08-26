import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response as ExpressResponse } from 'express';
// (Get is used by the new manual-points listing endpoint.)
import { Throttle } from '@nestjs/throttler';
import { LocationPoint } from '@prisma/client';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ManualPointDto,
  MovePointDto,
  RouteFillDto,
  TrackBatchDto,
  TrainFillDto,
} from './dto/track-points.dto';
import { TrackFileService, TrackImportResult } from './track-file.service';
import {
  BatchResult,
  LiveFix,
  RouteCollection,
  TrackedPoint,
  TrackingService,
} from './tracking.service';

@Controller('trips/:tripId')
@UseGuards(JwtAuthGuard)
export class TrackingController {
  constructor(
    private readonly tracking: TrackingService,
    private readonly files: TrackFileService,
  ) {}

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

  /** Every raw fix of one calendar day — the "does this route look right?" view. */
  @Get('points/day')
  listDay(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Query('day') day: string,
  ): Promise<TrackedPoint[]> {
    return this.tracking.listDayPoints(tripId, user.sub, day);
  }

  /** Which days have points, so the editor can offer them. */
  @Get('points/days')
  listDays(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ): Promise<{ day: string; count: number }[]> {
    return this.tracking.listTrackedDays(tripId, user.sub);
  }

  /** Drag a stored fix to where you actually were. */
  @Patch('points/:pointId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async movePoint(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('pointId', ParseUUIDPipe) pointId: string,
    @Body() dto: MovePointDto,
  ): Promise<void> {
    await this.tracking.movePoint(tripId, user.sub, pointId, dto.latitude, dto.longitude);
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

  /**
   * Remove the auto-drawn road routes; keeps real tracked GPS. With `lng`/`lat`
   * only the one drawn stretch nearest that point goes, so a route drawn by
   * mistake can be taken back without losing the others.
   */
  @Delete('route-fill')
  clearRouteFills(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Query('lng') lng?: string,
    @Query('lat') lat?: string,
  ): Promise<{ deleted: number }> {
    if (lng !== undefined && lat !== undefined) {
      return this.tracking.clearRouteFillNear(tripId, user.sub, Number(lng), Number(lat));
    }
    return this.tracking.clearRouteFills(tripId, user.sub);
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
    @Query('day') day?: string,
  ): Promise<RouteCollection> {
    return this.tracking.getRoutes(tripId, user.sub, {
      userIds: users
        ?.split(',')
        .map((id) => id.trim())
        .filter(Boolean),
      tolerance: tolerance ? Number(tolerance) : undefined,
      includePhotos: photos !== 'false',
      day: day || undefined,
    });
  }

  /**
   * The trip as a track file. Sent as a download so a phone's browser hands it
   * to the share sheet rather than showing XML on screen.
   */
  @Get('export/:format')
  async exportTrack(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('format') format: string,
    @Res() res: ExpressResponse,
  ): Promise<void> {
    const wantsKml = format.toLowerCase() === 'kml';
    if (!wantsKml && format.toLowerCase() !== 'gpx') {
      throw new BadRequestException('Format must be gpx or kml');
    }
    const file = wantsKml
      ? await this.files.exportKml(tripId, user.sub)
      : await this.files.exportGpx(tripId, user.sub);

    res.setHeader('content-type', wantsKml ? 'application/vnd.google-earth.kml+xml' : 'application/gpx+xml');
    res.setHeader('content-disposition', `attachment; filename="${file.filename}"`);
    res.send(file.body);
  }

  /** Read a GPX/KML file into this trip as your own track. */
  @Post('import-track')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 60 * 1024 * 1024 } }))
  importTrack(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<TrackImportResult> {
    if (!file) {
      throw new BadRequestException('Upload the track as multipart field "file"');
    }
    return this.files.importFile(tripId, user.sub, file.originalname, file.buffer.toString('utf8'));
  }

  /** Which days of this trip have a track or a photo on them. */
  @Get('days')
  days(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ): Promise<{ day: string; points: number; photos: number }[]> {
    return this.tracking.listTripDays(tripId, user.sub);
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

  /** Draw the stretch between two stations over real track (keyless OSM). */
  @Post('route-fill/train')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  fillTrainRoute(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: TrainFillDto,
  ): Promise<{ added: number }> {
    return this.tracking.fillTrainRoute(tripId, user.sub, dto.lng, dto.lat, dto.from, dto.to);
  }

  /** Whether an auto-drawn stretch sits near this point, so a long press can
   *  ask the right question before it does anything. */
  @Get('route-fill/near')
  routeFillNear(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Query('lng') lng: string,
    @Query('lat') lat: string,
  ): Promise<{ near: boolean }> {
    return this.tracking.hasRouteFillNear(tripId, user.sub, Number(lng), Number(lat));
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
