/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-base-to-string, @typescript-eslint/restrict-template-expressions */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { UpdateCaseProgressDto } from './dto/update-case-progress.dto';
import { ClientPortalAccessGateService } from '../client-portal-access-gate/client-portal-access-gate.service';

type Row = Record<string, unknown>;
const STAFF_ROLES = ['super_admin', 'admin', 'investigator', 'staff'];
const STEPS = [
  'Evidence Review',
  'Client Document Verification',
  'Transfer Authorization Review',
  'Forensic Analysis',
  'Investigator Review',
  'Final Assessment',
  'Case Closure Review',
];

@Injectable()
export class CaseProgressService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Optional()
    private readonly clientAccessGate?: ClientPortalAccessGateService,
  ) {}
  private async resolve(
    caseKey: string,
    identity: VerifiedIdentity,
    manager: DataSource | EntityManager = this.db,
  ) {
    const rows = await manager.query(
      `SELECT c.*,clock_timestamp() server_time,u.name lead_user_name,u.email lead_user_email,u.role::text lead_user_role,i.name legacy_investigator_name,i.title legacy_investigator_title,i.email legacy_investigator_email,i.specialization legacy_investigator_specialization FROM public.cases c LEFT JOIN public.app_users u ON u.id=c.lead_investigator_user_id LEFT JOIN public.investigators i ON i.id=c.assigned_investigator_id AND i.organization_id=c.organization_id WHERE (c.id::text=$1 OR upper(c.case_number)=upper($1)) AND c.organization_id=$2`,
      [caseKey.trim(), identity.organizationId],
    );
    if (!rows[0]) throw new NotFoundException('case not found');
    if (identity.role === 'client' && rows[0].id !== identity.caseId)
      throw new ForbiddenException('case access denied');
    return rows[0] as Row;
  }
  private async canEdit(
    caseId: string,
    identity: VerifiedIdentity,
    manager: EntityManager,
  ) {
    if (['admin', 'super_admin'].includes(identity.role)) return;
    if (identity.role !== 'investigator')
      throw new ForbiddenException(
        'case progress control requires an authorized administrator or investigator',
      );
    const rows = await manager.query(
      `SELECT 1 FROM public.organization_memberships m JOIN public.case_assignments a ON a.app_user_id=m.app_user_id AND a.organization_id=m.organization_id WHERE m.app_user_id=$1 AND m.organization_id=$2 AND m.status='active' AND a.case_id=$3 AND a.active=true AND a.assignment_role IN ('owner','investigator')`,
      [identity.actorId, identity.organizationId, caseId],
    );
    if (!rows[0])
      throw new ForbiddenException(
        'investigator is not actively assigned to this case',
      );
  }
  private paymentStatus(row: Row | undefined) {
    if (!row) return 'NOT_REQUIRED';
    if (['paid', 'received'].includes(String(row.status)))
      return row.has_authoritative_payment
        ? 'PAID'
        : row.gate_enabled
          ? 'REQUIRED'
          : 'NOT_REQUIRED';
    return String(row.status ?? 'not_required').toUpperCase();
  }
  private async state(
    caseRow: Row,
    identity: VerifiedIdentity,
    manager: DataSource | EntityManager = this.db,
  ) {
    const payment = (
      await manager.query(
        `SELECT cp.*,EXISTS(SELECT 1 FROM public.payments p JOIN public.invoices i ON i.id=p.invoice_id AND i.organization_id=p.organization_id WHERE p.invoice_id=cp.invoice_id AND p.organization_id=cp.organization_id AND p.verification_status='verified' AND p.amount=cp.amount AND i.case_id=cp.case_id AND i.amount=cp.amount) has_authoritative_payment FROM public.case_payments cp WHERE cp.case_id=$1 AND cp.organization_id=$2`,
        [caseRow.id, identity.organizationId],
      )
    )[0] as Row | undefined;
    const supporting = (
      await manager.query(
        `SELECT supporting_verification_required,accepted_document_type FROM public.transaction_authorization_reviews WHERE case_id=$1 AND organization_id=$2`,
        [caseRow.id, identity.organizationId],
      )
    )[0] as Row | undefined;
    const status = this.paymentStatus(payment);
    const clientPortalAccess = this.clientAccessGate
      ? await this.clientAccessGate.state(
          String(caseRow.id),
          identity.organizationId,
        )
      : {
          configured: false,
          locked: false,
          supporting_verification_status: 'NOT_REQUIRED',
          specific_payment_requirement_status: 'NOT_REQUIRED',
        };
    const blocked = Boolean(
      payment?.gate_enabled &&
      payment?.blocks_progress &&
      !['PAID', 'WAIVED'].includes(status),
    );
    const hasLeadUser = Boolean(caseRow.lead_investigator_user_id),
      hasLegacy = Boolean(caseRow.assigned_investigator_id);
    const result: Row = {
      case_id: caseRow.id,
      case_number: caseRow.case_number,
      status: caseRow.status,
      title: caseRow.title,
      priority: null,
      category: null,
      created_at: caseRow.created_at,
      updated_at: caseRow.updated_at,
      server_time: caseRow.server_time,
      investigation_progress_percent: Number(
        caseRow.investigation_progress_percent ?? 0,
      ),
      lead_investigator_user_id: caseRow.lead_investigator_user_id ?? null,
      lead_investigator_selection: hasLeadUser
        ? `user:${caseRow.lead_investigator_user_id}`
        : hasLegacy
          ? `investigator:${caseRow.assigned_investigator_id}`
          : null,
      lead_investigator_name: hasLeadUser
        ? (caseRow.lead_user_name ?? null)
        : (caseRow.legacy_investigator_name ?? null),
      lead_investigator_title: hasLeadUser
        ? (caseRow.lead_user_role ?? null)
        : (caseRow.legacy_investigator_title ?? null),
      lead_investigator_email: hasLeadUser
        ? (caseRow.lead_user_email ?? null)
        : (caseRow.legacy_investigator_email ?? null),
      lead_investigator_specialization: hasLeadUser
        ? null
        : (caseRow.legacy_investigator_specialization ?? null),
      lead_investigator_source: hasLeadUser
        ? 'organization_user'
        : hasLegacy
          ? 'investigator_directory'
          : null,
      estimated_next_step: caseRow.estimated_next_step ?? null,
      client_portal_access: clientPortalAccess,
      payment_gate: {
        enabled: Boolean(payment?.gate_enabled),
        enabled_at: payment?.gate_enabled
          ? (payment.enabled_at ?? payment.created_at ?? null)
          : null,
        title: payment?.payment_title ?? null,
        description: payment?.payment_description ?? null,
        amount: payment?.amount === undefined ? null : Number(payment.amount),
        currency: payment?.currency ?? 'USD',
        blocks_progress: Boolean(payment?.blocks_progress),
        status,
        progress_blocked: blocked,
        supporting_verification_required: supporting
          ? Boolean(supporting.supporting_verification_required)
          : true,
        accepted_document:
          supporting?.accepted_document_type ?? 'DIVORCE_DOCUMENT',
      },
    };
    if (identity.role !== 'client') {
      result.allowed_next_steps = STEPS;
      result.lead_investigator_options = await manager.query(
        `SELECT 'user:'||u.id::text value,u.name,u.role::text title,u.email,NULL::text specialization,'organization_user' source FROM public.app_users u JOIN public.organization_memberships m ON m.app_user_id=u.id AND m.organization_id=u.organization_id WHERE u.organization_id=$1 AND u.is_active=true AND m.status='active' AND u.role::text=ANY($2::text[]) UNION ALL SELECT 'investigator:'||i.id::text value,i.name,i.title,i.email,i.specialization,'investigator_directory' source FROM public.investigators i WHERE i.organization_id=$1 ORDER BY name`,
        [identity.organizationId, STAFF_ROLES],
      );
    }
    return result;
  }
  async get(caseKey: string, identity: VerifiedIdentity) {
    return this.state(await this.resolve(caseKey, identity), identity);
  }
  async clientWorkspace(
    caseKey: string,
    module: string,
    identity: VerifiedIdentity,
  ) {
    if (identity.role !== 'client')
      throw new ForbiddenException('client portal session required');
    const caseRow = await this.resolve(caseKey, identity),
      caseId = String(caseRow.id),
      organizationId = identity.organizationId;
    const q = (sql: string) => this.db.query(sql, [caseId, organizationId]);
    switch (module) {
      case 'timeline':
        return {
          records: await q(
            `SELECT id,title,description,event_date,phase,status,created_at FROM public.timeline WHERE case_id=$1 AND organization_id=$2 AND is_client_visible=true ORDER BY event_date DESC NULLS LAST,created_at DESC`,
          ),
        };
      case 'documents':
        return {
          records: await q(
            `SELECT id,title,description,document_type,file_url,file_name,file_size,document_status,uploaded_at,created_at FROM public.documents WHERE case_id=$1 AND organization_id=$2 AND is_client_visible=true ORDER BY created_at DESC`,
          ),
        };
      case 'messages':
        return {
          records: await q(
            `SELECT m.id,m.content,m.created_at,m.updated_at,u.name sender_name,u.role::text sender_role FROM public.messages m LEFT JOIN public.app_users u ON u.id=m.sender_id WHERE m.case_id=$1 AND m.organization_id=$2 ORDER BY m.created_at ASC`,
          ),
        };
      case 'invoices':
        return {
          records: await q(
            `SELECT id,invoice_number,amount,status,due_date,created_at,updated_at FROM public.invoices WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
          ),
        };
      case 'payments':
        return {
          records: await q(
            `SELECT p.id,p.reference_number,p.amount,p.payment_method,p.created_at,p.updated_at,i.invoice_number FROM public.payments p JOIN public.invoices i ON i.id=p.invoice_id WHERE i.case_id=$1 AND p.organization_id=$2 ORDER BY p.created_at DESC`,
          ),
        };
      case 'treasury': {
        const settings = await this.db.query(
          `SELECT COALESCE(bool_or(setting_key IN ('features.walletConnectionsEnabled','features.treasuryFundingEnabled') AND setting_value::text IN ('true','"true"')),false) treasury_enabled,max(enabled_at) FILTER(WHERE setting_key IN ('features.walletConnectionsEnabled','features.treasuryFundingEnabled')) enabled_at,clock_timestamp() server_time FROM public.organization_settings WHERE organization_id=$1 AND setting_key IN ('features.walletConnectionsEnabled','features.treasuryFundingEnabled')`,
          [organizationId],
        );
        if (!settings[0]?.treasury_enabled)
          return {
            available: false,
            enabled_at: null,
            server_time: settings[0]?.server_time,
            records: [],
          };
        const [accounts, ledger, funding] = await Promise.all([
          q(
            `SELECT a.id,a.account_reference AS account_type,a.currency,a.status,a.created_at,COALESCE(SUM(CASE WHEN e.entry_type IN ('credit','adjustment') THEN e.amount WHEN e.entry_type IN ('debit','release','allocation') THEN -e.amount ELSE 0 END),0) derived_balance,COALESCE((SELECT SUM(w.amount) FROM public.treasury_chain_withdrawals w WHERE w.treasury_account_id=a.id AND w.status IN ('approved','execution_pending','broadcast','confirming')),0) reserved_funds FROM public.treasury_accounts a LEFT JOIN public.treasury_ledger_entries e ON e.treasury_account_id=a.id WHERE a.case_id=$1 AND a.organization_id=$2 GROUP BY a.id ORDER BY a.created_at DESC`,
          ),
          q(
            `SELECT id,entry_type,amount,currency,NULL::text AS status,created_at FROM public.treasury_ledger_entries WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
          ),
          q(
            `SELECT f.id,f.funding_type,f.funding_effect,f.amount,f.currency,f.status,f.funding_date,f.verified_at,f.created_at FROM public.treasury_funding_allocations f JOIN public.cases c ON c.id=f.case_id AND c.organization_id=f.organization_id AND c.client_id=f.client_id WHERE f.case_id=$1 AND f.organization_id=$2 ORDER BY f.created_at DESC`,
          ),
        ]);
        return {
          available: true,
          enabled_at: settings[0]?.enabled_at,
          server_time: settings[0]?.server_time,
          accounts,
          ledger,
          funding,
        };
      }
      default:
        throw new BadRequestException('unknown client workspace module');
    }
  }
  async assertProgressAllowed(caseId: string) {
    const rows = await this.db.query(
      `SELECT cp.status,cp.gate_enabled,cp.blocks_progress,EXISTS(SELECT 1 FROM public.payments p JOIN public.invoices i ON i.id=p.invoice_id AND i.organization_id=p.organization_id WHERE p.invoice_id=cp.invoice_id AND p.organization_id=cp.organization_id AND p.verification_status='verified' AND p.amount=cp.amount AND i.case_id=cp.case_id AND i.amount=cp.amount) has_authoritative_payment FROM public.case_payments cp WHERE cp.case_id=$1`,
      [caseId],
    );
    const status = this.paymentStatus(rows[0]);
    if (
      rows[0]?.gate_enabled &&
      rows[0]?.blocks_progress &&
      !['PAID', 'WAIVED'].includes(status)
    )
      throw new ConflictException(
        'payment requirement must be paid or waived before the next stage',
      );
  }
  async update(
    caseKey: string,
    dto: UpdateCaseProgressDto,
    identity: VerifiedIdentity,
  ) {
    if (
      dto.investigation_progress_percent !== undefined &&
      (!Number.isInteger(dto.investigation_progress_percent) ||
        dto.investigation_progress_percent < 0 ||
        dto.investigation_progress_percent > 100)
    )
      throw new BadRequestException(
        'investigation progress must be an integer from 0 to 100',
      );
    if (
      dto.payment_gate_currency !== undefined &&
      !/^[A-Za-z]{3}$/.test(dto.payment_gate_currency)
    )
      throw new BadRequestException(
        'payment currency must be a three-letter code',
      );
    if (
      dto.payment_gate_enabled === true &&
      (!dto.payment_gate_title?.trim() ||
        !dto.payment_gate_amount ||
        dto.payment_gate_amount <= 0)
    )
      throw new BadRequestException(
        'an enabled payment gate requires a title and positive amount',
      );
    if (
      dto.supporting_verification_required === true &&
      (dto.payment_gate_enabled !== true ||
        dto.payment_gate_blocks_progress !== true ||
        dto.payment_gate_title?.trim() !==
          'Transaction Authorization Review Fee' ||
        dto.payment_gate_amount !== 50 ||
        dto.payment_gate_currency?.toUpperCase() !== 'USD')
    )
      throw new BadRequestException(
        'supporting verification requires an enabled, blocking $50 USD Transaction Authorization Review Fee gate',
      );
    return this.db.transaction(async (manager) => {
      const current = await this.resolve(caseKey, identity, manager);
      await this.canEdit(String(current.id), identity, manager);
      if (
        (dto.supporting_verification_required !== undefined ||
          dto.accepted_supporting_document !== undefined) &&
        !['admin', 'super_admin'].includes(identity.role)
      )
        throw new ForbiddenException(
          'supporting verification configuration requires an administrator',
        );
      if (dto.payment_gate_status === 'PAID')
        throw new BadRequestException(
          'PAID is derived only from an authoritative recorded invoice payment',
        );
      const leadTouched =
        dto.lead_investigator_selection !== undefined ||
        dto.lead_investigator_user_id !== undefined;
      let leadUserId = dto.lead_investigator_user_id ?? null,
        legacyInvestigatorId: string | null = null,
        legacyTouched = false;
      if (dto.lead_investigator_selection !== undefined) {
        const selection = dto.lead_investigator_selection?.trim() || null;
        if (selection) {
          const [source, id, ...extra] = selection.split(':');
          if (extra.length || !id || !['user', 'investigator'].includes(source))
            throw new BadRequestException(
              'invalid lead investigator selection',
            );
          if (source === 'user') leadUserId = id;
          else {
            legacyInvestigatorId = id;
            legacyTouched = true;
            leadUserId = null;
          }
        } else leadUserId = null;
      }
      if (leadTouched && leadUserId) {
        const staff = await manager.query(
          `SELECT u.id,u.name FROM public.app_users u JOIN public.organization_memberships m ON m.app_user_id=u.id AND m.organization_id=u.organization_id WHERE u.id=$1 AND u.organization_id=$2 AND u.is_active=true AND m.status='active' AND u.role::text=ANY($3::text[])`,
          [leadUserId, identity.organizationId, STAFF_ROLES],
        );
        if (!staff[0])
          throw new BadRequestException(
            'lead investigator must be an active authorized organization member',
          );
      }
      if (legacyTouched) {
        const staff = await manager.query(
          `SELECT id,name FROM public.investigators WHERE id=$1 AND organization_id=$2`,
          [legacyInvestigatorId, identity.organizationId],
        );
        if (!staff[0])
          throw new BadRequestException(
            'lead investigator must belong to the case organization',
          );
      }
      const nextStep =
        dto.estimated_next_step === undefined
          ? current.estimated_next_step
          : dto.estimated_next_step?.trim() || null;
      const updated = (
        await manager.query(
          `UPDATE public.cases SET investigation_progress_percent=COALESCE($3,investigation_progress_percent),lead_investigator_user_id=CASE WHEN $4 THEN $5::uuid ELSE lead_investigator_user_id END,assigned_investigator_id=CASE WHEN $6 THEN $7::uuid ELSE assigned_investigator_id END,estimated_next_step=CASE WHEN $8 THEN $9 ELSE estimated_next_step END,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *`,
          [
            current.id,
            identity.organizationId,
            dto.investigation_progress_percent ?? null,
            leadTouched,
            leadUserId,
            legacyTouched,
            legacyInvestigatorId,
            dto.estimated_next_step !== undefined,
            nextStep,
          ],
        )
      )[0];
      const gateTouched = [
        'payment_gate_enabled',
        'payment_gate_title',
        'payment_gate_description',
        'payment_gate_amount',
        'payment_gate_currency',
        'payment_gate_blocks_progress',
        'payment_gate_status',
        'supporting_verification_required',
        'accepted_supporting_document',
      ].some((k) => (dto as unknown as Row)[k] !== undefined);
      const previousPayment = gateTouched
        ? ((
            await manager.query(
              `SELECT gate_enabled,payment_title,payment_description,amount,currency,blocks_progress,status FROM public.case_payments WHERE case_id=$1 AND organization_id=$2`,
              [current.id, identity.organizationId],
            )
          )[0] ?? null)
        : null;
      if (gateTouched) {
        const requirementChanged = Boolean(
          previousPayment &&
          ((dto.payment_gate_title !== undefined &&
            (dto.payment_gate_title?.trim() || null) !==
              (previousPayment.payment_title ?? null)) ||
            (dto.payment_gate_amount !== undefined &&
              dto.payment_gate_amount !== Number(previousPayment.amount)) ||
            (dto.payment_gate_currency !== undefined &&
              dto.payment_gate_currency.toUpperCase() !==
                previousPayment.currency)),
        );
        const status =
          (requirementChanged
            ? 'required'
            : dto.payment_gate_status?.toLowerCase()) ??
          (dto.payment_gate_enabled === false ? 'not_required' : null);
        await manager.query(
          `INSERT INTO public.case_payments(case_id,organization_id,client_id,status,amount,currency,client_visible,created_by,updated_by,gate_enabled,payment_title,payment_description,blocks_progress,enabled_at) VALUES($1,$2,$3,COALESCE($4,CASE WHEN $8 THEN 'required' ELSE 'not_required' END),$5,COALESCE($6,'USD'),true,$7,$7,COALESCE($8,false),$9,$10,COALESCE($11,false),CASE WHEN $8 THEN clock_timestamp() ELSE NULL END) ON CONFLICT(case_id) DO UPDATE SET status=COALESCE($4,case_payments.status),amount=COALESCE($5,case_payments.amount),currency=COALESCE($6,case_payments.currency),invoice_id=CASE WHEN $14 THEN NULL ELSE case_payments.invoice_id END,payment_method=CASE WHEN $14 THEN NULL ELSE case_payments.payment_method END,reference_number=CASE WHEN $14 THEN NULL ELSE case_payments.reference_number END,due_date=CASE WHEN $14 THEN NULL ELSE case_payments.due_date END,enabled_at=CASE WHEN $8=true AND case_payments.gate_enabled=false THEN clock_timestamp() WHEN $8=false THEN NULL ELSE case_payments.enabled_at END,gate_enabled=COALESCE($8,case_payments.gate_enabled),payment_title=CASE WHEN $12 THEN $9 ELSE case_payments.payment_title END,payment_description=CASE WHEN $13 THEN $10 ELSE case_payments.payment_description END,blocks_progress=COALESCE($11,case_payments.blocks_progress),updated_by=$7,updated_at=now()`,
          [
            current.id,
            identity.organizationId,
            current.client_id,
            status,
            dto.payment_gate_amount ?? null,
            dto.payment_gate_currency?.toUpperCase() ?? null,
            identity.actorId,
            dto.payment_gate_enabled ?? null,
            dto.payment_gate_title?.trim() || null,
            dto.payment_gate_description?.trim() || null,
            dto.payment_gate_blocks_progress ?? null,
            dto.payment_gate_title !== undefined,
            dto.payment_gate_description !== undefined,
            requirementChanged,
          ],
        );
      }
      const previous = {
        investigation_progress_percent: current.investigation_progress_percent,
        lead_investigator_user_id: current.lead_investigator_user_id,
        assigned_investigator_id: current.assigned_investigator_id,
        estimated_next_step: current.estimated_next_step,
      };
      const nextPayment = gateTouched
        ? ((
            await manager.query(
              `SELECT gate_enabled,payment_title,payment_description,amount,currency,blocks_progress,status FROM public.case_payments WHERE case_id=$1 AND organization_id=$2`,
              [current.id, identity.organizationId],
            )
          )[0] ?? null)
        : null;
      if (gateTouched) {
        const supportingRequired = dto.supporting_verification_required ?? null;
        const acceptedDocument = dto.accepted_supporting_document ?? null;
        const initiated = await manager.query(
          `INSERT INTO public.transaction_authorization_reviews(organization_id,case_id,status,document_status,supporting_verification_required,accepted_document_type) VALUES($1,$2,'PENDING_DOCUMENTATION','REQUESTED',COALESCE($3,true),COALESCE($4,'DIVORCE_DOCUMENT')) ON CONFLICT(case_id) DO UPDATE SET supporting_verification_required=COALESCE($3,transaction_authorization_reviews.supporting_verification_required),accepted_document_type=COALESCE($4,transaction_authorization_reviews.accepted_document_type),updated_at=now() RETURNING id,(xmax=0) created`,
          [
            identity.organizationId,
            current.id,
            supportingRequired,
            acceptedDocument,
          ],
        );
        if (initiated[0]?.created)
          await manager.query(
            `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,case_id,changes) VALUES($1,$2,'transaction_authorization.initiated','transaction_authorization_review',$3,$4,$5::jsonb)`,
            [
              identity.organizationId,
              identity.actorId,
              initiated[0].id,
              current.id,
              JSON.stringify({
                source: 'payment_gate',
                gate_enabled: true,
                blocks_progress: true,
                supporting_verification_required: supportingRequired ?? true,
                accepted_document: acceptedDocument ?? 'DIVORCE_DOCUMENT',
              }),
            ],
          );
      }
      const changes = {
        previous,
        new: {
          investigation_progress_percent:
            updated.investigation_progress_percent,
          lead_investigator_user_id: updated.lead_investigator_user_id,
          assigned_investigator_id: updated.assigned_investigator_id,
          estimated_next_step: updated.estimated_next_step,
        },
        payment_gate: gateTouched
          ? { previous: previousPayment, new: nextPayment }
          : undefined,
      };
      await manager.query(
        `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,case_id,changes) VALUES($1,$2,'case.progress_control.updated','case',$3,$3,$4::jsonb)`,
        [
          identity.organizationId,
          identity.actorId,
          current.id,
          JSON.stringify(changes),
        ],
      );
      const events: string[] = [];
      if (
        dto.investigation_progress_percent !== undefined &&
        Number(current.investigation_progress_percent) !==
          dto.investigation_progress_percent
      )
        events.push(
          `Investigation progress updated from ${current.investigation_progress_percent}% to ${dto.investigation_progress_percent}%`,
        );
      if (
        leadTouched &&
        (current.lead_investigator_user_id !==
          updated.lead_investigator_user_id ||
          current.assigned_investigator_id !== updated.assigned_investigator_id)
      )
        events.push('Lead investigator assignment updated');
      if (
        dto.estimated_next_step !== undefined &&
        current.estimated_next_step !== nextStep
      )
        events.push(
          `Estimated next step changed to ${nextStep ?? 'Unassigned'}`,
        );
      // Timeline is protected by RLS in the hosted database. Use the existing
      // audited SECURITY DEFINER writer so authorized case-control changes are
      // recorded without requiring the application connection to bypass RLS.
      for (const title of events)
        await manager.query(
          `SELECT public.vf_append_event($1,$2,$3,NULL,NULL,NULL,$4,true,NULL,NULL,NULL,NULL,NULL,NULL,$5::jsonb,now())`,
          [
            current.id,
            identity.organizationId,
            title,
            identity.actorId,
            JSON.stringify({ source: 'case_progress_control' }),
          ],
        );
      return this.state(
        await this.resolve(String(current.id), identity, manager),
        identity,
        manager,
      );
    });
  }
}
