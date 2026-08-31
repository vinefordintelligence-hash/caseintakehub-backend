import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { requestUpstream } from '../core/gateway/upstream-request';

export interface VerifiedIdentity {
  actorId: string;
  organizationId: string;
  role: string;
  supabaseUserId: string;
  caseId?: string;
}

export const VINEFORD_USER_ROLES = [
  'super_admin',
  'admin',
  'investigator',
  'financial_analyst',
  'staff',
  'client',
] as const;

export type VinefordUserRole = (typeof VINEFORD_USER_ROLES)[number];

@Injectable()
export class SupabaseIdentityService {
  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
  ) {}
  async verify(
    bearer?: string,
    claimedActorId?: string,
    requestedOrganizationId?: string,
  ): Promise<VerifiedIdentity> {
    if (
      !bearer ||
      bearer.length > 8200 ||
      !/^Bearer [A-Za-z0-9._~-]+$/.test(bearer)
    )
      throw new UnauthorizedException('invalid authentication credentials');
    const token = bearer.slice('Bearer '.length);
    const clientIdentity = await this.verifyClientSession(
      token,
      claimedActorId,
    );
    if (clientIdentity) return clientIdentity;
    const url = this.config.get<string>('SUPABASE_URL');
    const anonKey = this.config.get<string>('SUPABASE_ANON_KEY');
    if (!url || !anonKey)
      throw new UnauthorizedException(
        'Supabase identity verification is not configured',
      );
    let response: Response;
    try {
      response = await requestUpstream(
        `${url.replace(/\/$/, '')}/auth/v1/user`,
        {
          headers: { apikey: anonKey, authorization: bearer },
          cache: 'no-store',
        },
      );
    } catch {
      throw new UnauthorizedException(
        'Supabase identity verification unavailable',
      );
    }
    if (!response.ok)
      throw new UnauthorizedException('invalid Supabase access token');
    const user = (await response.json()) as { id?: unknown };
    if (typeof user.id !== 'string')
      throw new UnauthorizedException('invalid Supabase identity subject');
    const rows = await this.dataSource.query<
      Array<{ actor_id: string; organization_id: string; role: string }>
    >(
      `SELECT l.app_user_id AS actor_id, m.organization_id, m.role::text
       FROM public.vf_identity_links l JOIN public.app_users u ON u.id = l.app_user_id
       JOIN public.organization_memberships m ON m.app_user_id = u.id
       WHERE l.supabase_user_id = $1 AND l.status = 'active' AND m.status = 'active' AND u.is_active = true
         AND l.organization_id = m.organization_id
         AND m.role = u.role::text
         AND ($2::uuid IS NULL AND m.organization_id = u.organization_id OR $2::uuid IS NOT NULL AND m.organization_id = $2::uuid)`,
      [user.id, requestedOrganizationId ?? null],
    );
    if (rows.length !== 1 || rows[0].role === 'client')
      throw new UnauthorizedException(
        'no active authorized Vineford identity link',
      );
    if (claimedActorId && claimedActorId !== rows[0].actor_id)
      throw new UnauthorizedException('actor identity mismatch');
    return {
      actorId: rows[0].actor_id,
      organizationId: rows[0].organization_id,
      role: rows[0].role,
      supabaseUserId: user.id,
    };
  }

  /**
   * Client PIN sessions are issued only by ClientAuthService after its
   * case-reference/email/PIN verification.  They are signed by the backend
   * JWT key and revalidated against the current case/client state on every
   * protected request; browser supplied actor, role, or case values never
   * become authoritative.
   */
  private async verifyClientSession(
    token: string,
    claimedActorId?: string,
  ): Promise<VerifiedIdentity | null> {
    let claims: {
      token_use?: unknown;
      sub?: unknown;
      organization_id?: unknown;
      case_id?: unknown;
      role?: unknown;
    };
    try {
      claims = await this.jwt.verifyAsync(token, { algorithms: ['HS256'] });
    } catch {
      return null;
    }
    if (
      claims.token_use !== 'vineford_client_portal' ||
      typeof claims.sub !== 'string' ||
      typeof claims.organization_id !== 'string' ||
      typeof claims.case_id !== 'string' ||
      claims.role !== 'client'
    ) {
      throw new UnauthorizedException('invalid client portal session');
    }
    if (claimedActorId && claimedActorId !== claims.sub)
      throw new UnauthorizedException('actor identity mismatch');
    const rows = await this.dataSource.query<
      Array<{ actor_id: string; organization_id: string; case_id: string }>
    >(
      `SELECT u.id AS actor_id, c.organization_id, c.id AS case_id
       FROM public.app_users u
       JOIN public.clients cl ON lower(cl.email) = lower(u.email)
       JOIN public.cases c ON c.client_id = cl.id
       LEFT JOIN public.client_case_access a ON a.case_id = c.id
       WHERE u.id = $1 AND u.role = 'client' AND u.is_active = true
         AND c.id = $2 AND c.organization_id = $3
         AND c.status = 'open' AND a.enabled = true`,
      [claims.sub, claims.case_id, claims.organization_id],
    );
    if (rows.length !== 1)
      throw new UnauthorizedException('client session is no longer authorized');
    return {
      actorId: rows[0].actor_id,
      organizationId: rows[0].organization_id,
      role: 'client',
      supabaseUserId: '',
      caseId: rows[0].case_id,
    };
  }
}
