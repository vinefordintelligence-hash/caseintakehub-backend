import { Module } from '@nestjs/common';
import { NotificationCenterService } from './notification-center.service';
import { NotificationCenterController } from './notification-center.controller';
import { CommonModule } from '../common/common.module';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [CommonModule, IdentityModule],
  controllers: [NotificationCenterController],
  providers: [NotificationCenterService],
  exports: [NotificationCenterService],
})
export class NotificationCenterModule {}
