import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import type { Response as ExpressResponse } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ImmichClientService } from '../immich/immich-client.service';
import { ImmichConnectionService } from '../immich/immich-connection.service';
import { GeotagResult, ImmichGeotagService } from '../immich/immich-geotag.service';
import { ImmichSyncService, SyncResult } from '../immich/immich-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { TripsService } from '../trips/trips.service';
import { MediaItem, MediaService } from './media.service';

interface VideoTokenPayload {
  scope: 'media-video';
  mediaId: string;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly trips: TripsService,
    private readonly sync: ImmichSyncService,
    private readonly geotag: ImmichGeotagService,
    private readonly connections: ImmichConnectionService,
    private readonly immich: ImmichClientService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * The <video> element cannot send an Authorization header, so playback
   * uses a short-lived token in the URL. This endpoint (JWT-guarded) hands
   * out that URL after the usual trip-membership check.
   */
  @Get('media/:id/video-url')
  async videoUrl(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ url: string }> {
    const media = await this.media.getForRequester(id, user.sub);
    const payload: VideoTokenPayload = { scope: 'media-video', mediaId: media.id };
    const token = await this.jwt.signAsync(payload, { expiresIn: '15m' });
    return { url: `/api/media/${media.id}/video?t=${token}` };
  }

  /** List trip media; `?users=id1,id2` filters by traveller. */
  @Get('trips/:tripId/media')
  list(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Query('users') users?: string,
  ): Promise<MediaItem[]> {
    const userIds = users
      ?.split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    return this.media.listForTrip(tripId, user.sub, userIds);
  }

  /** Manually trigger an Immich sync for a trip (any traveller, not guests). */
  @Post('trips/:tripId/sync')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async triggerSync(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ): Promise<SyncResult> {
    await this.trips.getForEditor(tripId, user.sub);
    return this.sync.syncTrip(tripId);
  }

  /**
   * Places the trip's position-less photos from its tracked route, without
   * pulling Immich again. A sync does this by itself; this is the button for
   * a trip that finished long ago, or one whose track arrived after its
   * photos did.
   */
  @Post('trips/:tripId/geotag')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async geotagTrip(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ): Promise<GeotagResult> {
    await this.trips.getForEditor(tripId, user.sub);
    return this.geotag.geotagTrip(tripId);
  }

  /**
   * Thumbnail proxy: streams the preview straight from the owner's Immich
   * server using their (decrypted, in-memory) API key. Nothing is written
   * to disk. Higher rate limit — photo grids fire many of these.
   */
  @Get('media/:id/thumbnail')
  @Throttle({ default: { ttl: 60_000, limit: 600 } })
  async thumbnail(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: ExpressResponse,
  ): Promise<void> {
    const media = await this.media.getForRequester(id, user.sub);

    const credentials = await this.connections.getCredentials(media.userId);
    if (!credentials) {
      throw new NotFoundException('The owner of this photo has no Immich connection');
    }

    const upstream = await this.immich.fetchThumbnail(
      credentials.serverUrl,
      credentials.apiKey,
      media.immichAssetId,
    );

    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg');
    // Private: responses are per-user authorized; never cache in shared proxies.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    if (upstream.body) {
      Readable.fromWeb(upstream.body as NodeReadableStream).pipe(res);
    } else {
      res.end();
    }
  }
}

/**
 * Video playback proxy. Separate controller WITHOUT the JWT guard: the
 * <video> element cannot send headers, so authorization happens via the
 * short-lived token minted by GET /media/:id/video-url. Range requests are
 * passed through to Immich so seeking works.
 */
@Controller('media')
export class MediaVideoController {
  constructor(
    private readonly jwt: JwtService,
    private readonly media: MediaService,
    private readonly connections: ImmichConnectionService,
    private readonly immich: ImmichClientService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':id/video')
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  async video(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('t') token: string | undefined,
    @Headers('range') range: string | undefined,
    @Res() res: ExpressResponse,
  ): Promise<void> {
    if (!token) throw new UnauthorizedException('Missing video token');
    let payload: VideoTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<VideoTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired video token');
    }
    if (payload.scope !== 'media-video' || payload.mediaId !== id) {
      throw new UnauthorizedException('Invalid video token');
    }

    const media = await this.prisma.mediaRef.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media not found');
    const credentials = await this.connections.getCredentials(media.userId);
    if (!credentials) throw new NotFoundException('Media unavailable');

    const upstream = await this.immich.fetchVideo(
      credentials.serverUrl,
      credentials.apiKey,
      media.immichAssetId,
      range,
    );

    res.status(upstream.status);
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader('Cache-Control', 'private, no-store');
    if (upstream.body) {
      Readable.fromWeb(upstream.body as NodeReadableStream).pipe(res);
    } else {
      res.end();
    }
  }
}
