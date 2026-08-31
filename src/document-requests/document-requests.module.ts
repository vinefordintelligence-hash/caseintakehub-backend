import { Module } from '@nestjs/common';
import { DocumentRequestsService } from './document-requests.service';
import { DocumentRequestsController } from './document-requests.controller';
import { CommonModule } from '../common/common.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationCenterModule } from '../notification-center/notification-center.module';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [
    CommonModule,
    AuditLogsModule,
    NotificationCenterModule,
    IdentityModule,
  ],
  controllers: [DocumentRequestsController],
  providers: [DocumentRequestsService],
  exports: [DocumentRequestsService],
})
export class DocumentRequestsModule {}
