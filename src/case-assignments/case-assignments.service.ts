/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import {
  CreateAssignmentDto,
  ReassignAssignmentDto,
  RemoveAssignmentDto,
} from './dto/assignment.dto';

type Row = Record<string, unknown>;
const ADMIN = ['admin', 'super_admin'];

@Injectable()
export class CaseAssignmentsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}
  private admin(identity: VerifiedIdentity) {
    if (!ADMIN.includes(identity.role))
      throw new ForbiddenException('administrator access required');
  }
  private async eligible(
    manager: Pick<EntityManager, 'query'>,
    userId: string,
    orgId: string,
  ) {
    const rows = await manager.query(
      `SELECT u.id FROM public.app_users u JOIN public.organization_memberships m ON m.app_user_id=u.id AND m.organization_id=$2 AND m.status='active' WHERE u.id=$1 AND u.organization_id=$2 AND u.is_active=true AND m.role IN ('admin','super_admin','investigator','staff')`,
      [userId, orgId],
    );
    if (!rows[0])
      throw new NotFoundException('eligible staff member not found');
  }
  private workload(count: number) {
    return count >= 8 ? 'high' : count >= 5 ? 'moderate' : 'available';
  }

  async overview(
    identity: VerifiedIdentity,
    filters: Record<string, string | undefined>,
  ) {
    const ownOnly = identity.role === 'investigator';
    if (!ownOnly && !ADMIN.includes(identity.role))
      throw new ForbiddenException('staff assignment access denied');
    const params: unknown[] = [
      identity.organizationId,
      ownOnly ? identity.actorId : null,
      filters.investigator || null,
      filters.priority || null,
      filters.status || null,
      filters.assignment || null,
    ];
    const staff = await this.db.query(
      `SELECT u.id,u.name,u.email,m.role::text,u.is_active,u.last_sign_in_at,
      count(a.id) FILTER (WHERE a.active)::int active_assigned_cases,
      count(a.id)::int total_assigned_cases
      FROM public.app_users u JOIN public.organization_memberships m ON m.app_user_id=u.id AND m.organization_id=$1 AND m.status='active'
      LEFT JOIN public.case_assignments a ON a.app_user_id=u.id AND a.organization_id=$1
      WHERE u.organization_id=$1 AND m.role IN ('admin','super_admin','investigator','staff') AND ($2::uuid IS NULL OR u.id=$2)
      GROUP BY u.id,u.name,u.email,m.role,u.is_active,u.last_sign_in_at ORDER BY active_assigned_cases,u.name NULLS LAST,u.email`,
      params.slice(0, 2),
    );
    const cases = await this.db.query(
      `SELECT c.id,c.case_number,c.title,c.status,c.priority,
      COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'app_user_id',u.id,'name',u.name,'email',u.email,'role',a.assignment_role,'kind',a.assignment_kind,'assigned_at',a.assigned_at,'internal_note',a.internal_note)) FILTER (WHERE a.id IS NOT NULL),'[]') assignments
      FROM public.cases c LEFT JOIN public.case_assignments a ON a.case_id=c.id AND a.organization_id=c.organization_id AND a.active
      LEFT JOIN public.app_users u ON u.id=a.app_user_id
      WHERE c.organization_id=$1 AND ($2::uuid IS NULL OR a.app_user_id=$2)
        AND ($3::uuid IS NULL OR a.app_user_id=$3) AND ($4::text IS NULL OR c.priority::text=$4) AND ($5::text IS NULL OR c.status::text=$5)
      GROUP BY c.id HAVING ($6::text IS NULL OR ($6='assigned' AND count(a.id)>0) OR ($6='unassigned' AND count(a.id)=0))
      ORDER BY c.updated_at DESC`,
      params,
    );
    return {
      staff: staff.map((s: Row) => ({
        ...s,
        availability: s.is_active ? 'active' : 'inactive',
        current_workload: this.workload(Number(s.active_assigned_cases || 0)),
      })),
      cases,
    };
  }

  async history(caseId: string, identity: VerifiedIdentity) {
    const own = identity.role === 'investigator';
    if (!own && !ADMIN.includes(identity.role))
      throw new ForbiddenException('staff assignment access denied');
    return this.db.query(
      `SELECT h.*,actor.name actor_name,actor.email actor_email,assigned.name assigned_name,assigned.email assigned_email,previous.name previous_name,previous.email previous_email
      FROM public.case_assignment_history h JOIN public.app_users actor ON actor.id=h.actor_id LEFT JOIN public.app_users assigned ON assigned.id=h.assigned_user_id LEFT JOIN public.app_users previous ON previous.id=h.previous_user_id
      WHERE h.case_id=$1 AND h.organization_id=$2 AND ($3::uuid IS NULL OR h.assigned_user_id=$3 OR h.previous_user_id=$3) ORDER BY h.occurred_at DESC`,
      [caseId, identity.organizationId, own ? identity.actorId : null],
    );
  }

  async create(dto: CreateAssignmentDto, identity: VerifiedIdentity) {
    this.admin(identity);
    return this.db.transaction(async (m) => {
      const cases = await m.query(
        'SELECT id FROM public.cases WHERE id=$1 AND organization_id=$2',
        [dto.case_id, identity.organizationId],
      );
      if (!cases[0]) throw new NotFoundException('case not found');
      await this.eligible(m, dto.app_user_id, identity.organizationId);
      if (dto.assignment_kind === 'primary')
        await m.query(
          `UPDATE public.case_assignments SET active=false,unassigned_at=clock_timestamp(),removal_reason='Replaced by a new primary assignment',updated_at=clock_timestamp() WHERE case_id=$1 AND organization_id=$2 AND assignment_kind='primary' AND active`,
          [dto.case_id, identity.organizationId],
        );
      const rows = await m.query(
        `INSERT INTO public.case_assignments(case_id,organization_id,app_user_id,assignment_role,assignment_kind,assigned_by,assigned_at,internal_note,active) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz,clock_timestamp()),$8,true) ON CONFLICT(case_id,app_user_id,assignment_role) DO UPDATE SET assignment_kind=EXCLUDED.assignment_kind,assigned_by=EXCLUDED.assigned_by,assigned_at=EXCLUDED.assigned_at,internal_note=EXCLUDED.internal_note,active=true,unassigned_at=NULL,removal_reason=NULL,updated_at=clock_timestamp() RETURNING *`,
        [
          dto.case_id,
          identity.organizationId,
          dto.app_user_id,
          dto.assignment_role,
          dto.assignment_kind,
          identity.actorId,
          dto.assignment_date || null,
          dto.internal_note?.trim() || null,
        ],
      );
      await m.query(
        `INSERT INTO public.case_assignment_history(organization_id,case_id,assignment_id,action,actor_id,assigned_user_id,assignment_role,assignment_kind,internal_note) VALUES($1,$2,$3,'assigned',$4,$5,$6,$7,$8)`,
        [
          identity.organizationId,
          dto.case_id,
          rows[0].id,
          identity.actorId,
          dto.app_user_id,
          dto.assignment_role,
          dto.assignment_kind,
          dto.internal_note?.trim() || null,
        ],
      );
      return rows[0];
    });
  }

  async reassign(
    id: string,
    dto: ReassignAssignmentDto,
    identity: VerifiedIdentity,
  ) {
    this.admin(identity);
    return this.db.transaction(async (m) => {
      const old = (
        await m.query(
          'SELECT * FROM public.case_assignments WHERE id=$1 AND organization_id=$2 AND active=true FOR UPDATE',
          [id, identity.organizationId],
        )
      )[0];
      if (!old) throw new NotFoundException('active assignment not found');
      await this.eligible(m, dto.app_user_id, identity.organizationId);
      const role = dto.assignment_role || old.assignment_role,
        kind = dto.assignment_kind || old.assignment_kind;
      const rows = await m.query(
        `UPDATE public.case_assignments SET app_user_id=$3,assignment_role=$4,assignment_kind=$5,assigned_by=$6,assigned_at=clock_timestamp(),internal_note=$7,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 RETURNING *`,
        [
          id,
          identity.organizationId,
          dto.app_user_id,
          role,
          kind,
          identity.actorId,
          dto.internal_note?.trim() || null,
        ],
      );
      await m.query(
        `INSERT INTO public.case_assignment_history(organization_id,case_id,assignment_id,action,actor_id,assigned_user_id,previous_user_id,assignment_role,assignment_kind,reason,internal_note) VALUES($1,$2,$3,'reassigned',$4,$5,$6,$7,$8,$9,$10)`,
        [
          identity.organizationId,
          old.case_id,
          id,
          identity.actorId,
          dto.app_user_id,
          old.app_user_id,
          role,
          kind,
          dto.reason.trim(),
          dto.internal_note?.trim() || null,
        ],
      );
      return rows[0];
    });
  }

  async remove(
    id: string,
    dto: RemoveAssignmentDto,
    identity: VerifiedIdentity,
  ) {
    this.admin(identity);
    return this.db.transaction(async (m) => {
      const rows = await m.query(
        `UPDATE public.case_assignments SET active=false,unassigned_at=clock_timestamp(),removal_reason=$3,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 AND active=true RETURNING *`,
        [id, identity.organizationId, dto.reason.trim()],
      );
      const old = rows[0];
      if (!old) throw new NotFoundException('active assignment not found');
      await m.query(
        `INSERT INTO public.case_assignment_history(organization_id,case_id,assignment_id,action,actor_id,previous_user_id,assignment_role,assignment_kind,reason) VALUES($1,$2,$3,'removed',$4,$5,$6,$7,$8)`,
        [
          identity.organizationId,
          old.case_id,
          id,
          identity.actorId,
          old.app_user_id,
          old.assignment_role,
          old.assignment_kind,
          dto.reason.trim(),
        ],
      );
      return old;
    });
  }
}
