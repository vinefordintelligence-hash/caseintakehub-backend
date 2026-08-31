import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { NotificationCenterService } from '../notification-center/notification-center.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

interface OverdueCaseRow {
  id: string;
  organization_id: string;
  case_number: string;
  phase_deadline: string;
}

// Existing database audit_logs.user_id is NOT NULL. Replacing this legacy
// system principal requires a separately reviewed system-actor migration.
const LEGACY_SLA_SYSTEM_ACTOR_ID = 'a0000000-0000-4000-8000-000000000001';

@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notificationCenterService: NotificationCenterService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Hourly sweep: for cases past their phase deadline that have not yet been
   * flagged, notify the client and the operations team and record the flag so
   * the escalation is raised once per deadline breach.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkOverduePhases(): Promise<void> {
    const rows = await this.dataSource.query<OverdueCaseRow[]>(
      `SELECT c.id, c.organization_id, c.case_number, c.phase_deadline
         FROM public.cases c
        WHERE c.workflow_phase <> 'completed'
          AND c.phase_deadline IS NOT NULL
          AND c.phase_deadline < now()
          AND c.phase_deadline_notified_at IS NULL`,
    );

    for (const row of rows) {
      await this.notificationCenterService.create({
        caseId: row.id,
        organizationId: row.organization_id,
        recipientRole: 'admin',
        title: 'Phase SLA overdue',
        body: `Case ${row.case_number} is past its phase deadline.`,
      });
      await this.notificationCenterService.create({
        caseId: row.id,
        organizationId: row.organization_id,
        recipientRole: 'client',
        title: 'Action needed',
        body: 'Your case phase is overdue — please complete the requested action.',
      });
      await this.auditLogsService.create({
        organizationId: row.organization_id,
        userId: LEGACY_SLA_SYSTEM_ACTOR_ID,
        action: 'workflow.sla_overdue',
        resourceType: 'case',
        resourceId: row.id,
        caseId: row.id,
        changes: { case_number: row.case_number, deadline: row.phase_deadline },
      });
      await this.dataSource.query(
        `UPDATE public.cases SET phase_deadline_notified_at = now() WHERE id = $1`,
        [row.id],
      );
    }

    if (rows.length) {
      this.logger.log(`SLA sweep flagged ${rows.length} overdue phase(s)`);
    }
  }
}
