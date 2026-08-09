import { Module } from '@nestjs/common';
import { TripsModule } from '../trips/trips.module';
import { SummariesController } from './summaries.controller';
import { SummariesService } from './summaries.service';

@Module({
  imports: [TripsModule],
  controllers: [SummariesController],
  providers: [SummariesService],
})
export class SummariesModule {}
