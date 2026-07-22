import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response as ExpressResponse } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ImmichClientService } from '../immich/immich-client.service';
import { ImmichConnectionService } from '../immich/immich-connection.service';
import { ImmichSyncService, SyncResult } from '../immich/immich-sync.service';
import { TripsService } from '../trips/trips.service';
import { MediaItem, MediaService } from './media.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly trips: TripsService,
    private readonly sync: ImmichSyncService,
    private readonly connections: ImmichConnectionService,
    private readonly immich: ImmichClientService,
  ) {}

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

  /** Manually trigger an Immich sync for a trip (any member may). */
  @Post('trips/:tripId/sync')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async triggerSync(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ): Promise<SyncResult> {
    await this.trips.getForMember(tripId, user.sub); // membership check
    return this.sync.syncTrip(tripId);
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
