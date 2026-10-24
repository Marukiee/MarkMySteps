import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, ValidateIf } from 'class-validator';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { REACTION_KINDS, ReactionsService, ReactionsView } from './reactions.service';

/** `kind: null` takes the reaction away. */
export class SetReactionDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(REACTION_KINDS)
  kind: string | null;
}

@Controller('trips/:tripId')
@UseGuards(JwtAuthGuard)
export class ReactionsController {
  constructor(private readonly reactions: ReactionsService) {}

  @Get('reactions')
  list(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ): Promise<ReactionsView> {
    return this.reactions.list(tripId, user.sub);
  }

  @Put('media/:mediaId/reaction')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  async set(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body() dto: SetReactionDto,
  ): Promise<void> {
    await this.reactions.setMine(tripId, user.sub, { mediaId }, dto.kind ?? null);
  }

  @Put('comments/:commentId/reaction')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  async setOnComment(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: SetReactionDto,
  ): Promise<void> {
    await this.reactions.setMine(tripId, user.sub, { commentId }, dto.kind ?? null);
  }
}
