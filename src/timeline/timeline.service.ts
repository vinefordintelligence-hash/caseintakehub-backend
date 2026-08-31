import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { CreateTimelineDto } from './dto/create-timeline.dto';
import { UpdateTimelineDto } from './dto/update-timeline.dto';

type TimelineInput = {
  case_id?: unknown;
  title?: unknown;
  description?: unknown;
  event_date?: unknown;
  phase?: unknown;
  status?: unknown;
  is_client_visible?: unknown;
  metadata?: unknown;
};

@Injectable()
export class TimelineService {
  constructor(@InjectDataSource() private readonly data: DataSource) {}
  private isClient(identity: VerifiedIdentity) {
    return identity.role === 'client';
  }
  async create(
    dto: CreateTimelineDto & TimelineInput,
    identity: VerifiedIdentity,
  ) {
    if (this.isClient(identity))
      throw new ForbiddenException('client cannot create timeline events');
    if (typeof dto.case_id !== 'string' || typeof dto.title !== 'string')
      throw new BadRequestException('case_id and title are required');
    const cases = await this.data.query(
      `SELECT id FROM public.cases WHERE id=$1 AND organization_id=$2`,
      [dto.case_id, identity.organizationId],
    );
    if (!cases[0]) throw new NotFoundException('case not found');
    const rows = await this.data.query(
      `INSERT INTO public.timeline (case_id,organization_id,title,description,event_date,phase,status,actor_id,is_client_visible,metadata) VALUES ($1,$2,$3,$4,COALESCE($5::timestamptz,now()),$6,$7,$8,COALESCE($9,false),$10) RETURNING *`,
      [
        dto.case_id,
        identity.organizationId,
        dto.title,
        dto.description ?? null,
        dto.event_date ?? null,
        dto.phase ?? null,
        dto.status ?? null,
        identity.actorId,
        dto.is_client_visible === true,
        JSON.stringify(dto.metadata ?? {}),
      ],
    );
    return rows[0];
  }
  async findAll(identity: VerifiedIdentity) {
    return this.data.query(
      `SELECT * FROM public.timeline WHERE organization_id=$1 ${this.isClient(identity) ? 'AND case_id=$2 AND is_client_visible=true' : ''} ORDER BY event_date DESC, created_at DESC`,
      this.isClient(identity)
        ? [identity.organizationId, identity.caseId]
        : [identity.organizationId],
    );
  }
  async findOne(id: string, identity: VerifiedIdentity) {
    const rows = await this.data.query(
      `SELECT * FROM public.timeline WHERE id=$1 AND organization_id=$2 ${this.isClient(identity) ? 'AND case_id=$3 AND is_client_visible=true' : ''}`,
      this.isClient(identity)
        ? [id, identity.organizationId, identity.caseId]
        : [id, identity.organizationId],
    );
    if (!rows[0]) throw new NotFoundException('timeline event not found');
    return rows[0];
  }
  async update(
    id: string,
    dto: UpdateTimelineDto & TimelineInput,
    identity: VerifiedIdentity,
  ) {
    if (this.isClient(identity))
      throw new ForbiddenException('client cannot update timeline events');
    const original = await this.findOne(id, identity);
    const metadata = {
      ...(original.metadata ?? {}),
      ...(dto.metadata ?? {}),
      supersedes_event_id: id,
      correction: true,
    };
    const rows = await this.data.query(
      `INSERT INTO public.timeline (case_id,organization_id,title,description,event_date,phase,status,actor_id,is_client_visible,metadata) VALUES ($1,$2,$3,$4,now(),$5,$6,$7,$8,$9) RETURNING *`,
      [
        original.case_id,
        identity.organizationId,
        dto.title ?? original.title,
        dto.description ?? original.description,
        dto.phase ?? original.phase,
        dto.status ?? original.status,
        identity.actorId,
        typeof dto.is_client_visible === 'boolean'
          ? dto.is_client_visible
          : original.is_client_visible,
        JSON.stringify(metadata),
      ],
    );
    return rows[0];
  }
  async remove(id: string, identity: VerifiedIdentity) {
    if (this.isClient(identity))
      throw new ForbiddenException('client cannot delete timeline events');
    const original = await this.findOne(id, identity);
    const rows = await this.data.query(
      `INSERT INTO public.timeline (case_id,organization_id,title,description,event_date,phase,status,actor_id,is_client_visible,metadata) VALUES ($1,$2,$3,$4,now(),$5,$6,$7,false,$8) RETURNING *`,
      [
        original.case_id,
        identity.organizationId,
        'Timeline event retracted',
        'An earlier timeline event was retracted; the original record remains preserved.',
        original.phase ?? null,
        'retracted',
        identity.actorId,
        JSON.stringify({ retracts_event_id: id }),
      ],
    );
    return rows[0];
  }
}
