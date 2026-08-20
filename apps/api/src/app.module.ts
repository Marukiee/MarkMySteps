import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AppInfoModule } from './appinfo/appinfo.module';
import { AuthModule } from './auth/auth.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { SessionThrottlerGuard } from './common/throttler/session-throttler.guard';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { ImmichModule } from './immich/immich.module';
import { ImportModule } from './import/import.module';
import { MediaModule } from './media/media.module';
import { NotesModule } from './notes/notes.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TrackingModule } from './tracking/tracking.module';
import { PrismaModule } from './prisma/prisma.module';
import { SearchModule } from './search/search.module';
import { ShareModule } from './share/share.module';
import { StopsModule } from './stops/stops.module';
import { SummariesModule } from './summaries/summaries.module';
import { TripsModule } from './trips/trips.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    // Global rate limit: 300 requests / minute per session (per IP when there
    // is no token — see SessionThrottlerGuard). Opening a trip is already a
    // handful of requests, and coming back online after a day away replays a
    // queue on top of that, so 100 was a ceiling normal use could reach.
    // Stricter per-route limits (e.g. login) are set with @Throttle().
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    CryptoModule,
    HealthModule,
    AuthModule,
    UsersModule,
    TripsModule,
    ImmichModule,
    MediaModule,
    TrackingModule,
    ImportModule,
    StopsModule,
    SearchModule,
    ShareModule,
    SummariesModule,
    AdminModule,
    NotesModule,
    NotificationsModule,
    AppInfoModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: SessionThrottlerGuard }],
})
export class AppModule {}
