import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response as ExpressResponse } from 'express';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ImmichClientService } from '../immich/immich-client.service';
import { ImmichConnectionService } from '../immich/immich-connection.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlannedStop, StopsService } from '../stops/stops.service';
import { RouteCollection, TrackingService } from '../tracking/tracking.service';
import { TripsService } from '../trips/trips.service';
import { ShareLinkInfo, ShareService, ShareTokenPayload } from './share.service';

class CreateShareDto {
  @IsOptional()
  @IsString()
  @Length(4, 128)
  password?: string;
}

class UnlockShareDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;
}

/** Owner-side management of a trip's share links. */
@Controller('trips/:tripId/share')
@UseGuards(JwtAuthGuard)
export class ShareManagementController {
  constructor(private readonly share: ShareService) {}

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  create(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: CreateShareDto,
  ): Promise<ShareLinkInfo> {
    return this.share.create(tripId, user.sub, dto.password);
  }

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ): Promise<ShareLinkInfo[]> {
    return this.share.list(tripId, user.sub);
  }

  @Delete(':linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
  ): Promise<void> {
    await this.share.remove(tripId, user.sub, linkId);
  }
}

/**
 * Public, unauthenticated share endpoints. A session token (obtained via
 * the unlock endpoint, password-checked when set) scopes every data
 * request to exactly one trip, read-only.
 */
@Controller('share')
@Throttle({ default: { ttl: 60_000, limit: 60 } })
export class SharePublicController {
  constructor(
    private readonly share: ShareService,
    private readonly tracking: TrackingService,
    private readonly stops: StopsService,
    private readonly trips: TripsService,
    private readonly prisma: PrismaService,
    private readonly connections: ImmichConnectionService,
    private readonly immich: ImmichClientService,
  ) {}

  @Get(':slug/info')
  info(@Param('slug') slug: string): Promise<{ title: string; hasPassword: boolean }> {
    return this.share.publicInfo(slug);
  }

  @Post(':slug/session')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  unlock(@Param('slug') slug: string, @Body() dto: UnlockShareDto): Promise<{ token: string }> {
    return this.share.createSession(slug, dto.password);
  }

  @Get(':slug/trip')
  async trip(@Param('slug') slug: string, @Headers('x-share-token') token: string) {
    const session = await this.requireSession(slug, token);
    const trip = await this.prisma.trip.findUniqueOrThrow({
      where: { id: session.tripId },
      select: {
        title: true,
        description: true,
        startDate: true,
        endDate: true,
        coverMediaId: true,
        members: { select: { userId: true, user: { select: { displayName: true } } } },
        // Fallback cover: the first photo of the trip.
        mediaRefs: { take: 1, orderBy: { takenAt: 'asc' }, select: { id: true } },
      },
    });
    const { mediaRefs, coverMediaId, ...rest } = trip;
    // The public page shows the same header card as the app: cover, dates and
    // the trip's numbers.
    const [stats, stopCount] = await Promise.all([
      this.trips.getStatsUnchecked(session.tripId),
      this.prisma.stop.count({
        where: { tripId: session.tripId, latitude: { not: null } },
      }),
    ]);
    return {
      ...rest,
      resolvedCoverId: coverMediaId ?? mediaRefs[0]?.id ?? null,
      stats: { ...stats, stops: stopCount },
    };
  }

  @Get(':slug/route')
  async route(
    @Param('slug') slug: string,
    @Headers('x-share-token') token: string,
  ): Promise<RouteCollection> {
    const session = await this.requireSession(slug, token);
    return this.tracking.getRoutesUnchecked(session.tripId);
  }

  @Get(':slug/stops')
  async shareStops(
    @Param('slug') slug: string,
    @Headers('x-share-token') token: string,
  ): Promise<PlannedStop[]> {
    const session = await this.requireSession(slug, token);
    return this.stops.listUnchecked(session.tripId);
  }

  @Get(':slug/media')
  async media(@Param('slug') slug: string, @Headers('x-share-token') token: string) {
    const session = await this.requireSession(slug, token);
    return this.prisma.mediaRef.findMany({
      where: { tripId: session.tripId },
      orderBy: { takenAt: 'asc' },
      select: {
        id: true,
        userId: true,
        assetType: true,
        takenAt: true,
        latitude: true,
        longitude: true,
      },
    });
  }

  @Get(':slug/media/:id/thumbnail')
  @Throttle({ default: { ttl: 60_000, limit: 600 } })
  async thumbnail(
    @Param('slug') slug: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-share-token') token: string,
    @Res() res: ExpressResponse,
  ): Promise<void> {
    const session = await this.requireSession(slug, token);
    const media = await this.prisma.mediaRef.findFirst({
      where: { id, tripId: session.tripId },
    });
    if (!media) throw new NotFoundException('Media not found');

    const credentials = await this.connections.getCredentials(media.userId);
    if (!credentials) throw new NotFoundException('Media unavailable');

    const upstream = await this.immich.fetchThumbnail(
      credentials.serverUrl,
      credentials.apiKey,
      media.immichAssetId,
    );
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    if (upstream.body) {
      Readable.fromWeb(upstream.body as NodeReadableStream).pipe(res);
    } else {
      res.end();
    }
  }

  private async requireSession(slug: string, token?: string): Promise<ShareTokenPayload> {
    if (!token) throw new UnauthorizedException('Missing share token');
    const session = await this.share.verifyToken(token);
    if (session.slug !== slug) throw new UnauthorizedException('Invalid share token');
    return session;
  }
}
