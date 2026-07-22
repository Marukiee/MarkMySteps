import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { TripsService, TripWithMembers } from './trips.service';

@Controller('trips')
@UseGuards(JwtAuthGuard)
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateTripDto): Promise<TripWithMembers> {
    return this.trips.create(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtPayload): Promise<TripWithMembers[]> {
    return this.trips.listForUser(user.sub);
  }

  @Get(':id')
  get(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TripWithMembers> {
    return this.trips.getForMember(id, user.sub);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTripDto,
  ): Promise<TripWithMembers> {
    return this.trips.update(id, user.sub, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.trips.remove(id, user.sub);
  }

  @Post(':id/members')
  addMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
  ): Promise<TripWithMembers> {
    return this.trips.addMemberByEmail(id, user.sub, dto.email);
  }

  @Delete(':id/members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ): Promise<void> {
    await this.trips.removeMember(id, user.sub, memberId);
  }
}
