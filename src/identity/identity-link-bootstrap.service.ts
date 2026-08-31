import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface SupabaseProfile {
  id: string;
  email: string;
  organization_id?: string;
  role?: string;
}
export interface BootstrapSummary {
  candidates: number;
  linked: number;
  alreadyLinked: number;
  skippedAmbiguous: number;
  skippedInactive: number;
  conflicts: number;
  dryRun: boolean;
}

@Injectable()
export class IdentityLinkBootstrapService {
  constructor(private readonly dataSource: DataSource) {}
  async run(
    profiles: SupabaseProfile[],
    dryRun: boolean,
  ): Promise<BootstrapSummary> {
    const summary: BootstrapSummary = {
      candidates: profiles.length,
      linked: 0,
      alreadyLinked: 0,
      skippedAmbiguous: 0,
      skippedInactive: 0,
      conflicts: 0,
      dryRun,
    };
    for (const profile of profiles) {
      const existing = await this.dataSource.query<
        Array<{ app_user_id: string; supabase_user_id: string }>
      >(
        'SELECT app_user_id, supabase_user_id FROM public.vf_identity_links WHERE supabase_user_id = $1 OR app_user_id IN (SELECT id FROM public.app_users WHERE lower(email) = lower($2))',
        [profile.id, profile.email],
      );
      if (existing.some((row) => row.supabase_user_id === profile.id)) {
        summary.alreadyLinked++;
        continue;
      }
      if (existing.length) {
        summary.conflicts++;
        continue;
      }
      const users = await this.dataSource.query<
        Array<{ id: string; role: string; organization_id: string }>
      >(
        "SELECT id, role::text, organization_id FROM public.app_users WHERE lower(email) = lower($1) AND is_active = true AND role <> 'client'",
        [profile.email],
      );
      if (users.length !== 1) {
        if (users.length > 1) summary.skippedAmbiguous++;
        else summary.skippedInactive++;
        continue;
      }
      if (dryRun) {
        summary.linked++;
        continue;
      }
      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          "INSERT INTO public.organization_memberships (organization_id, app_user_id, role, status) VALUES ($1,$2,$3,'active') ON CONFLICT (organization_id, app_user_id) DO NOTHING",
          [users[0].organization_id, users[0].id, users[0].role],
        );
        const memberships = await manager.query<Array<{ status: string }>>(
          'SELECT status::text FROM public.organization_memberships WHERE organization_id=$1 AND app_user_id=$2',
          [users[0].organization_id, users[0].id],
        );
        if (memberships.length !== 1 || memberships[0].status !== 'active')
          throw new Error('local organization membership is inactive');
        await manager.query(
          "INSERT INTO public.vf_identity_links (app_user_id, organization_id, supabase_user_id, email_snapshot, status, verified_at) VALUES ($1,$2,$3,$4,'active',now())",
          [users[0].id, users[0].organization_id, profile.id, profile.email],
        );
      });
      summary.linked++;
    }
    return summary;
  }
}
