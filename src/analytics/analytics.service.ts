import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

@Injectable()
export class AnalyticsService {
  constructor(@InjectDataSource() private readonly data: DataSource) {}

  async overview(identity: VerifiedIdentity) {
    if (identity.role === 'client')
      throw new ForbiddenException('staff access required');
    const [summary, phases, timeInPhase, workload] = await Promise.all([
      this.data.query('SELECT public.vf_dashboard_summary($1::uuid) value', [
        identity.organizationId,
      ]),
      this.data.query(
        'SELECT public.vf_dashboard_phase_distribution($1::uuid) value',
        [identity.organizationId],
      ),
      this.data.query(
        'SELECT public.vf_dashboard_time_in_phase($1::uuid) value',
        [identity.organizationId],
      ),
      this.data.query(
        `SELECT COALESCE(u.name,'Unassigned') investigator,count(c.id)::int cases
        FROM public.cases c LEFT JOIN public.app_users u ON u.id=c.assigned_to AND u.organization_id=c.organization_id
        WHERE c.organization_id=$1 AND c.status NOT IN ('closed','archived') GROUP BY u.id,u.name ORDER BY count(c.id) DESC`,
        [identity.organizationId],
      ),
    ]);
    return {
      summary: summary[0]?.value ?? {},
      casesByPhase: phases[0]?.value ?? [],
      timeInPhase: timeInPhase[0]?.value ?? [],
      investigatorWorkload: workload,
      generatedAt: new Date().toISOString(),
    };
  }

  create(): never {
    throw new ForbiddenException('analytics are read-only');
  }
  findOne(): never {
    throw new ForbiddenException('analytics are aggregate resources');
  }
  update(): never {
    throw new ForbiddenException('analytics are read-only');
  }
  remove(): never {
    throw new ForbiddenException('analytics are read-only');
  }
}
