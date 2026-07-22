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
import { PlannedStop, StopsService } from './stops.service';

@Controller('trips/:tripId/stops')
@UseGuards(JwtAuthGuard)
export class StopsController {
  constructor(private readonly stops: StopsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Param('tripId', ParseUUIDPipe) tripId: string,
  ): Promise<PlannedStop[]> {
    return this.stops.list(tripId, user.sub);
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
