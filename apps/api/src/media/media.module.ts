import { Module } from '@nestjs/common';
import { ImmichModule } from '../immich/immich.module';
import { TripsModule } from '../trips/trips.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [ImmichModule, TripsModule],
  controllers: [MediaController],
  providers: [MediaService],
})
export class MediaModule {}
