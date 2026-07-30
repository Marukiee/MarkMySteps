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
import { UpdateMemberDto } from './dto/update-member.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { TripsService, TripStats, TripWithMembers } from './trips.service';

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

  /**
   * Trips you were added to without knowing. Declared above `:id` so the
   * literal path wins — `:id` would refuse "invites" as a non-UUID.
   */
  @Get('invites')
  invites(
    @CurrentUser() user: JwtPayload,
  ): Promise<{ id: string; title: string; ownerName: string }[]> {
    return this.trips.listUnseenMemberships(user.sub);
  }

  @Post('invites/seen')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markInvitesSeen(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.trips.markMembershipsSeen(user.sub);
  }

  @Get(':id')
  get(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TripWithMembers> {
    return this.trips.getForMember(id, user.sub);
  }

  @Get(':id/stats')
  stats(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TripStats> {
    return this.trips.getStats(id, user.sub);
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
    const names = dto.usernames?.length ? dto.usernames : dto.username ? [dto.username] : [];
    return this.trips.addMembersByUsername(id, user.sub, names);
  }

  @Patch(':id/members/:memberId')
  updateMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberDto,
  ): Promise<TripWithMembers> {
    return this.trips.updateMember(id, user.sub, memberId, dto);
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
