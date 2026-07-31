import { Module } from '@nestjs/common';
import { NotificationCenterService } from './notification-center.service';
import { NotificationCenterController } from './notification-center.controller';

@Module({
  controllers: [NotificationCenterController],
  providers: [NotificationCenterService],
})
export class NotificationCenterModule {}
