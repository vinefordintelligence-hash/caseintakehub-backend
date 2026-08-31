import { Module } from '@nestjs/common';
import { ActivityNotificationController } from './activity-notification.controller';
import { ActivityNotificationService } from './activity-notification.service';

@Module({
  controllers: [ActivityNotificationController],
  providers: [ActivityNotificationService],
  exports: [ActivityNotificationService],
})
export class NotificationsModule {}
