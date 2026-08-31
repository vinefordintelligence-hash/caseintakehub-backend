import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Actor, ActorService } from '../common/actor.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationCenterService } from '../notification-center/notification-center.service';

export interface CreateDocumentRequestInput {
  caseId: string;
  title: string;
  description?: string | null;
  deadline?: string | null;
  isClientVisible?: boolean;
}

export interface SubmitDocumentRequestInput {
  title?: string | null;
  file_name: string;
  file_size?: number | null;
  file_type?: string | null;
}

export interface ReviewDocumentRequestInput {
  status: 'approved' | 'rejected';
  note?: string | null;
}

@Injectable()
export class DocumentRequestsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly actorService: ActorService,
    private readonly auditLogsService: AuditLogsService,
    private readonly notificationCenterService: NotificationCenterService,
  ) {}

  private async canAccessCase(
    actorId: string,
    caseId: string,
  ): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ allowed: boolean }>>(
      `SELECT public.vf_actor_can_access_case($1,$2) AS allowed`,
      [actorId, caseId],
    );
    return rows[0]?.allowed === true;
  }

  async create(
    actorId: string,
    input: CreateDocumentRequestInput,
  ): Promise<Record<string, unknown>> {
    const actor = await this.actorService.requireAdmin(actorId);
    const rows = await this.dataSource.query<Record<string, unknown>[]>(
      `INSERT INTO public.document_requests
         (case_id, organization_id, title, description, deadline, is_client_visible, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.caseId,
        actor.organization_id,
        input.title,
        input.description ?? null,
        input.deadline ? new Date(input.deadline) : null,
        input.isClientVisible ?? true,
        actor.id,
      ],
    );
    const created = rows[0];
    await this.notificationCenterService.create({
      caseId: input.caseId,
      organizationId: actor.organization_id,
      recipientRole: 'client',
      title: 'Document requested',
      body: `Vineford is requesting: ${input.title}`,
    });
    await this.auditLogsService.create({
      organizationId: actor.organization_id,
      userId: actor.id,
      action: 'document_request.created',
      resourceType: 'document_request',
      resourceId: String(created.id),
      caseId: input.caseId,
      changes: { title: input.title, deadline: input.deadline ?? null },
    });
    return created;
  }

  async findAll(
    actorId: string,
    caseId?: string,
    view: 'client' | 'admin' = 'admin',
  ): Promise<Record<string, unknown>[]> {
    const actor = await this.actorService.find(actorId);
    if (!actor) {
      return [];
    }

    if (actor.role === 'client') {
      if (!caseId) {
        return [];
      }
      const allowed = await this.canAccessCase(actor.id, caseId);
      if (!allowed) {
        throw new UnauthorizedException(
          'permission denied: actor is not authorized for case',
        );
      }
      return this.dataSource.query<Record<string, unknown>[]>(
        `SELECT dr.id, dr.title, dr.description, dr.status, dr.deadline,
                dr.is_client_visible, dr.created_at, dr.review_note,
                d.file_name, d.file_url, d.file_size, d.created_at AS submitted_at,
                dr.reviewed_at, dr.reviewed_by
           FROM public.document_requests dr
           LEFT JOIN public.documents d ON d.id = dr.submitted_document_id
          WHERE dr.case_id = $1 AND dr.is_client_visible = true
          ORDER BY dr.created_at DESC`,
        [caseId],
      );
    }

    return this.dataSource.query<Record<string, unknown>[]>(
      `SELECT dr.*, c.case_number, d.file_name, d.created_at AS submitted_at
         FROM public.document_requests dr
         LEFT JOIN public.cases c ON c.id = dr.case_id
         LEFT JOIN public.documents d ON d.id = dr.submitted_document_id
        WHERE dr.organization_id = $1
          ${caseId ? 'AND dr.case_id = $2' : ''}
        ORDER BY dr.created_at DESC
        LIMIT 200`,
      caseId ? [actor.organization_id, caseId] : [actor.organization_id],
    );
  }

  async submit(
    actorId: string,
    requestId: string,
    input: SubmitDocumentRequestInput,
  ): Promise<Record<string, unknown>> {
    const actor = await this.actorService.find(actorId);
    if (!actor) {
      throw new UnauthorizedException('permission denied: unknown actor');
    }
    const reqRows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT id, case_id, organization_id, status FROM public.document_requests WHERE id = $1`,
      [requestId],
    );
    const request = reqRows[0];
    if (!request) {
      throw new UnauthorizedException('document request not found');
    }

    const isAdmin = actor.role !== 'client';
    if (!isAdmin) {
      const allowed = await this.canAccessCase(
        actor.id,
        String(request.case_id),
      );
      if (!allowed) {
        throw new UnauthorizedException(
          'permission denied: actor is not authorized for case',
        );
      }
    }

    const docRows = await this.dataSource.query<Record<string, unknown>[]>(
      `INSERT INTO public.documents
         (case_id, organization_id, title, description, document_type, file_name, file_size, document_status, is_client_visible, uploaded_by, document_request_id)
       VALUES ($1, $2, $3, $4, 'document_request', $5, $6, 'submitted', true, $7, $8)
       RETURNING *`,
      [
        request.case_id,
        request.organization_id,
        input.title || input.file_name,
        null,
        input.file_name,
        input.file_size ?? null,
        actor.id,
        requestId,
      ],
    );
    const doc = docRows[0];

    await this.dataSource.query(
      `UPDATE public.document_requests
          SET status = 'submitted', submitted_document_id = $2, reviewed_by = NULL, reviewed_at = NULL, review_note = NULL
        WHERE id = $1`,
      [requestId, doc.id],
    );

    await this.notificationCenterService.create({
      caseId: String(request.case_id),
      organizationId: String(request.organization_id),
      recipientRole: 'admin',
      title: 'Client document submitted',
      body: `A requested document was submitted: ${input.file_name}`,
    });
    await this.auditLogsService.create({
      organizationId: String(request.organization_id),
      userId: actor.id,
      action: 'document_request.submitted',
      resourceType: 'document_request',
      resourceId: requestId,
      caseId: String(request.case_id),
      changes: { file_name: input.file_name, document_id: doc.id },
    });
    return doc;
  }

  async review(
    actorId: string,
    requestId: string,
    input: ReviewDocumentRequestInput,
  ): Promise<Record<string, unknown>> {
    const actor = await this.actorService.requireAdmin(actorId);
    const reqRows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT id, case_id, organization_id, title FROM public.document_requests WHERE id = $1`,
      [requestId],
    );
    const request = reqRows[0];
    if (!request) {
      throw new UnauthorizedException('document request not found');
    }

    await this.dataSource.query(
      `UPDATE public.document_requests
          SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
        WHERE id = $1`,
      [requestId, input.status, actor.id, input.note ?? null],
    );

    await this.notificationCenterService.create({
      caseId: String(request.case_id),
      organizationId: String(request.organization_id),
      recipientRole: 'client',
      title:
        input.status === 'approved'
          ? 'Document approved'
          : 'Document needs attention',
      body:
        input.status === 'approved'
          ? `"${request.title}" was approved.`
          : `"${request.title}" was not approved.${input.note ? ' ' + input.note : ''}`,
    });
    await this.auditLogsService.create({
      organizationId: String(request.organization_id),
      userId: actor.id,
      action: `document_request.${input.status}`,
      resourceType: 'document_request',
      resourceId: requestId,
      caseId: String(request.case_id),
      changes: { note: input.note ?? null },
    });
    return { id: requestId, status: input.status };
  }
}
