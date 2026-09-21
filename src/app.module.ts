import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { RolesModule } from "./roles/roles.module";
import { PermissionsModule } from "./permissions/permissions.module";
import { AuditModule } from "./audit/audit.module";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { EventsModule } from "./events/events.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { CommonModule } from "./common/common.module";
import { CasesModule } from "./cases/cases.module";
import { InvestigationsModule } from "./investigations/investigations.module";
import { EvidenceModule } from "./evidence/evidence.module";
import { DocumentsModule } from "./documents/documents.module";
import { TimelineModule } from "./timeline/timeline.module";
import { TasksModule } from "./tasks/tasks.module";
import { ReportsModule } from "./reports/reports.module";
import { WorkflowModule } from "./workflow/workflow.module";
import { WithdrawalsModule } from "./withdrawals/withdrawals.module";
import { TreasuryModule } from "./treasury/treasury.module";
import { PaymentsModule } from "./payments/payments.module";
import { AiModule } from "./ai/ai.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { CommunicationsModule } from "./communications/communications.module";
import { NotesModule } from "./notes/notes.module";
import { ReferencesModule } from "./references/references.module";
import { RecordsModule } from "./records/records.module";
import { DocumentRequestsModule } from "./document-requests/document-requests.module";
import { CaseTransfersModule } from "./case-transfers/case-transfers.module";
import { FundingModule } from "./funding/funding.module";
import { LedgerModule } from "./ledger/ledger.module";
import { InvoicesModule } from "./invoices/invoices.module";
import { SearchModule } from "./search/search.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { NotificationCenterModule } from "./notification-center/notification-center.module";
import { AuditLogsModule } from "./audit-logs/audit-logs.module";
import { ClientAuthModule } from "./client-auth/client-auth.module";
import { EnterpriseModule } from "./enterprise/enterprise.module";
import { CaseProgressModule } from "./case-progress/case-progress.module";
import { IdentityModule } from "./identity/identity.module";
import { SupabaseIdentityGuard } from "./identity/supabase-identity.guard";
import { RbacGuard } from "./core/security/rbac.guard";
import { ApiGatewayMiddleware } from "./core/gateway/api-gateway.middleware";
import { SensitiveRateLimitMiddleware } from "./core/security/sensitive-rate-limit.middleware";
import { HealthModule } from "./health/health.module";
import { IntakesModule } from "./intakes/intakes.module";
import { CustodyModule } from "./custody/custody.module";
import { KycModule } from "./kyc/kyc.module";
import { TransactionAuthorizationModule } from "./transaction-authorization/transaction-authorization.module";
import { ClientPortalAccessGateModule } from "./client-portal-access-gate/client-portal-access-gate.module";
import { ClientPortalAccessGateGuard } from "./client-portal-access-gate/client-portal-access-gate.guard";
import { CaseAssignmentsModule } from "./case-assignments/case-assignments.module";
import { WorkflowEngineModule } from "./workflow-engine/workflow-engine.module";
import { FeeConfigurationModule } from "./fee-configuration/fee-configuration.module";
@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || "5432", 10),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      autoLoadEntities: true,
      synchronize: false,
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
    WithdrawalsModule,
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
    AuditLogsModule,
    ClientAuthModule,
    EnterpriseModule,
    CaseProgressModule,
    IdentityModule,
    HealthModule,
    IntakesModule,
    CustodyModule,
    KycModule,
    TransactionAuthorizationModule,
    ClientPortalAccessGateModule,
    CaseAssignmentsModule,
    WorkflowEngineModule,
    FeeConfigurationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    RbacGuard,
    { provide: APP_GUARD, useExisting: SupabaseIdentityGuard },
    { provide: APP_GUARD, useExisting: ClientPortalAccessGateGuard },
    { provide: APP_GUARD, useExisting: RbacGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(ApiGatewayMiddleware, SensitiveRateLimitMiddleware)
      .forRoutes({ path: "{*path}", method: RequestMethod.ALL });
  }
}
