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
import { UserRole } from '@prisma/client';
import { IsEmail, IsEnum, IsString, Length, Matches, MaxLength } from 'class-validator';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService, AdminUserRow } from './admin.service';

class CreateUserDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Matches(/^[a-zA-Z0-9._-]{3,30}$/)
  username: string;

  @IsString()
  @Length(1, 80)
  displayName: string;

  @IsString()
  @Length(10, 128)
  tempPassword: string;
}

class ResetPasswordDto {
  @IsString()
  @Length(10, 128)
  tempPassword: string;
}

class SetRoleDto {
  @IsEnum(UserRole)
  role: UserRole;
}

@Controller('admin/users')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  list(): Promise<AdminUserRow[]> {
    return this.admin.listUsers();
  }

  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  create(@Body() dto: CreateUserDto): Promise<AdminUserRow> {
    return this.admin.createUser(dto.email, dto.username, dto.displayName, dto.tempPassword);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async approve(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.admin.approve(id, user.sub);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reject(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.admin.reject(id, user.sub);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
  ): Promise<void> {
    await this.admin.resetPassword(id, dto.tempPassword);
  }

  @Post(':id/role')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setRole(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRoleDto,
  ): Promise<void> {
    await this.admin.setRole(id, dto.role, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.admin.deleteUser(id, user.sub);
  }
}
