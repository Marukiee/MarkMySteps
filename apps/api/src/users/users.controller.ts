import {
  BadRequestException,
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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response as ExpressResponse } from 'express';
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

  /** Avatar upload: small images only; client resizes before sending. */
  @Post('me/avatar')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadAvatar(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<void> {
    if (!file || !file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Upload an image as multipart field "file"');
    }
    await this.users.setAvatar(user.sub, file.buffer, file.mimetype);
  }

  @Delete('me/avatar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAvatar(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.users.removeAvatar(user.sub);
  }

  @Get(':id/avatar')
  async avatar(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: ExpressResponse,
  ): Promise<void> {
    const { buffer, mime } = await this.users.getAvatar(id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(buffer);
  }

  @Get('friends')
  friends(
    @CurrentUser() user: JwtPayload,
  ): Promise<{ id: string; username: string; displayName: string; sharedTrips: number }[]> {
    return this.users.listFriends(user.sub);
  }
}
