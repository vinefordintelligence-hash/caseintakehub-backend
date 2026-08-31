import { InjectDataSource } from '@nestjs/typeorm';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateCaseTransferDto } from './dto/create-case-transfer.dto';
import { SubmitForReviewDto } from './dto/submit-for-review.dto';
import { VerifyReceivingDetailsDto } from './dto/verify-receiving-details.dto';
import { AddDocumentRequirementDto } from './dto/add-document-requirement.dto';
import { SetRequirementStatusDto } from './dto/set-requirement-status.dto';
import { ExecuteTransferDto } from './dto/execute-transfer.dto';
import { UploadVerificationDocumentDto } from './dto/upload-verification-document.dto';
import { AdminReviewRequirementDto } from './dto/admin-review-requirement.dto';

type JsonResult = Record<string, unknown> | null;

interface FunctionCallRow {
  result: JsonResult;
}

function firstResult(rows: FunctionCallRow[]): JsonResult {
  return rows[0]?.result ?? null;
}

@Injectable()
export class CaseTransfersService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async create(
    dto: CreateCaseTransferDto,
    actorId: string,
    organizationId: string,
  ) {
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_create_transfer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS result`,
      [
        dto.case_id,
        organizationId,
        dto.reference,
        dto.amount,
        dto.currency ?? 'USD',
        dto.mode ?? 'demo',
        dto.receiving_institution ?? null,
        dto.receiving_city ?? null,
        dto.receiving_country ?? null,
        dto.receiving_routing ?? null,
        dto.receiving_account ?? null,
        dto.receiving_account_type ?? null,
        dto.beneficiary ?? null,
        dto.beneficiary_legal ?? null,
        this.actor(actorId),
        dto.description ?? null,
      ],
    );
    return firstResult(rows);
  }

  async findAll(caseId?: string) {
    const where = caseId ? 'WHERE t.case_id = $1' : '';
    const params = caseId ? [caseId] : [];
    return this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT * FROM public.case_transfers t ${where} ORDER BY t.prepared_at DESC`,
      params,
    );
  }

  async findOne(id: string) {
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT * FROM public.case_transfers WHERE id = $1`,
      [id],
    );
    if (!rows.length) throw new Error(`transfer ${id} not found`);
    return rows[0];
  }

  async submitForReview(id: string, actorId: string, dto: SubmitForReviewDto) {
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_submit_transfer_for_review($1,$2,$3) AS result`,
      [id, this.actor(actorId), dto?.note ?? null],
    );
    return firstResult(rows);
  }

  async verifyReceivingDetails(
    id: string,
    actorId: string,
    dto: VerifyReceivingDetailsDto,
  ) {
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_verify_receiving_details($1,$2,$3,$4) AS result`,
      [id, this.actor(actorId), dto.verified, dto?.note ?? null],
    );
    return firstResult(rows);
  }

  async addRequirement(
    transferId: string,
    actorId: string,
    dto: AddDocumentRequirementDto,
  ) {
    const transfer = await this.findOne(transferId);
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_add_requirement($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result`,
      [
        transfer.case_id,
        transfer.organization_id,
        dto.key,
        dto.title,
        dto.description ?? null,
        dto.category ?? null,
        transferId,
        dto.sort_order ?? 0,
        this.actor(actorId),
      ],
    );
    return firstResult(rows);
  }

  async uploadVerificationDocument(
    requirementId: string,
    actorId: string,
    dto: UploadVerificationDocumentDto,
  ) {
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_upload_verification_document($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result`,
      [
        requirementId,
        this.actor(actorId),
        dto.title,
        dto.document_type ?? 'bank_account_verification',
        dto.mime_type ?? null,
        dto.file_name ?? null,
        dto.file_size ?? null,
        dto.file_url ?? null,
        dto.description ?? null,
      ],
    );
    return firstResult(rows);
  }

  async setRequirementStatus(
    requirementId: string,
    actorId: string,
    dto: SetRequirementStatusDto,
  ) {
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_set_requirement_status($1,$2,$3,$4,$5) AS result`,
      [
        requirementId,
        dto.status,
        this.actor(actorId),
        dto?.note ?? null,
        dto?.document_id ?? null,
      ],
    );
    return firstResult(rows);
  }

  async adminReviewRequirement(
    requirementId: string,
    actorId: string,
    dto: AdminReviewRequirementDto,
  ) {
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_admin_review_requirement($1,$2,$3,$4) AS result`,
      [requirementId, dto.outcome, this.actor(actorId), dto?.note ?? null],
    );
    return firstResult(rows);
  }

  async findRequirements(
    transferId: string,
    status?: string,
  ): Promise<Array<Record<string, unknown>>> {
    const where = status
      ? `WHERE r.transfer_id = $1 AND r.status = $2`
      : `WHERE r.transfer_id = $1`;
    const params = status ? [transferId, status] : [transferId];
    return this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT r.*, public.vf_requirement_status_label(r.status) AS client_status
       FROM public.transfer_document_requirements r ${where}
       ORDER BY r.sort_order, r.created_at ASC`,
      params,
    );
  }

  async findRequirement(
    requirementId: string,
    view: 'admin' | 'client' = 'admin',
  ): Promise<JsonResult> {
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_get_requirement_detail($1,$2) AS result`,
      [requirementId, view ?? 'admin'],
    );
    return firstResult(rows);
  }

  async execute(id: string, actorId: string, dto: ExecuteTransferDto) {
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_execute_transfer($1,$2,$3) AS result`,
      [id, this.actor(actorId), dto.confirmation_reference],
    );
    return firstResult(rows);
  }

  async completeReview(caseId: string, actorId: string) {
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_complete_case_review($1,$2) AS result`,
      [caseId, this.actor(actorId)],
    );
    return firstResult(rows);
  }

  private actor(actorId: string): string {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        actorId,
      )
    )
      throw new UnauthorizedException('verified actor identity required');
    return actorId;
  }
}
