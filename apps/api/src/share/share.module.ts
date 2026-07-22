import { Module } from '@nestjs/common';
import { ImmichModule } from '../immich/immich.module';
import { StopsModule } from '../stops/stops.module';
import { TrackingModule } from '../tracking/tracking.module';
import { TripsModule } from '../trips/trips.module';
import { ShareManagementController, SharePublicController } from './share.controller';
import { ShareService } from './share.service';

@Module({
  imports: [TripsModule, TrackingModule, StopsModule, ImmichModule],
  controllers: [ShareManagementController, SharePublicController],
  providers: [ShareService],
})
export class ShareModule {}
