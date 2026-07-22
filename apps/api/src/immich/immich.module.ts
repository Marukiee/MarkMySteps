import { Module } from '@nestjs/common';
import { ImmichClientService } from './immich-client.service';
import { ImmichConnectionService } from './immich-connection.service';
import { ImmichSyncService } from './immich-sync.service';
import { ImmichController } from './immich.controller';

@Module({
  controllers: [ImmichController],
  providers: [ImmichClientService, ImmichConnectionService, ImmichSyncService],
  exports: [ImmichClientService, ImmichConnectionService, ImmichSyncService],
})
export class ImmichModule {}
