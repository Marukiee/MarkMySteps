import { Module } from '@nestjs/common';
import { TripsModule } from '../trips/trips.module';
import { TrackFileService } from './track-file.service';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

@Module({
  imports: [TripsModule],
  controllers: [TrackingController],
  providers: [TrackingService, TrackFileService],
  exports: [TrackingService, TrackFileService],
})
export class TrackingModule {}
