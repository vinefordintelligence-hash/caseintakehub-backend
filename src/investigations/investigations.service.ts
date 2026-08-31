import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateInvestigationDto } from './dto/create-investigation.dto';
import { UpdateInvestigationDto } from './dto/update-investigation.dto';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { CreateEntityDto, CreateRelationshipDto } from './dto/entity.dto';

@Injectable()
export class InvestigationsService {
  constructor(@InjectDataSource() private readonly data: DataSource) {}
  private async case(caseId: string, i: VerifiedIdentity) {
    const r = await this.data.query(
      'SELECT id FROM public.cases WHERE id=$1 AND organization_id=$2',
      [caseId, i.organizationId],
    );
    if (!r[0]) throw new NotFoundException('case not found');
  }
  async create(dto: CreateInvestigationDto, i: VerifiedIdentity) {
    await this.case(dto.case_id, i);
    const r = await this.data.query(
      `INSERT INTO public.investigation_findings(organization_id,case_id,title,narrative,source,confidence,created_by)VALUES($1,$2,$3,$4,$5,$6,$7)RETURNING *`,
      [
        i.organizationId,
        dto.case_id,
        dto.title.trim(),
        dto.narrative.trim(),
        dto.source?.trim() || null,
        dto.confidence ?? null,
        i.actorId,
      ],
    );
    return r[0];
  }
  findAll(i: VerifiedIdentity) {
    return this.data.query(
      `SELECT f.*,c.case_number,u.name created_by_name FROM public.investigation_findings f JOIN public.cases c ON c.id=f.case_id AND c.organization_id=f.organization_id LEFT JOIN public.app_users u ON u.id=f.created_by WHERE f.organization_id=$1 ORDER BY f.created_at DESC`,
      [i.organizationId],
    );
  }
  async findOne(id: string, i: VerifiedIdentity) {
    const r = await this.data.query(
      'SELECT * FROM public.investigation_findings WHERE id=$1 AND organization_id=$2',
      [id, i.organizationId],
    );
    if (!r[0]) throw new NotFoundException('finding not found');
    return r[0];
  }
  async update(id: string, dto: UpdateInvestigationDto, i: VerifiedIdentity) {
    const before = await this.findOne(id, i);
    if (dto.status && i.role === 'staff')
      throw new ForbiddenException('staff cannot review findings');
    const r = await this.data.query(
      `UPDATE public.investigation_findings SET title=COALESCE($1,title),narrative=COALESCE($2,narrative),source=COALESCE($3,source),confidence=COALESCE($4,confidence),status=COALESCE($5,status),reviewed_by=CASE WHEN $5 IS NULL OR $5='draft' THEN reviewed_by ELSE $6 END,updated_at=now() WHERE id=$7 AND organization_id=$8 RETURNING *`,
      [
        dto.title?.trim() || null,
        dto.narrative?.trim() || null,
        dto.source?.trim() || null,
        dto.confidence ?? null,
        dto.status ?? null,
        i.actorId,
        id,
        i.organizationId,
      ],
    );
    await this.audit(i, before.case_id, 'INVESTIGATION_FINDING_UPDATED', id, {
      before_status: before.status,
      after_status: r[0].status,
    });
    return r[0];
  }
  remove(id: string, i: VerifiedIdentity) {
    return this.update(id, { status: 'rejected' }, i);
  }
  async createEntity(dto: CreateEntityDto, i: VerifiedIdentity) {
    await this.case(dto.case_id, i);
    const r = await this.data.query(
      `INSERT INTO public.investigation_entities(organization_id,case_id,entity_type,display_name,normalized_value,metadata,created_by)VALUES($1,$2,$3,$4,$5,$6,$7)RETURNING *`,
      [
        i.organizationId,
        dto.case_id,
        dto.entity_type,
        dto.display_name.trim(),
        dto.normalized_value?.trim() || null,
        JSON.stringify(dto.metadata ?? {}),
        i.actorId,
      ],
    );
    return r[0];
  }
  entities(caseId: string, i: VerifiedIdentity) {
    return this.data.query(
      'SELECT * FROM public.investigation_entities WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC',
      [caseId, i.organizationId],
    );
  }
  async createRelationship(dto: CreateRelationshipDto, i: VerifiedIdentity) {
    await this.case(dto.case_id, i);
    const pair = await this.data.query(
      `SELECT count(*)::int n FROM public.investigation_entities WHERE id=ANY($1::uuid[]) AND case_id=$2 AND organization_id=$3`,
      [
        [dto.source_entity_id, dto.target_entity_id],
        dto.case_id,
        i.organizationId,
      ],
    );
    if (pair[0]?.n !== 2)
      throw new NotFoundException('relationship entity not found');
    const r = await this.data.query(
      `INSERT INTO public.entity_relationships(organization_id,case_id,source_entity_id,target_entity_id,relationship_type,confidence,metadata,created_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8)RETURNING *`,
      [
        i.organizationId,
        dto.case_id,
        dto.source_entity_id,
        dto.target_entity_id,
        dto.relationship_type.trim(),
        dto.confidence ?? null,
        JSON.stringify(dto.metadata ?? {}),
        i.actorId,
      ],
    );
    return r[0];
  }
  relationships(caseId: string, i: VerifiedIdentity) {
    return this.data.query(
      `SELECT r.*,s.display_name source_name,t.display_name target_name FROM public.entity_relationships r JOIN public.investigation_entities s ON s.id=r.source_entity_id JOIN public.investigation_entities t ON t.id=r.target_entity_id WHERE r.case_id=$1 AND r.organization_id=$2 ORDER BY r.created_at DESC`,
      [caseId, i.organizationId],
    );
  }
  private audit(
    i: VerifiedIdentity,
    caseId: string,
    action: string,
    id: string,
    changes: unknown,
  ) {
    return this.data.query(
      `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,case_id,changes)VALUES($1,$2,$3,'investigation_finding',$4,$5,$6)`,
      [
        i.organizationId,
        i.actorId,
        action,
        id,
        caseId,
        JSON.stringify(changes),
      ],
    );
  }
}
