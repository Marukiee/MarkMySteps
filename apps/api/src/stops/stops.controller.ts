import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateStopDto, ReorderStopsDto, UpdateStopDto } from './dto/stop.dto';
import { StaySuggestion, StayDetectorService } from './stay-detector.service';
import { PlannedStop, StopsService } from './stops.service';

@Controller('trips/:tripId/stops')
@UseGuards(JwtAuthGuard)
export class StopsController {
  constructor(
    private readonly stops: StopsService,
    private readonly stays: StayDetectorService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ): Promise<PlannedStop[]> {
    return this.stops.list(tripId, user.sub);
  }

  /**
   * Places the trip stood still for most of a day, which the plan does not
   * know about yet. Read-only: nothing is added until somebody says so.
   */
  @Get('suggestions')
  suggestions(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ): Promise<StaySuggestion[]> {
    return this.stays.suggest(tripId, user.sub);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: CreateStopDto,
  ): Promise<PlannedStop[]> {
    return this.stops.create(tripId, user.sub, dto);
  }

  @Patch(':stopId')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('stopId', ParseUUIDPipe) stopId: string,
    @Body() dto: UpdateStopDto,
  ): Promise<PlannedStop[]> {
    return this.stops.update(tripId, user.sub, stopId, dto);
  }

  @Delete(':stopId')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Param('stopId', ParseUUIDPipe) stopId: string,
  ): Promise<PlannedStop[]> {
    return this.stops.remove(tripId, user.sub, stopId);
  }

  @Put('order')
  reorder(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: ReorderStopsDto,
  ): Promise<PlannedStop[]> {
    return this.stops.reorder(tripId, user.sub, dto);
  }
}
