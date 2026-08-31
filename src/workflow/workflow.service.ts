import { InjectDataSource } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AdvancePhaseDto } from './dto/advance-phase.dto';
import { CreateClientActionDto } from './dto/create-client-action.dto';
import { IssueHandoffDto } from './dto/issue-handoff.dto';
import { VerifyHandoffDto } from './dto/verify-handoff.dto';
import { SetLegalHoldDto } from './dto/set-legal-hold.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationCenterService } from '../notification-center/notification-center.service';
import type { VerifiedIdentity } from '../identity/supabase-identity.service';

type JsonResult = Record<string, unknown> | null;

interface FunctionCallRow {
  result: JsonResult;
}

function firstResult(rows: FunctionCallRow[]): JsonResult {
  return rows[0]?.result ?? null;
}

export type WorkflowView = 'admin' | 'client';

export interface HandoffClaims {
  sub?: string;
  grant_id: string;
  case_id: string;
  case_number?: string;
  organization_id?: string;
  action_id?: string;
  purpose?: string;
  approved_at?: string | null;
  unlocked_at?: string | null;
  sandbox?: boolean;
}

export interface Phase6GrantResult {
  grant_id: string;
  case_id: string;
  case_number?: string | null;
  organization_id?: string | null;
  action_id?: string | null;
  approved_at?: string | null;
  unlocked_at?: string | null;
  expires_at?: string | null;
  status?: string;
  sandbox?: boolean;
  simulated?: boolean;
  disclaimer?: string;
  [key: string]: unknown;
}

/**
 * Default SLA (hours) applied per workflow phase when a case does not
 * configure its own phase_sla_hours. 'completed' is terminal (no deadline).
 */
const PHASE_SLA_HOURS: Record<string, number> = {
  transfer_preparation: 168,
  receiving_bank_review: 120,
  verification_documents_requested: 168,
  documents_under_review: 120,
  documents_verified: 72,
  next_client_action: 336,
  bank_acceptance_verification: 120,
  document_verification: 72,
  case_review: 168,
  completed: 0,
};

