import { Module } from '@nestjs/common';
import { ImmichClientService } from './immich-client.service';
import { ImmichConnectionService } from './immich-connection.service';
import { ImmichGeotagService } from './immich-geotag.service';
import { ImmichSyncService } from './immich-sync.service';
import { ImmichController } from './immich.controller';

@Module({
  controllers: [ImmichController],
  providers: [ImmichClientService, ImmichConnectionService, ImmichGeotagService, ImmichSyncService],
  exports: [ImmichClientService, ImmichConnectionService, ImmichGeotagService, ImmichSyncService],
})
export class ImmichModule {}
