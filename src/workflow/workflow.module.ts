import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkflowService } from './workflow.service';
import { WorkflowController } from './workflow.controller';
import { SlaService } from './sla.service';
import { CaseClientAction } from './entities/case-client-action.entity';
import { CaseHandoffGrant } from './entities/case-handoff-grant.entity';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationCenterModule } from '../notification-center/notification-center.module';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CaseClientAction, CaseHandoffGrant]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { algorithm: 'HS256' },
      }),
    }),
    AuditLogsModule,
    NotificationCenterModule,
    IdentityModule,
  ],
  controllers: [WorkflowController],
  providers: [WorkflowService, SlaService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
