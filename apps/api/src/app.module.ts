import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { ImmichModule } from './immich/immich.module';
import { MediaModule } from './media/media.module';
import { PrismaModule } from './prisma/prisma.module';
import { TripsModule } from './trips/trips.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    // Global rate limit: 100 requests / minute per IP.
    // Stricter per-route limits (e.g. login) are set with @Throttle().
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    CryptoModule,
    HealthModule,
    AuthModule,
    UsersModule,
    TripsModule,
    ImmichModule,
    MediaModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
