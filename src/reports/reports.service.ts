import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateReportDto } from './dto/create-report.dto';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class ReportsService {
  constructor(
    @InjectDataSource() private readonly data: DataSource,
    private readonly audit: AuditLogsService,
  ) {}

  types() {
    return {
      types: [
        'case_summary',
        'investigation',
        'financial_assessment',
        'evidence',
        'workflow',
        'audit',
      ],
      formats: ['json', 'csv'],
      persistence: false,
    };
  }

  async generate(dto: CreateReportDto, identity: VerifiedIdentity) {
    if (identity.role === 'client')
      throw new ForbiddenException('staff access required');
    const cases = await this.data.query(
      `SELECT c.id,c.case_number,c.title,c.description,c.status,c.workflow_phase,c.workflow_phase_number,c.created_at,c.updated_at,
        cl.name client_name,COALESCE(u.name,'Unassigned') investigator
       FROM public.cases c JOIN public.clients cl ON cl.id=c.client_id AND cl.organization_id=c.organization_id
       LEFT JOIN public.app_users u ON u.id=c.assigned_to AND u.organization_id=c.organization_id
       WHERE c.organization_id=$1 AND (c.id::text=$2 OR upper(c.case_number)=upper($2))`,
      [identity.organizationId, dto.caseId],
    );
    if (!cases[0]) throw new NotFoundException('case not found');
    const caseId = cases[0].id;
    const [counts, invoices] = await Promise.all([
      this.data.query(
        `SELECT
        (SELECT count(*)::int FROM public.documents WHERE organization_id=$1 AND case_id=$2) documents,
        (SELECT count(*)::int FROM public.evidence WHERE organization_id=$1 AND case_id=$2) evidence,
        (SELECT count(*)::int FROM public.document_requests WHERE organization_id=$1 AND case_id=$2 AND status IN ('open','submitted')) outstanding_document_requests,
        (SELECT count(*)::int FROM public.messages WHERE organization_id=$1 AND case_id=$2) messages`,
        [identity.organizationId, caseId],
      ),
      this.data.query(
        `SELECT count(*)::int invoices,COALESCE(sum(amount),0) invoiced_amount,
        COALESCE(sum(amount) FILTER (WHERE status='paid'),0) paid_amount
        FROM public.invoices WHERE organization_id=$1 AND case_id=$2`,
        [identity.organizationId, caseId],
      ),
    ]);
    const report = {
      type: dto.type,
      generatedAt: new Date().toISOString(),
      case: cases[0],
      activity: counts[0],
      financialSummary: invoices[0],
    };
    await this.audit.create({
      organizationId: identity.organizationId,
      userId: identity.actorId,
      action: 'REPORT_GENERATED',
      resourceType: 'case',
      resourceId: caseId,
      caseId,
      changes: { type: dto.type, format: dto.format },
    });
    return dto.format === 'csv'
      ? { ...report, contentType: 'text/csv', data: this.csv(report) }
      : report;
  }

  update(): never {
    throw new ForbiddenException('generated reports are immutable');
  }
  remove(): never {
    throw new ForbiddenException('generated reports are not persisted');
  }

  private csv(report: Record<string, any>): string {
    const rows = [['field', 'value']];
    const flatten = (value: any, prefix = '') =>
      Object.entries(value ?? {}).forEach(([key, child]) => {
        const name = prefix ? `${prefix}.${key}` : key;
        if (child && typeof child === 'object' && !Array.isArray(child))
          flatten(child, name);
        else rows.push([name, String(child ?? '')]);
      });
    flatten(report);
    return rows
      .map((row) =>
        row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','),
      )
      .join('\n');
  }
}
