import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { PolarstepsImportService } from './polarsteps-import.service';

@Module({
  controllers: [ImportController],
  providers: [PolarstepsImportService],
})
export class ImportModule {}
