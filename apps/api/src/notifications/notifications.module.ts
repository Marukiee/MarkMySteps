import { Module } from '@nestjs/common';
import {
  NotificationsController,
  NotificationsDeviceController,
} from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController, NotificationsDeviceController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
