import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UpdatePaymentGateDto } from './dto/update-payment-gate.dto';
import { SetCasePaymentStatusDto } from './dto/set-case-payment-status.dto';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

type JsonResult = Record<string, unknown> | null;

interface FunctionCallRow {
  result: JsonResult;
}

function firstResult(rows: FunctionCallRow[]): JsonResult {
  return rows[0]?.result ?? null;
}

@Injectable()
export class PaymentsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
  private admin(identity: VerifiedIdentity) {
    if (!['admin', 'super_admin'].includes(identity.role))
      throw new ForbiddenException('administrator access required');
  }
  private async caseAccess(caseId: string, identity: VerifiedIdentity) {
    const rows = await this.dataSource.query(
      `SELECT id FROM public.cases WHERE id=$1 AND organization_id=$2 ${identity.role === 'client' ? 'AND id=$3' : ''}`,
      identity.role === 'client'
        ? [caseId, identity.organizationId, identity.caseId]
        : [caseId, identity.organizationId],
    );
    if (!rows[0]) throw new NotFoundException('case not found');
  }

  async getPaymentGate(identity: VerifiedIdentity): Promise<JsonResult> {
    this.admin(identity);
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_get_payment_gate() AS result`,
    );
    return firstResult(rows);
  }

  async updatePaymentGate(
    identity: VerifiedIdentity,
    dto: UpdatePaymentGateDto,
  ): Promise<JsonResult> {
    this.admin(identity);
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_update_payment_gate($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result`,
      [
        identity.actorId,
        dto.enabled ?? null,
        dto.client_visible ?? null,
        dto.payment_title ?? null,
        dto.payment_description ?? null,
        dto.amount ?? null,
        dto.currency ?? null,
        dto.payment_methods ?? null,
        dto.due_date_behavior ?? null,
        dto.invoice_reference_behavior ?? null,
      ],
    );
    return firstResult(rows);
  }

  async getPaymentGateAudit(identity: VerifiedIdentity): Promise<JsonResult> {
    this.admin(identity);
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_get_payment_gate_audit() AS result`,
    );
    return firstResult(rows);
  }

  async getCasePayment(
    caseId: string,
    identity: VerifiedIdentity,
  ): Promise<JsonResult> {
    this.admin(identity);
    await this.caseAccess(caseId, identity);
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_get_case_payment($1,$2) AS result`,
      [caseId, 'admin'],
    );
    return firstResult(rows);
  }

  async getCasePaymentClient(
    caseId: string,
    identity: VerifiedIdentity,
  ): Promise<JsonResult> {
    await this.caseAccess(caseId, identity);
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_get_case_payment($1,$2) AS result`,
      [caseId, 'client'],
    );
    return firstResult(rows);
  }

  async setCasePaymentStatus(
    caseId: string,
    identity: VerifiedIdentity,
    dto: SetCasePaymentStatusDto,
  ): Promise<JsonResult> {
    this.admin(identity);
    await this.caseAccess(caseId, identity);
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_set_case_payment_status($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result`,
      [
        caseId,
        identity.actorId,
        dto.status,
        dto.amount ?? null,
        dto.currency ?? null,
        dto.payment_method ?? null,
        dto.due_date ? new Date(dto.due_date) : null,
        dto.invoice_id ?? null,
        dto.reference_number ?? null,
        dto.client_visible ?? null,
        dto.notes ?? null,
      ],
    );
    return firstResult(rows);
  }
}
