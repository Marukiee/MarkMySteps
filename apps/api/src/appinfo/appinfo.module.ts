import { Module } from '@nestjs/common';
import { AppInfoController } from './appinfo.controller';

@Module({
  controllers: [AppInfoController],
})
export class AppInfoModule {}
