import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { PermissionsService } from '../permissions/permissions.service';

type DocumentInput = {
  case_id?: unknown;
  title?: unknown;
  description?: unknown;
  document_type?: unknown;
  file_url?: unknown;
  file_name?: unknown;
  file_size?: unknown;
  document_status?: unknown;
  is_client_visible?: unknown;
  mime_type?: unknown;
  metadata?: unknown;
};

@Injectable()
export class DocumentsService {
  constructor(
    @InjectDataSource() private readonly data: DataSource,
    private readonly permissions: PermissionsService,
  ) {}
  private client(identity: VerifiedIdentity) {
    return identity.role === 'client';
  }
  async create(
    dto: CreateDocumentDto & DocumentInput,
    identity: VerifiedIdentity,
  ) {
    const caseId = typeof dto.case_id === 'string' ? dto.case_id : null;
    if (!caseId) throw new BadRequestException('case_id is required');
    const cases = await this.data.query(
      `SELECT id FROM public.cases WHERE id=$1 AND organization_id=$2 ${this.client(identity) ? 'AND id=$3' : ''}`,
      this.client(identity)
        ? [caseId, identity.organizationId, identity.caseId]
        : [caseId, identity.organizationId],
    );
    if (!cases[0]) throw new NotFoundException('case not found');
    const rows = await this.data.query(
      `INSERT INTO public.documents (case_id,organization_id,title,description,document_type,file_url,file_name,file_size,document_status,is_client_visible,uploaded_by,uploaded_at,mime_type,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12,$13) RETURNING *`,
      [
        caseId,
        identity.organizationId,
        dto.title ?? dto.file_name ?? 'Document',
        dto.description ?? null,
        dto.document_type ?? null,
        dto.file_url ?? null,
        dto.file_name ?? null,
        dto.file_size ?? null,
        this.client(identity)
          ? 'submitted'
          : (dto.document_status ?? 'submitted'),
        this.client(identity) ? true : (dto.is_client_visible ?? false),
        identity.actorId,
        dto.mime_type ?? null,
        JSON.stringify(dto.metadata ?? {}),
      ],
    );
    return rows[0];
  }
  async findAll(identity: VerifiedIdentity) {
    return this.data.query(
      `SELECT * FROM public.documents WHERE organization_id=$1 ${this.client(identity) ? 'AND case_id=$2 AND is_client_visible=true' : ''} ORDER BY created_at DESC`,
      this.client(identity)
        ? [identity.organizationId, identity.caseId]
        : [identity.organizationId],
    );
  }
  async findOne(id: string, identity: VerifiedIdentity) {
    const rows = await this.data.query(
      `SELECT * FROM public.documents WHERE id=$1 AND organization_id=$2 ${this.client(identity) ? 'AND case_id=$3 AND is_client_visible=true' : ''}`,
      this.client(identity)
        ? [id, identity.organizationId, identity.caseId]
        : [id, identity.organizationId],
    );
    if (!rows[0]) throw new NotFoundException('document not found');
    return rows[0];
  }
  async update(
    id: string,
    dto: UpdateDocumentDto & DocumentInput,
    identity: VerifiedIdentity,
  ) {
    const existing = await this.findOne(id, identity);
    if (this.client(identity) && existing.uploaded_by !== identity.actorId)
      throw new ForbiddenException('client cannot update this document');
    if (
      dto.document_status !== undefined ||
      dto.is_client_visible !== undefined
    )
      await this.permissions.require(identity, 'documents.verify');
    const rows = await this.data.query(
      `UPDATE public.documents SET title=COALESCE($1,title),description=COALESCE($2,description),document_status=COALESCE($3,document_status),is_client_visible=COALESCE($4,is_client_visible),updated_at=now() WHERE id=$5 AND organization_id=$6 RETURNING *`,
      [
        dto.title ?? null,
        dto.description ?? null,
        this.client(identity) ? null : (dto.document_status ?? null),
        this.client(identity) ? null : (dto.is_client_visible ?? null),
        id,
        identity.organizationId,
      ],
    );
    return rows[0];
  }
  async remove(id: string, identity: VerifiedIdentity) {
    if (this.client(identity))
      throw new ForbiddenException('client cannot delete documents');
    const held = await this.data.query(
      `SELECT 1 FROM public.documents d
       JOIN public.cases c ON c.id = d.case_id
       WHERE d.id = $1 AND d.organization_id = $2 AND c.legal_hold = true`,
      [id, identity.organizationId],
    );
    if (held[0])
      throw new ConflictException(
        'case is under legal hold and document cannot be deleted',
      );
    const rows = await this.data.query(
      `DELETE FROM public.documents WHERE id=$1 AND organization_id=$2 RETURNING id`,
      [id, identity.organizationId],
    );
    if (!rows[0]) throw new NotFoundException('document not found');
  }
}
