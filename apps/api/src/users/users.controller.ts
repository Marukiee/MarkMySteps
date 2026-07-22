import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChangePasswordDto, UpdateProfileDto } from './dto/profile.dto';
import { PublicUser, UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: JwtPayload): Promise<PublicUser> {
    return this.users.getById(user.sub);
  }

  @Patch('me')
  updateProfile(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto): Promise<PublicUser> {
    return this.users.updateProfile(user.sub, dto.displayName, dto.username);
  }

  @Post('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.users.changePassword(user.sub, dto.currentPassword, dto.newPassword);
  }

  @Get('friends')
  friends(
    @CurrentUser() user: JwtPayload,
  ): Promise<{ id: string; username: string; displayName: string; sharedTrips: number }[]> {
    return this.users.listFriends(user.sub);
  }
}
