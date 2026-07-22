import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { IsDateString, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotesService, TripNoteView } from './notes.service';

class SaveNoteDto {
  @IsDateString()
  day: string;

  @IsString()
  @Length(1, 8000)
  body: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

@Controller('trips/:tripId/notes')
@UseGuards(JwtAuthGuard)
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ): Promise<TripNoteView[]> {
    return this.notes.list(tripId, user.sub);
  }

  @Put()
  save(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: SaveNoteDto,
  ): Promise<TripNoteView[]> {
    return this.notes.upsert(tripId, user.sub, dto.day, dto.body, dto.title);
  }

  @Delete(':noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ): Promise<void> {
    await this.notes.remove(tripId, user.sub, noteId);
  }
}
