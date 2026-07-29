import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService, AuthTokens, JwtPayload, RegisterResult } from './auth.service';
import { AllowPending } from './decorators/allow-pending.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

// Stricter limits on credential endpoints to slow down brute-force attempts.
const CREDENTIAL_THROTTLE = { default: { ttl: 60_000, limit: 5 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Far tighter than the other credential endpoints: signing up is something
   * you do once, and nothing legitimate needs more than a couple of tries an
   * hour from one address. The queue also has a ceiling (see AuthService),
   * which is what holds when the attempts come from many addresses.
   */
  @Post('register')
  @Throttle({ default: { ttl: 3_600_000, limit: 3 } })
  register(@Body() dto: RegisterDto): Promise<RegisterResult> {
    return this.auth.register(dto.email, dto.username, dto.displayName, dto.password);
  }

  /**
   * The one thing a waiting account may ask. Answered from the database, so an
   * approval takes effect at once and a rejection cannot be sat out with a
   * token that was issued earlier.
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  @AllowPending()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  status(@CurrentUser() user: JwtPayload) {
    return this.auth.approvalStatus(user.sub);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(CREDENTIAL_THROTTLE)
  login(@Body() dto: LoginDto): Promise<AuthTokens> {
    return this.auth.login(dto.identifier, dto.password);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }
}
