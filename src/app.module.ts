import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { RolesModule } from './roles/roles.module';
import { PermissionsModule } from './permissions/permissions.module';
import { AuditModule } from './audit/audit.module';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventsModule } from './events/events.module';
import { NotificationsModule } from './notifications/notifications.module';
import { CommonModule } from './common/common.module';
import { CasesModule } from './cases/cases.module';
import { InvestigationsModule } from './investigations/investigations.module';
import { EvidenceModule } from './evidence/evidence.module';
import { DocumentsModule } from './documents/documents.module';
import { TimelineModule } from './timeline/timeline.module';
import { TasksModule } from './tasks/tasks.module';
import { ReportsModule } from './reports/reports.module';
import { WorkflowModule } from './workflow/workflow.module';
import { TreasuryModule } from './treasury/treasury.module';
import { PaymentsModule } from './payments/payments.module';
import { AiModule } from './ai/ai.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { CommunicationsModule } from './communications/communications.module';
import { NotesModule } from './notes/notes.module';
import { ReferencesModule } from './references/references.module';
import { RecordsModule } from './records/records.module';
import { DocumentRequestsModule } from './document-requests/document-requests.module';
import { CaseTransfersModule } from './case-transfers/case-transfers.module';
import { FundingModule } from './funding/funding.module';
import { LedgerModule } from './ledger/ledger.module';
import { InvoicesModule } from './invoices/invoices.module';
import { SearchModule } from './search/search.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationCenterModule } from './notification-center/notification-center.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
@Module({
  imports: [
  ConfigModule.forRoot({
    isGlobal: true,
  }),

  TypeOrmModule.forRoot({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    autoLoadEntities: true,
    synchronize: true,
  }),

  AuthModule,
  UsersModule,
   OrganizationsModule,
  RolesModule,
  PermissionsModule,
  AuditModule,
  EventsModule,
  NotificationsModule,
  CommonModule,
  CasesModule,
  InvestigationsModule,
  EvidenceModule,
  DocumentsModule,
  TimelineModule,
  TasksModule,
  ReportsModule,
  WorkflowModule,
  TreasuryModule,
  PaymentsModule,
  AiModule,
  IntegrationsModule,
  CommunicationsModule,
  NotesModule,
  ReferencesModule,
  RecordsModule,
  DocumentRequestsModule,
  CaseTransfersModule,
  FundingModule,
  LedgerModule,
  InvoicesModule,
  SearchModule,
  AnalyticsModule,
  DashboardModule,
  NotificationCenterModule,
  AuditLogsModule
],
controllers: [AppController],
providers: [AppService],
})
export class AppModule {}
