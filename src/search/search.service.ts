import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { SearchQueryDto } from './dto/search-query.dto';

@Injectable()
export class SearchService {
  constructor(@InjectDataSource() private readonly data: DataSource) {}

  async search(dto: SearchQueryDto, identity: VerifiedIdentity) {
    if (identity.role === 'client')
      throw new ForbiddenException('staff access required');
    const pattern = `%${dto.q.trim().replace(/[\\%_]/g, '\\$&')}%`;
    const type = dto.type ?? 'all';
    const rows = await this.data.query(
      `SELECT * FROM (
        SELECT 'case'::text type,c.id,c.case_number reference,c.title label,c.description detail,c.updated_at sort_at
          FROM public.cases c WHERE c.organization_id=$1 AND ($3 IN ('all','case')) AND (c.case_number ILIKE $2 ESCAPE '\\' OR c.title ILIKE $2 ESCAPE '\\' OR c.description ILIKE $2 ESCAPE '\\')
        UNION ALL SELECT 'client',cl.id,NULL,cl.name,cl.email,cl.updated_at FROM public.clients cl
          WHERE cl.organization_id=$1 AND ($3 IN ('all','client')) AND (cl.name ILIKE $2 ESCAPE '\\' OR cl.email ILIKE $2 ESCAPE '\\')
        UNION ALL SELECT 'document',d.id,c.case_number,d.title,d.file_name,d.updated_at FROM public.documents d JOIN public.cases c ON c.id=d.case_id AND c.organization_id=d.organization_id
          WHERE d.organization_id=$1 AND ($3 IN ('all','document')) AND (d.title ILIKE $2 ESCAPE '\\' OR d.file_name ILIKE $2 ESCAPE '\\')
        UNION ALL SELECT 'evidence',e.id,c.case_number,e.type,e.description,e.updated_at FROM public.evidence e JOIN public.cases c ON c.id=e.case_id AND c.organization_id=e.organization_id
          WHERE e.organization_id=$1 AND ($3 IN ('all','evidence')) AND (e.type ILIKE $2 ESCAPE '\\' OR e.description ILIKE $2 ESCAPE '\\')
       ) results ORDER BY sort_at DESC NULLS LAST LIMIT $4`,
      [identity.organizationId, pattern, type, dto.limit ?? 30],
    );
    return { items: rows, query: dto.q.trim(), type, limit: dto.limit ?? 30 };
  }

  async lookup(id: string, identity: VerifiedIdentity) {
    if (identity.role === 'client')
      throw new ForbiddenException('staff access required');
    const rows = await this.data.query(
      `SELECT c.id,c.case_number,c.title,c.status,c.workflow_phase,c.updated_at FROM public.cases c
       WHERE c.organization_id=$1 AND (c.id::text=$2 OR upper(c.case_number)=upper($2))`,
      [identity.organizationId, id],
    );
    if (!rows[0]) throw new NotFoundException('resource not found');
    return rows[0];
  }

  create(): never {
    throw new ForbiddenException('saved searches are not enabled');
  }
  update(): never {
    throw new ForbiddenException('saved searches are not enabled');
  }
  remove(): never {
    throw new ForbiddenException('saved searches are not enabled');
  }
}
