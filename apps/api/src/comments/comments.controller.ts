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
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length } from 'class-validator';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CommentsService, PhotoCommentView } from './comments.service';

export class CommentBodyDto {
  @IsString()
  @Length(1, 2000)
  body: string;
}

/** Visitors on a share link have no account; they say who they are. */
export class PublicCommentDto extends CommentBodyDto {
  @IsString()
  @Length(1, 60)
  name: string;
}

/** The trip's photo comments, for the people on the trip. */
@Controller('trips/:tripId')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('comments')
  list(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ): Promise<PhotoCommentView[]> {
    return this.comments.list(tripId, user.sub);
  }

  @Post('media/:mediaId/comments')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  add(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body() dto: CommentBodyDto,
  ): Promise<PhotoCommentView> {
    return this.comments.add(tripId, user.sub, { mediaId }, dto.body);
  }

  /** On a day's story rather than a photo. */
  @Post('days/:day/comments')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  addOnDay(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('day') day: string,
    @Body() dto: CommentBodyDto,
  ): Promise<PhotoCommentView> {
    return this.comments.add(tripId, user.sub, { day }, dto.body);
  }

  @Delete('comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ): Promise<void> {
    await this.comments.remove(tripId, user.sub, commentId);
  }
}
