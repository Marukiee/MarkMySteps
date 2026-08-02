import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AccessRequestStatus, TripRole } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  DevicePoll,
  NotificationsService,
  NotificationView,
  TripAccessPreview,
} from './notifications.service';

class AccessRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  message?: string;
}

class DeviceTokenDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  token?: string;
}

class DecideDto {
  /** What to let them in as. Guests look; reisgenoten travel along. */
  @IsOptional()
  @IsIn([TripRole.MEMBER, TripRole.GUEST])
  role?: TripRole;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(@CurrentUser() user: JwtPayload): Promise<NotificationView[]> {
    return this.notifications.list(user.sub);
  }

  @Get('notifications/count')
  count(@CurrentUser() user: JwtPayload): Promise<{ unread: number; pending: number }> {
    return this.notifications.unreadCount(user.sub);
  }

  @Post('notifications/read')
  @HttpCode(HttpStatus.OK)
  readAll(@CurrentUser() user: JwtPayload): Promise<{ read: number }> {
    return this.notifications.markAllRead(user.sub);
  }

  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  read(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.notifications.markRead(user.sub, id);
  }

  /**
   * A token for this phone's background poller.
   *
   * The worker that uses it runs outside the WebView and cannot reach the
   * session, so it gets something of its own that can do nothing but ask
   * whether there is news.
   */
  @Post('notifications/device')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  registerDevice(@CurrentUser() user: JwtPayload): Promise<{ token: string }> {
    return this.notifications.registerDevice(user.sub);
  }

  @Delete('notifications/device')
  @HttpCode(HttpStatus.NO_CONTENT)
  unregisterDevice(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DeviceTokenDto,
  ): Promise<void> {
    return this.notifications.unregisterDevice(user.sub, dto.token);
  }

  @Delete('notifications/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.notifications.remove(user.sub, id);
  }

  /** What a trip you cannot open is allowed to tell you about itself. */
  @Get('trips/:tripId/access')
  preview(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ): Promise<TripAccessPreview> {
    return this.notifications.preview(tripId, user.sub);
  }

  /** Ask the owner to let you on. Deliberately slow to repeat. */
  @Post('trips/:tripId/access')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  request(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: AccessRequestDto,
  ): Promise<{ status: AccessRequestStatus }> {
    return this.notifications.request(tripId, user.sub, dto.message);
  }

  @Post('access-requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideDto,
  ): Promise<{ status: AccessRequestStatus }> {
    return this.notifications.decide(id, user.sub, true, dto.role ?? TripRole.GUEST);
  }

  @Post('access-requests/:id/deny')
  @HttpCode(HttpStatus.OK)
  deny(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ status: AccessRequestStatus }> {
    return this.notifications.decide(id, user.sub, false);
  }
}

/**
 * The one route a phone may call without a session.
 *
 * Its own controller because the rest of this file is behind the JWT guard,
 * and this is answered on the strength of the device token alone. It is
 * read-only, it is rate limited, and all it can ever return is a count and one
 * sentence.
 */
@Controller('notifications')
export class NotificationsDeviceController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('poll')
  @Throttle({ default: { ttl: 3_600_000, limit: 120 } })
  poll(@Query('token') token?: string): Promise<DevicePoll> {
    if (!token || token.length < 20 || token.length > 200) {
      throw new NotFoundException('Unknown device');
    }
    return this.notifications.pollDevice(token);
  }
}