@Injectable()
export class WorkflowService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly auditLogsService: AuditLogsService,
    private readonly notificationCenterService: NotificationCenterService,
  ) {}

  slaHoursForPhase(phase: string): number {
    return PHASE_SLA_HOURS[phase] ?? 168;
  }

  private async loadCaseMeta(
    caseId: string,
  ): Promise<Record<string, unknown> | null> {
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT organization_id, legal_hold, legal_hold_note, phase_sla_hours,
              phase_deadline, phase_deadline_notified_at, workflow_updated_at,
              EXISTS(SELECT 1 FROM public.case_payments cp WHERE cp.case_id=cases.id AND cp.gate_enabled=true AND cp.blocks_progress=true AND cp.status<>'waived' AND NOT(cp.status IN ('paid','received') AND EXISTS(SELECT 1 FROM public.payments p WHERE p.invoice_id=cp.invoice_id))) AS payment_progress_blocked
         FROM public.cases WHERE id = $1`,
      [caseId],
    );
    return rows[0] ?? null;
  }

  private assertPaymentProgress(meta: Record<string, unknown> | null): void {
    if (meta?.payment_progress_blocked)
      throw new ConflictException(
        'payment requirement must be paid or waived before the next stage',
      );
  }

  private mergeCaseMeta(
    result: JsonResult,
    meta: Record<string, unknown> | null,
  ): JsonResult {
    if (!result || !meta) {
      return result;
    }
    if (meta.legal_hold !== undefined) {
      result.legal_hold = Boolean(meta.legal_hold);
    }
    if (meta.legal_hold_note !== undefined && meta.legal_hold_note !== null) {
      result.legal_hold_note = meta.legal_hold_note;
    }
    if (meta.phase_sla_hours !== undefined && meta.phase_sla_hours !== null) {
      result.phase_sla_hours = meta.phase_sla_hours;
    }
    if (meta.phase_deadline !== undefined && meta.phase_deadline !== null) {
      const deadline = new Date(String(meta.phase_deadline)).getTime();
      result.phase_deadline = String(meta.phase_deadline);
      result.phase_overdue = deadline < Date.now();
      result.phase_days_remaining = Math.max(
        0,
        Math.ceil((deadline - Date.now()) / 86400000),
      );
    }
    return result;
  }

  async getCaseWorkflow(
    caseId: string,
    view: WorkflowView = 'admin',
    actorId?: string,
  ): Promise<JsonResult> {
    await this.assertClientViewAccess(caseId, view, actorId);
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_get_case_workflow($1,$2) AS result`,
      [caseId, view ?? 'admin'],
    );
    const result = firstResult(rows);

    if (actorId) {
      const meta = await this.loadCaseMeta(caseId);
      const merged = this.mergeCaseMeta(result, meta);
      if (meta?.organization_id) {
        await this.auditLogsService.create({
          organizationId: String(meta.organization_id),
          userId: actorId,
          action: `case.view.${view ?? 'admin'}`,
          resourceType: 'case',
          resourceId: caseId,
          caseId,
        });
      }
      return merged;
    }

    return result;
  }

  async getCaseTimeline(
    caseId: string,
    view: WorkflowView = 'admin',
    actorId?: string,
  ): Promise<JsonResult> {
    await this.assertClientViewAccess(caseId, view, actorId);
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_get_case_timeline($1,$2) AS result`,
      [caseId, view ?? 'admin'],
    );
    return firstResult(rows);
  }

  /**
   * Read access is bound to the caller's role and case authorization.
   * - view=client: the actor must be an administrator or the case's own
   *   authorized client (vf_actor_can_access_case); otherwise changing the
   *   case identifier in the URL cannot reach another client's case.
   * - view=admin: the actor must be an internal role — a client session must
   *   never be able to request the unfiltered admin view.
   */
  private async assertClientViewAccess(
    caseId: string,
    view: WorkflowView,
    actorId?: string,
  ): Promise<void> {
    if (!actorId) {
      return;
    }

    if (view === 'admin') {
      const rows = await this.dataSource.query<Array<{ allowed: boolean }>>(
        `SELECT EXISTS (
           SELECT 1
             FROM public.app_users u
             JOIN public.organization_memberships m
               ON m.app_user_id = u.id
              AND m.organization_id = u.organization_id
              AND m.status = 'active'
             JOIN public.cases c ON c.organization_id = m.organization_id
            WHERE u.id = $1
              AND c.id = $2
              AND u.is_active = true
              AND u.role::text = m.role
              AND u.role <> 'client'
         ) AS allowed`,
        [actorId, caseId],
      );
      if (!rows[0]?.allowed) {
        throw new UnauthorizedException(
          'permission denied: actor is not authorized for the admin case view',
        );
      }
      return;
    }

    if (view !== 'client') {
      return;
    }

    const rows = await this.dataSource.query<Array<{ allowed: boolean }>>(
      `SELECT public.vf_actor_can_access_case($1,$2) AS allowed`,
      [actorId, caseId],
    );
    if (!rows[0]?.allowed) {
      throw new UnauthorizedException(
        'permission denied: actor is not authorized for case',
      );
    }
  }

  async getCaseHistory(caseId: string): Promise<JsonResult> {
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_get_case_history($1) AS result`,
      [caseId],
    );
    return firstResult(rows);
  }

  async advancePhase(
    caseId: string,
    actorId: string,
    dto: AdvancePhaseDto,
  ): Promise<JsonResult> {
    const meta = await this.loadCaseMeta(caseId);
    this.assertPaymentProgress(meta);
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_advance_case_phase($1,$2,$3) AS result`,
      [caseId, this.actor(actorId), dto?.note ?? null],
    );
    const result = firstResult(rows);
    const newPhase = result?.workflow_phase as string | undefined;

    if (newPhase) {
      const hours = Number(
        meta?.phase_sla_hours ?? this.slaHoursForPhase(newPhase),
      );
      if (hours > 0) {
        await this.dataSource.query(
          `UPDATE public.cases
              SET phase_deadline = now() + make_interval(hours => $2),
                  phase_deadline_notified_at = NULL
            WHERE id = $1`,
          [caseId, hours],
        );
      }
    }

    if (meta?.organization_id) {
      await this.notificationCenterService.create({
        caseId,
        organizationId: String(meta.organization_id),
        recipientRole: 'client',
        title: 'Case phase updated',
        body: newPhase
          ? `Your case moved to the next workflow phase.`
          : 'Your case workflow was updated.',
      });
      await this.auditLogsService.create({
        organizationId: String(meta.organization_id),
        userId: this.actor(actorId),
        action: 'workflow.advance',
        resourceType: 'case',
        resourceId: caseId,
        caseId,
        changes: { phase: newPhase ?? null, note: dto?.note ?? null },
      });
    }
    return result;
  }

  async completeReview(caseId: string, actorId: string): Promise<JsonResult> {
    const meta = await this.loadCaseMeta(caseId);
    this.assertPaymentProgress(meta);
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_complete_case_review($1,$2) AS result`,
      [caseId, this.actor(actorId)],
    );
    const result = firstResult(rows);
    if (meta?.organization_id) {
      await this.auditLogsService.create({
        organizationId: String(meta.organization_id),
        userId: this.actor(actorId),
        action: 'workflow.review_complete',
        resourceType: 'case',
        resourceId: caseId,
        caseId,
      });
    }
    return result;
  }

  async createClientAction(
    caseId: string,
    actorId: string,
    dto: CreateClientActionDto,
  ): Promise<JsonResult> {
    const orgRows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT organization_id,EXISTS(SELECT 1 FROM public.case_payments cp WHERE cp.case_id=cases.id AND cp.gate_enabled=true AND cp.blocks_progress=true AND cp.status<>'waived' AND NOT(cp.status IN ('paid','received') AND EXISTS(SELECT 1 FROM public.payments p WHERE p.invoice_id=cp.invoice_id))) AS payment_progress_blocked FROM public.cases WHERE id = $1`,
      [caseId],
    );
    const organizationId = (orgRows[0]?.organization_id as string) ?? null;
    this.assertPaymentProgress(orgRows[0] ?? null);

    let rows: FunctionCallRow[];
    try {
      rows = await this.dataSource.query<FunctionCallRow[]>(
        `SELECT public.vf_create_next_client_action($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result`,
        [
          caseId,
          organizationId,
          this.actor(actorId),
          dto.title,
          dto.description ?? null,
          dto.action_url ?? null,
          dto.action_label ?? null,
          dto.expires_at ? new Date(dto.expires_at) : null,
          dto.is_client_visible ?? true,
          dto.active ?? true,
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (
        message.includes('active verification requirement(s) are not VERIFIED')
      ) {
        throw new ConflictException(
          'active verification requirements must be verified before creating a client action',
        );
      }
      if (message.includes('required verification (phase 5) is not complete')) {
        throw new ConflictException(
          'required verification (phase 5) must be complete before creating a client action',
        );
      }
      throw error;
    }
    const result = firstResult(rows);
    if (organizationId) {
      await this.auditLogsService.create({
        organizationId,
        userId: this.actor(actorId),
        action: 'workflow.client_action_created',
        resourceType: 'case_client_action',
        resourceId: (result?.id as string) ?? caseId,
        caseId,
        changes: { title: dto.title },
      });
    }
    return result;
  }

  async findClientActions(
    caseId: string,
  ): Promise<Array<Record<string, unknown>>> {
    return this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT * FROM public.case_client_actions WHERE case_id = $1 ORDER BY activated_at ASC`,
      [caseId],
    );
  }

  async findClientAction(id: string): Promise<Record<string, unknown> | null> {
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT * FROM public.case_client_actions WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async getClientAcceptance(
    actionId: string,
    identity: VerifiedIdentity,
  ): Promise<JsonResult> {
    this.assertClientIdentity(identity);
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_get_client_acceptance($1,$2,$3,$4) AS result`,
      [actionId, identity.actorId, identity.organizationId, identity.caseId],
    );
    if (!rows[0]?.result)
      throw new NotFoundException('acceptance action not found');
    return firstResult(rows);
  }

  async submitClientAcceptance(
    actionId: string,
    identity: VerifiedIdentity,
    body: { acknowledged?: boolean; acknowledgement_version?: string },
  ): Promise<JsonResult> {
    this.assertClientIdentity(identity);
    if (body?.acknowledged !== true) {
      throw new BadRequestException(
        'explicit acceptance acknowledgement is required',
      );
    }
    if (body?.acknowledgement_version !== 'client_acceptance_v1') {
      throw new BadRequestException(
        'unsupported acceptance acknowledgement version',
      );
    }
    try {
      const rows = await this.dataSource.query<FunctionCallRow[]>(
        `SELECT public.vf_submit_client_acceptance($1,$2,$3,$4,$5) AS result`,
        [
          actionId,
          identity.actorId,
          identity.organizationId,
          identity.caseId,
          body.acknowledgement_version,
        ],
      );
      return firstResult(rows);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'acceptance submission failed';
      if (message.includes('permission denied'))
        throw new ForbiddenException(message);
      if (message.includes('not found')) throw new NotFoundException(message);
      if (message.includes('already belongs'))
        throw new ConflictException(message);
      throw new BadRequestException(message);
    }
  }

  private assertClientIdentity(identity: VerifiedIdentity): void {
    if (identity.role !== 'client' || !identity.caseId) {
      throw new ForbiddenException(
        'only the authenticated case client may submit acceptance',
      );
    }
  }

  async getPhase6HandoffStatus(
    caseId: string,
    view: WorkflowView = 'admin',
    actorId?: string,
  ): Promise<JsonResult> {
    await this.assertClientViewAccess(caseId, view, actorId);
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_get_phase6_handoff_status($1,$2) AS result`,
      [caseId, view ?? 'admin'],
    );
    return firstResult(rows);
  }

  async issuePhase6Handoff(
    caseId: string,
    actorId: string,
    dto: IssueHandoffDto,
  ): Promise<JsonResult> {
    const issueRows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_issue_phase6_handoff($1,$2,$3) AS result`,
      [caseId, this.actor(actorId), dto?.action_id ?? null],
    );
    const grant = firstResult(issueRows) as Phase6GrantResult | null;
    if (!grant?.grant_id) {
      return grant;
    }

    const grantId = grant.grant_id;
    const expiresAt = grant.expires_at
      ? new Date(grant.expires_at)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const ttlSeconds = Math.max(
      60,
      Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    );

    const claims: HandoffClaims = {
      sub: this.actor(actorId),
      grant_id: grantId,
      case_id: grant.case_id,
      case_number: grant.case_number ?? undefined,
      organization_id: grant.organization_id ?? undefined,
      action_id: grant.action_id ?? undefined,
      purpose: 'phase6_handoff',
      approved_at: grant.approved_at ?? null,
      unlocked_at: grant.unlocked_at ?? null,
      sandbox: true,
    };
    const token = this.jwtService.sign(claims, {
      expiresIn: ttlSeconds,
    });

    await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_store_phase6_handoff_token($1,$2) AS result`,
      [grantId, token],
    );

    if (grant.organization_id) {
      await this.auditLogsService.create({
        organizationId: grant.organization_id,
        userId: this.actor(actorId),
        action: 'workflow.handoff_issued',
        resourceType: 'case_handoff_grant',
        resourceId: grantId,
        caseId: grant.case_id,
      });
    }

    return {
      ...grant,
      token,
    };
  }

  async verifyPhase6Handoff(
    dto: VerifyHandoffDto,
    actorId?: string,
  ): Promise<JsonResult> {
    let claims: HandoffClaims;
    try {
      claims = this.jwtService.verify<HandoffClaims>(dto.token);
    } catch {
      throw new UnauthorizedException(
        'phase 6 handoff token is invalid or expired',
      );
    }
    if (!claims.grant_id) {
      throw new UnauthorizedException(
        'phase 6 handoff token is missing a grant reference',
      );
    }
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_verify_phase6_handoff($1,$2,$3) AS result`,
      [claims.grant_id, dto.token, actorId ?? null],
    );
    return firstResult(rows);
  }

  async revokePhase6Handoff(
    grantId: string,
    actorId: string,
    note?: string,
  ): Promise<JsonResult> {
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.vf_revoke_phase6_handoff($1,$2,$3) AS result`,
      [grantId, this.actor(actorId), note ?? null],
    );
    const result = firstResult(rows) as Phase6GrantResult | null;
    if (result?.organization_id) {
      await this.auditLogsService.create({
        organizationId: result.organization_id,
        userId: this.actor(actorId),
        action: 'workflow.handoff_revoked',
        resourceType: 'case_handoff_grant',
        resourceId: grantId,
        caseId: result.case_id,
        changes: { note: note ?? null },
      });
    }
    return result;
  }

  /**
   * Place or lift a legal hold on a case (administrators only). The hold is
   * additive state that freezes further action-taking without altering the
   * underlying workflow phase, and is recorded in the audit trail.
   */
  async setLegalHold(
    caseId: string,
    actorId: string,
    dto: SetLegalHoldDto,
  ): Promise<JsonResult> {
    const actorRows = await this.dataSource.query<
      Array<{ role: string | null }>
    >(`SELECT role FROM public.app_users WHERE id = $1`, [actorId]);
    if (!actorRows[0]?.role || actorRows[0].role === 'client') {
      throw new UnauthorizedException(
        'permission denied: administrator access required',
      );
    }

    const meta = await this.loadCaseMeta(caseId);
    await this.dataSource.query(
      `UPDATE public.cases
          SET legal_hold = $1,
              legal_hold_note = $2,
              updated_at = now()
        WHERE id = $3`,
      [dto.enabled, dto.note?.trim() || null, caseId],
    );

    if (meta?.organization_id) {
      await this.auditLogsService.create({
        organizationId: String(meta.organization_id),
        userId: this.actor(actorId),
        action: dto.enabled
          ? 'case.legal_hold_placed'
          : 'case.legal_hold_lifted',
        resourceType: 'case',
        resourceId: caseId,
        caseId,
        changes: { legal_hold: dto.enabled, note: dto.note ?? null },
      });
      await this.notificationCenterService.create({
        caseId,
        organizationId: String(meta.organization_id),
        recipientRole: 'client',
        title: dto.enabled
          ? 'Your case is under legal hold'
          : 'Legal hold lifted',
        body: dto.enabled
          ? 'Vineford has placed your case under a temporary legal hold; no further action will be taken while it is active.'
          : 'The legal hold on your case has been lifted.',
      });
    }

    return { legal_hold: Boolean(dto.enabled), note: dto.note?.trim() || null };
  }

  private actor(actorId?: string): string {
    if (
      !actorId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        actorId,
      )
    )
      throw new UnauthorizedException('verified actor identity required');
    return actorId;
  }
}
