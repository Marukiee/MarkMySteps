import { Module } from '@nestjs/common';
import { TripsModule } from '../trips/trips.module';
import { StayDetectorService } from './stay-detector.service';
import { StopsController } from './stops.controller';
import { StopsService } from './stops.service';

@Module({
  imports: [TripsModule],
  controllers: [StopsController],
  providers: [StopsService, StayDetectorService],
  exports: [StopsService],
})
export class StopsModule {}
