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
import { CreateEvidenceDto } from './dto/create-evidence.dto';
import { UpdateEvidenceDto } from './dto/update-evidence.dto';

@Injectable()
export class EvidenceService {
  constructor(@InjectDataSource() private readonly data: DataSource) {}

  private async caseScope(caseId: string, identity: VerifiedIdentity) {
    const rows = await this.data.query<Array<{ id: string }>>(
      `SELECT id FROM public.cases WHERE id = $1 AND organization_id = $2
       ${identity.role === 'client' ? 'AND id = $3' : ''}`,
      identity.role === 'client'
        ? [caseId, identity.organizationId, identity.caseId]
        : [caseId, identity.organizationId],
    );
    if (!rows[0]) throw new NotFoundException('case not found');
  }

  async create(
    dto: CreateEvidenceDto & {
      case_id?: string;
      type?: string;
      description?: string;
      file_url?: string;
      file_name?: string;
      file_size?: number;
    },
    identity: VerifiedIdentity,
  ) {
    if (identity.role === 'client')
      throw new ForbiddenException('client cannot create evidence');
    if (!dto.case_id || !dto.type)
      throw new BadRequestException('case_id and type are required');
    await this.caseScope(dto.case_id, identity);
    const rows = await this.data.query(
      `INSERT INTO public.evidence (case_id, organization_id, type, description, file_url, file_name, file_size)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        dto.case_id,
        identity.organizationId,
        dto.type,
        dto.description ?? null,
        dto.file_url ?? null,
        dto.file_name ?? null,
        dto.file_size ?? null,
      ],
    );
    return rows[0];
  }

  async findAll(identity: VerifiedIdentity) {
    const rows = await this.data.query(
      `SELECT e.* FROM public.evidence e JOIN public.cases c ON c.id = e.case_id
       WHERE e.organization_id = $1 ${identity.role === 'client' ? 'AND e.case_id = $2' : ''}
       ORDER BY e.created_at DESC`,
      identity.role === 'client'
        ? [identity.organizationId, identity.caseId]
        : [identity.organizationId],
    );
    return rows;
  }

  async findOne(id: string, identity: VerifiedIdentity) {
    const rows = await this.data.query(
      `SELECT e.* FROM public.evidence e JOIN public.cases c ON c.id = e.case_id
       WHERE e.id = $1 AND e.organization_id = $2 ${identity.role === 'client' ? 'AND e.case_id = $3' : ''}`,
      identity.role === 'client'
        ? [id, identity.organizationId, identity.caseId]
        : [id, identity.organizationId],
    );
    if (!rows[0]) throw new NotFoundException('evidence not found');
    return rows[0];
  }

  async update(
    id: string,
    dto: UpdateEvidenceDto & { type?: string; description?: string },
    identity: VerifiedIdentity,
  ) {
    if (identity.role === 'client')
      throw new ForbiddenException('client cannot update evidence');
    await this.findOne(id, identity);
    const rows = await this.data.query(
      `UPDATE public.evidence SET type = COALESCE($1,type), description = COALESCE($2,description), updated_at = now()
       WHERE id = $3 AND organization_id = $4 RETURNING *`,
      [dto.type ?? null, dto.description ?? null, id, identity.organizationId],
    );
    return rows[0];
  }

  async remove(id: string, identity: VerifiedIdentity) {
    if (identity.role === 'client')
      throw new ForbiddenException('client cannot delete evidence');
    const held = await this.data.query(
      `SELECT 1 FROM public.evidence e
       JOIN public.cases c ON c.id = e.case_id
       WHERE e.id = $1 AND e.organization_id = $2 AND c.legal_hold = true`,
      [id, identity.organizationId],
    );
    if (held[0])
      throw new ConflictException(
        'case is under legal hold and evidence cannot be deleted',
      );
    const result = await this.data.query(
      `DELETE FROM public.evidence WHERE id = $1 AND organization_id = $2 RETURNING id`,
      [id, identity.organizationId],
    );
    if (!result[0]) throw new NotFoundException('evidence not found');
  }
}
