import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SetConnectionDto } from './dto/set-connection.dto';
import { ConnectionStatus, ImmichConnectionService } from './immich-connection.service';

@Controller('immich/connection')
@UseGuards(JwtAuthGuard)
export class ImmichController {
  constructor(private readonly connections: ImmichConnectionService) {}

  /** Set or replace the Immich connection; validates before storing. */
  @Put()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  set(@CurrentUser() user: JwtPayload, @Body() dto: SetConnectionDto): Promise<ConnectionStatus> {
    return this.connections.setConnection(user.sub, dto.serverUrl, dto.apiKey);
  }

  @Get()
  status(@CurrentUser() user: JwtPayload): Promise<ConnectionStatus> {
    return this.connections.getStatus(user.sub);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.connections.removeConnection(user.sub);
  }
}
