import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService, AuthTokens, JwtPayload, MfaChallenge, RegisterResult } from './auth.service';
import { AllowPending } from './decorators/allow-pending.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LoginMfaDto } from './dto/login-mfa.dto';
import { RegisterDto } from './dto/register.dto';
import { TwoFactorCodeDto, TwoFactorPasswordDto, TwoFactorProofDto } from './dto/two-factor.dto';
import { TwoFactorService, TwoFactorSetup, TwoFactorStatus } from './two-factor.service';

// Stricter limits on credential endpoints to slow down brute-force attempts.
const CREDENTIAL_THROTTLE = { default: { ttl: 60_000, limit: 5 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

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
  login(@Body() dto: LoginDto): Promise<AuthTokens | MfaChallenge> {
    return this.auth.login(dto.identifier, dto.password);
  }

  /** Second half of sign-in for an account with an authenticator app. */
  @Post('login/mfa')
  @HttpCode(HttpStatus.OK)
  @Throttle(CREDENTIAL_THROTTLE)
  loginMfa(@Body() dto: LoginMfaDto): Promise<AuthTokens> {
    return this.auth.loginMfa(dto.mfaToken, dto.code);
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

  // ---- Two-step verification (authenticator app) --------------------------

  @Get('2fa')
  @UseGuards(JwtAuthGuard)
  twoFactorStatus(@CurrentUser() user: JwtPayload): Promise<TwoFactorStatus> {
    return this.twoFactor.status(user.sub);
  }

  /** Step one of turning it on: password in, secret and QR contents out. */
  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  twoFactorSetup(
    @CurrentUser() user: JwtPayload,
    @Body() dto: TwoFactorPasswordDto,
  ): Promise<TwoFactorSetup> {
    return this.twoFactor.beginSetup(user.sub, dto.password);
  }

  /** Step two: the first code turns it on and returns the recovery codes, once. */
  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async twoFactorEnable(
    @CurrentUser() user: JwtPayload,
    @Body() dto: TwoFactorCodeDto,
  ): Promise<{ recoveryCodes: string[] }> {
    return { recoveryCodes: await this.twoFactor.confirmSetup(user.sub, dto.code) };
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async twoFactorDisable(
    @CurrentUser() user: JwtPayload,
    @Body() dto: TwoFactorProofDto,
  ): Promise<void> {
    await this.twoFactor.disable(user.sub, dto.password, dto.code);
  }

  @Post('2fa/recovery-codes')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async twoFactorRecoveryCodes(
    @CurrentUser() user: JwtPayload,
    @Body() dto: TwoFactorProofDto,
  ): Promise<{ recoveryCodes: string[] }> {
    return {
      recoveryCodes: await this.twoFactor.regenerateRecoveryCodes(user.sub, dto.password, dto.code),
    };
  }
}
