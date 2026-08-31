import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ActorService, AdminActor } from '../common/actor.service';
import { VINEFORD_USER_ROLES } from '../identity/supabase-identity.service';

type Row = Record<string, unknown>;

@Injectable()
export class EnterpriseService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly actors: ActorService,
  ) {}

  private text(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim())
      throw new BadRequestException(`${field} is required`);
    return value.trim();
  }

  private async admin(actorId?: string): Promise<AdminActor> {
    return this.actors.requireAdmin(actorId);
  }

  private async caseScope(
    caseId: string,
    actorId?: string,
  ): Promise<{ actor: AdminActor; organizationId: string }> {
    const actor = await this.admin(actorId);
    const rows = await this.dataSource.query<
      Array<{ organization_id: string }>
    >(
      'SELECT organization_id FROM public.cases WHERE id = $1 AND organization_id = $2',
      [caseId, actor.organization_id],
    );
    if (!rows[0]) throw new NotFoundException('case not found');
    return { actor, organizationId: rows[0].organization_id };
  }

  private async audit(
    actor: AdminActor,
    action: string,
    type: string,
    id: string,
    changes: Row,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO public.audit_logs (organization_id, user_id, action, resource_type, resource_id, changes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        actor.organization_id,
        actor.id,
        action,
        type,
        id,
        JSON.stringify(changes),
      ],
    );
  }

  async organizations(actorId?: string): Promise<Row[]> {
    const actor = await this.admin(actorId);
    return this.dataSource.query<Row[]>(
      `SELECT o.id, o.name, o.created_at, o.updated_at,
        (SELECT count(*)::int FROM public.cases c WHERE c.organization_id = o.id) AS case_count,
        (SELECT count(*)::int FROM public.app_users u WHERE u.organization_id = o.id) AS user_count
       FROM public.organizations o WHERE o.id = $1`,
      [actor.organization_id],
    );
  }

  async members(organizationId: string, actorId?: string): Promise<Row[]> {
    const actor = await this.admin(actorId);
    if (actor.organization_id !== organizationId)
      throw new NotFoundException('organization not found');
    return this.dataSource.query<Row[]>(
      `SELECT m.id, m.app_user_id, m.role, m.status, m.created_at, m.updated_at, u.name, u.email
       FROM public.organization_memberships m JOIN public.app_users u ON u.id = m.app_user_id
       WHERE m.organization_id = $1 ORDER BY u.name NULLS LAST, u.email`,
      [organizationId],
    );
  }

  async addMember(
    organizationId: string,
    body: Row,
    actorId?: string,
  ): Promise<Row> {
    const actor = await this.admin(actorId);
    if (actor.organization_id !== organizationId)
      throw new NotFoundException('organization not found');
    const userId = this.text(body.app_user_id, 'app_user_id');
    const role = this.text(body.role, 'role');
    if (
      !VINEFORD_USER_ROLES.includes(
        role as (typeof VINEFORD_USER_ROLES)[number],
      )
    )
      throw new BadRequestException('unsupported organization role');
    if (role === 'super_admin' && actor.role !== 'super_admin')
      throw new BadRequestException(
        'only a super administrator can assign the super_admin role',
      );
    const user = await this.dataSource.query<Array<{ id: string }>>(
      'SELECT id FROM public.app_users WHERE id = $1 AND organization_id = $2 AND role::text = $3 AND is_active = true',
      [userId, organizationId, role],
    );
    if (!user[0])
      throw new NotFoundException(
        'active user with the requested role not found in organization',
      );
    const rows = await this.dataSource.query<Row[]>(
      `INSERT INTO public.organization_memberships (organization_id, app_user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, app_user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = now()
       RETURNING id, organization_id, app_user_id, role, status, created_at, updated_at`,
      [organizationId, userId, role],
    );
    await this.audit(
      actor,
      'organization.membership.upserted',
      'organization_membership',
      String(rows[0].id),
      { user_id: userId, role },
    );
    return rows[0];
  }

  async settings(organizationId: string, actorId?: string): Promise<Row[]> {
    const actor = await this.admin(actorId);
    if (actor.organization_id !== organizationId)
      throw new NotFoundException('organization not found');
    return this.dataSource.query<Row[]>(
      'SELECT setting_key, setting_value, updated_at FROM public.organization_settings WHERE organization_id = $1 ORDER BY setting_key',
      [organizationId],
    );
  }

  async setSetting(
    organizationId: string,
    key: string,
    value: unknown,
    actorId?: string,
  ): Promise<Row> {
    const actor = await this.admin(actorId);
    if (actor.organization_id !== organizationId)
      throw new NotFoundException('organization not found');
    if (!key || value === undefined)
      throw new BadRequestException('setting key and value are required');
    const rows = await this.dataSource.query<Row[]>(
      `INSERT INTO public.organization_settings (organization_id, setting_key, setting_value, updated_by, enabled_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $3::jsonb='true'::jsonb THEN clock_timestamp() ELSE NULL END)
       ON CONFLICT (organization_id, setting_key) DO UPDATE SET
         enabled_at=CASE WHEN EXCLUDED.setting_value='true'::jsonb AND organization_settings.setting_value<>'true'::jsonb THEN clock_timestamp()
                         WHEN EXCLUDED.setting_value<>'true'::jsonb THEN NULL ELSE organization_settings.enabled_at END,
         setting_value=EXCLUDED.setting_value, updated_by=EXCLUDED.updated_by, updated_at=now()
       RETURNING setting_key, setting_value, enabled_at, updated_at`,
      [organizationId, key, JSON.stringify(value), actor.id],
    );
    await this.audit(
      actor,
      'organization.setting.updated',
      'organization_setting',
      key,
      { key },
    );
    return rows[0];
  }

  async assignments(caseId: string, actorId?: string): Promise<Row[]> {
    const { organizationId } = await this.caseScope(caseId, actorId);
    return this.dataSource.query<Row[]>(
      `SELECT a.id, a.app_user_id, a.assignment_role, a.active, a.assigned_at, a.unassigned_at, u.name, u.email
       FROM public.case_assignments a JOIN public.app_users u ON u.id = a.app_user_id
       WHERE a.case_id = $1 AND a.organization_id = $2 ORDER BY a.active DESC, a.assigned_at DESC`,
      [caseId, organizationId],
    );
  }

  async assign(caseId: string, body: Row, actorId?: string): Promise<Row> {
    const { actor, organizationId } = await this.caseScope(caseId, actorId);
    const userId = this.text(body.app_user_id, 'app_user_id');
    const role = this.text(body.assignment_role, 'assignment_role');
    if (!['owner', 'investigator', 'reviewer', 'staff'].includes(role))
      throw new BadRequestException('unsupported assignment_role');
    const user = await this.dataSource.query<Array<{ id: string }>>(
      'SELECT id FROM public.app_users WHERE id = $1 AND organization_id = $2 AND role <> $3',
      [userId, organizationId, 'client'],
    );
    if (!user[0]) throw new NotFoundException('eligible staff user not found');
    const rows = await this.dataSource.query<Row[]>(
      `INSERT INTO public.case_assignments (case_id, organization_id, app_user_id, assignment_role, assigned_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (case_id, app_user_id, assignment_role) DO UPDATE SET active = true, unassigned_at = NULL, assigned_by = EXCLUDED.assigned_by, updated_at = now()
       RETURNING id, case_id, app_user_id, assignment_role, active, assigned_at`,
      [caseId, organizationId, userId, role, actor.id],
    );
    await this.audit(
      actor,
      'case.assignment.upserted',
      'case_assignment',
      String(rows[0].id),
      { case_id: caseId, user_id: userId, role },
    );
    return rows[0];
  }

  async assignmentTransfers(caseId: string, actorId?: string): Promise<Row[]> {
    const { organizationId } = await this.caseScope(caseId, actorId);
    return this.dataSource.query<Row[]>(
      `SELECT t.*, u.name AS destination_name, u.email AS destination_email
       FROM public.case_assignment_transfers t
       JOIN public.app_users u ON u.id = t.destination_app_user_id
       WHERE t.case_id = $1 AND t.organization_id = $2 ORDER BY t.requested_at DESC`,
      [caseId, organizationId],
    );
  }

  async requestAssignmentTransfer(
    caseId: string,
    body: Row,
    actorId?: string,
  ): Promise<Row> {
    const { actor, organizationId } = await this.caseScope(caseId, actorId);
    const destinationId = this.text(
      body.destination_app_user_id,
      'destination_app_user_id',
    );
    const destinationRole = this.text(
      body.destination_role,
      'destination_role',
    );
    const reason = this.text(body.reason, 'reason');
    if (
      !['owner', 'investigator', 'reviewer', 'staff'].includes(destinationRole)
    )
      throw new BadRequestException('unsupported destination_role');
    const destination = await this.dataSource.query<Array<{ id: string }>>(
      'SELECT id FROM public.app_users WHERE id = $1 AND organization_id = $2 AND role <> $3',
      [destinationId, organizationId, 'client'],
    );
    if (!destination[0])
      throw new NotFoundException('eligible destination user not found');
    const rows = await this.dataSource.query<Row[]>(
      `INSERT INTO public.case_assignment_transfers (organization_id, case_id, source_assignment_id, destination_app_user_id, destination_role, requested_by, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        organizationId,
        caseId,
        body.source_assignment_id ?? null,
        destinationId,
        destinationRole,
        actor.id,
        reason,
      ],
    );
    await this.audit(
      actor,
      'case.assignment_transfer.requested',
      'case_assignment_transfer',
      String(rows[0].id),
      { case_id: caseId },
    );
    return rows[0];
  }

  async approveAssignmentTransfer(
    transferId: string,
    body: Row,
    actorId?: string,
  ): Promise<Row> {
    const actor = await this.admin(actorId);
    const note = typeof body.note === 'string' ? body.note.trim() : null;
    const rows = await this.dataSource.query<Row[]>(
      `UPDATE public.case_assignment_transfers t SET status = 'approved', approved_by = $1, approved_at = now(), decision_note = $2, updated_at = now()
       WHERE t.id = $3 AND t.organization_id = $4 AND t.status = 'requested' RETURNING *`,
      [actor.id, note, transferId, actor.organization_id],
    );
    if (!rows[0]) throw new NotFoundException('requested transfer not found');
    await this.audit(
      actor,
      'case.assignment_transfer.approved',
      'case_assignment_transfer',
      transferId,
      { case_id: rows[0].case_id },
    );
    return rows[0];
  }

  async completeAssignmentTransfer(
    transferId: string,
    actorId?: string,
  ): Promise<Row> {
    const actor = await this.admin(actorId);
    const completed = await this.dataSource.transaction(async (manager) => {
      const transfers = await manager.query<Row[]>(
        `SELECT * FROM public.case_assignment_transfers WHERE id = $1 AND organization_id = $2 AND status = 'approved' FOR UPDATE`,
        [transferId, actor.organization_id],
      );
      const transfer = transfers[0];
      if (!transfer) throw new NotFoundException('approved transfer not found');
      if (transfer.source_assignment_id) {
        await manager.query(
          `UPDATE public.case_assignments SET active = false, unassigned_at = now(), updated_at = now()
           WHERE id = $1 AND case_id = $2 AND organization_id = $3`,
          [
            transfer.source_assignment_id,
            transfer.case_id,
            actor.organization_id,
          ],
        );
      }
      await manager.query(
        `INSERT INTO public.case_assignments (case_id, organization_id, app_user_id, assignment_role, assigned_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (case_id, app_user_id, assignment_role) DO UPDATE SET active = true, unassigned_at = NULL, assigned_by = EXCLUDED.assigned_by, updated_at = now()`,
        [
          transfer.case_id,
          actor.organization_id,
          transfer.destination_app_user_id,
          transfer.destination_role,
          actor.id,
        ],
      );
      const rows = await manager.query<Row[]>(
        `UPDATE public.case_assignment_transfers SET status = 'completed', completed_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'approved' RETURNING *`,
        [transferId],
      );
      return rows[0];
    });
    await this.audit(
      actor,
      'case.assignment_transfer.completed',
      'case_assignment_transfer',
      transferId,
      { case_id: completed.case_id },
    );
    return completed;
  }

  async treasuryAccounts(actorId?: string): Promise<Row[]> {
    const actor = await this.admin(actorId);
    return this.dataSource.query<Row[]>(
      `SELECT a.*, COALESCE(SUM(CASE WHEN e.entry_type IN ('credit','release','adjustment') THEN e.amount ELSE -e.amount END), 0) AS derived_balance
       FROM public.treasury_accounts a LEFT JOIN public.treasury_ledger_entries e ON e.treasury_account_id = a.id
       WHERE a.organization_id = $1 GROUP BY a.id ORDER BY a.created_at DESC`,
      [actor.organization_id],
    );
  }

  async createTreasuryAccount(body: Row, actorId?: string): Promise<Row> {
    const actor = await this.admin(actorId);
    const caseId = typeof body.case_id === 'string' ? body.case_id : null;
    if (caseId) await this.caseScope(caseId, actorId);
    const rows = await this.dataSource.query<Row[]>(
      `INSERT INTO public.treasury_accounts (organization_id, case_id, account_reference, currency, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [
        actor.organization_id,
        caseId,
        this.text(body.account_reference, 'account_reference'),
        this.text(body.currency, 'currency').toUpperCase(),
        actor.id,
      ],
    );
    await this.audit(
      actor,
      'treasury.account.created',
      'treasury_account',
      String(rows[0].id),
      { case_id: caseId },
    );
    return rows[0];
  }

  async treasuryLedger(accountId: string, actorId?: string): Promise<Row[]> {
    const actor = await this.admin(actorId);
    const account = await this.dataSource.query<Array<{ id: string }>>(
      'SELECT id FROM public.treasury_accounts WHERE id = $1 AND organization_id = $2',
      [accountId, actor.organization_id],
    );
    if (!account[0]) throw new NotFoundException('treasury account not found');
    return this.dataSource.query<Row[]>(
      'SELECT * FROM public.treasury_ledger_entries WHERE treasury_account_id = $1 ORDER BY created_at DESC',
      [accountId],
    );
  }

  async createTreasuryFunding(body: Row, actorId?: string): Promise<Row> {
    const actor = await this.admin(actorId);
    const accountId = this.text(
      body.treasury_account_id,
      'treasury_account_id',
    );
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new BadRequestException('amount must be positive');
    const currency = this.text(body.currency, 'currency').toUpperCase();
    const reference = this.text(body.funding_reference, 'funding_reference');
    const caseId = typeof body.case_id === 'string' ? body.case_id : null;
    if (caseId) await this.caseScope(caseId, actorId);
    const result = await this.dataSource.transaction(async (manager) => {
      const accounts = await manager.query<
        Array<{ id: string; currency: string; case_id: string | null }>
      >(
        'SELECT id, currency, case_id FROM public.treasury_accounts WHERE id=$1 AND organization_id=$2 AND status=$3',
        [accountId, actor.organization_id, 'active'],
      );
      if (!accounts[0] || accounts[0].currency !== currency)
        throw new NotFoundException(
          'active treasury account with matching currency not found',
        );
      if (accounts[0].case_id && caseId && accounts[0].case_id !== caseId)
        throw new BadRequestException(
          'account case does not match funding case',
        );
      const funding = await manager.query<Row[]>(
        `INSERT INTO public.treasury_funding_allocations (organization_id,treasury_account_id,case_id,amount,currency,funding_reference,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          actor.organization_id,
          accountId,
          caseId,
          amount,
          currency,
          reference,
          actor.id,
        ],
      );
      await manager.query(
        `INSERT INTO public.treasury_ledger_entries (organization_id,treasury_account_id,case_id,entry_type,amount,currency,reference,source_type,source_id,created_by)
         VALUES ($1,$2,$3,'credit',$4,$5,$6,'funding_allocation',$7,$8)`,
        [
          actor.organization_id,
          accountId,
          caseId,
          amount,
          currency,
          reference,
          funding[0].id,
          actor.id,
        ],
      );
      return funding[0];
    });
    await this.audit(
      actor,
      'treasury.funding.recorded',
      'treasury_funding_allocation',
      String(result.id),
      { account_id: accountId, case_id: caseId, currency },
    );
    return result;
  }

  async treasuryFunding(actorId?: string): Promise<Row[]> {
    const actor = await this.admin(actorId);
    return this.dataSource.query<Row[]>(
      'SELECT * FROM public.treasury_funding_allocations WHERE organization_id=$1 ORDER BY created_at DESC',
      [actor.organization_id],
    );
  }

  async assets(caseId: string, actorId?: string): Promise<Row[]> {
    await this.caseScope(caseId, actorId);
    return this.dataSource.query<Row[]>(
      'SELECT * FROM public.case_assets WHERE case_id = $1 ORDER BY created_at DESC',
      [caseId],
    );
  }
  async wallets(caseId: string, actorId?: string): Promise<Row[]> {
    await this.caseScope(caseId, actorId);
    return this.dataSource.query<Row[]>(
      'SELECT * FROM public.case_wallets WHERE case_id = $1 ORDER BY created_at DESC',
      [caseId],
    );
  }
  async transactions(caseId: string, actorId?: string): Promise<Row[]> {
    await this.caseScope(caseId, actorId);
    return this.dataSource.query<Row[]>(
      'SELECT * FROM public.case_transactions WHERE case_id = $1 ORDER BY transaction_timestamp DESC NULLS LAST, created_at DESC',
      [caseId],
    );
  }

  async traces(caseId: string, actorId?: string): Promise<Row[]> {
    await this.caseScope(caseId, actorId);
    return this.dataSource.query<Row[]>(
      'SELECT * FROM public.case_intelligence_traces WHERE case_id = $1 ORDER BY created_at DESC',
      [caseId],
    );
  }
  async recoveries(caseId: string, actorId?: string): Promise<Row[]> {
    await this.caseScope(caseId, actorId);
    return this.dataSource.query<Row[]>(
      'SELECT * FROM public.case_recoveries WHERE case_id = $1 ORDER BY updated_at DESC',
      [caseId],
    );
  }

  async createAsset(caseId: string, body: Row, actorId?: string): Promise<Row> {
    const { actor, organizationId } = await this.caseScope(caseId, actorId);
    const rows = await this.dataSource.query<Row[]>(
      `INSERT INTO public.case_assets (organization_id, case_id, asset_type, label, description, currency, estimated_value, verified_value, status, source, linked_evidence_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'identified'),$10,$11,$12) RETURNING *`,
      [
        organizationId,
        caseId,
        this.text(body.asset_type, 'asset_type'),
        this.text(body.label, 'label'),
        body.description ?? null,
        body.currency ?? null,
        body.estimated_value ?? null,
        body.verified_value ?? null,
        body.status ?? null,
        body.source ?? null,
        body.linked_evidence_id ?? null,
        actor.id,
      ],
    );
    await this.audit(actor, 'asset.created', 'case_asset', String(rows[0].id), {
      case_id: caseId,
    });
    return rows[0];
  }

  async createWallet(
    caseId: string,
    body: Row,
    actorId?: string,
  ): Promise<Row> {
    const { actor, organizationId } = await this.caseScope(caseId, actorId);
    const rows = await this.dataSource.query<Row[]>(
      `INSERT INTO public.case_wallets (organization_id, case_id, network, address, label, classification, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        organizationId,
        caseId,
        this.text(body.network, 'network'),
        this.text(body.address, 'address'),
        body.label ?? null,
        body.classification ?? null,
        body.notes ?? null,
        actor.id,
      ],
    );
    await this.audit(
      actor,
      'wallet.created',
      'case_wallet',
      String(rows[0].id),
      { case_id: caseId },
    );
    return rows[0];
  }

  async createTransaction(
    caseId: string,
    body: Row,
    actorId?: string,
  ): Promise<Row> {
    const { actor, organizationId } = await this.caseScope(caseId, actorId);
    const rows = await this.dataSource.query<Row[]>(
      `INSERT INTO public.case_transactions (organization_id, case_id, network, transaction_hash, asset_token, amount, currency, source_address, destination_address, transaction_timestamp, block_number, status, classification, linked_evidence_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        organizationId,
        caseId,
        this.text(body.network, 'network'),
        this.text(body.transaction_hash, 'transaction_hash'),
        body.asset_token ?? null,
        body.amount ?? null,
        body.currency ?? null,
        body.source_address ?? null,
        body.destination_address ?? null,
        body.transaction_timestamp ?? null,
        body.block_number ?? null,
        body.status ?? null,
        body.classification ?? null,
        body.linked_evidence_id ?? null,
        actor.id,
      ],
    );
    await this.audit(
      actor,
      'transaction.created',
      'case_transaction',
      String(rows[0].id),
      { case_id: caseId },
    );
    return rows[0];
  }

  async createRecovery(
    caseId: string,
    body: Row,
    actorId?: string,
  ): Promise<Row> {
    const { actor, organizationId } = await this.caseScope(caseId, actorId);
    const rows = await this.dataSource.query<Row[]>(
      `INSERT INTO public.case_recoveries (organization_id, case_id, asset_id, transaction_id, status, amount, currency, recovered_amount, returned_amount, note, linked_evidence_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,COALESCE($5,'identified'),$6,$7,COALESCE($8,0),COALESCE($9,0),$10,$11,$12,$12) RETURNING *`,
      [
        organizationId,
        caseId,
        body.asset_id ?? null,
        body.transaction_id ?? null,
        body.status ?? null,
        body.amount ?? null,
        body.currency ?? null,
        body.recovered_amount ?? null,
        body.returned_amount ?? null,
        body.note ?? null,
        body.linked_evidence_id ?? null,
        actor.id,
      ],
    );
    await this.dataSource.query(
      `INSERT INTO public.case_recovery_events (recovery_id, organization_id, case_id, actor_id, next_state, reason)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        rows[0].id,
        organizationId,
        caseId,
        actor.id,
        JSON.stringify(rows[0]),
        body.note ?? null,
      ],
    );
    await this.audit(
      actor,
      'recovery.created',
      'case_recovery',
      String(rows[0].id),
      { case_id: caseId, status: rows[0].status },
    );
    return rows[0];
  }

  async createTrace(caseId: string, body: Row, actorId?: string): Promise<Row> {
    const { actor, organizationId } = await this.caseScope(caseId, actorId);
    const rows = await this.dataSource.query<Row[]>(
      `INSERT INTO public.case_intelligence_traces
        (organization_id, case_id, source_type, source_id, target_type, target_id, relationship_type, classification, source_note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        organizationId,
        caseId,
        this.text(body.source_type, 'source_type'),
        this.text(body.source_id, 'source_id'),
        this.text(body.target_type, 'target_type'),
        this.text(body.target_id, 'target_id'),
        this.text(body.relationship_type, 'relationship_type'),
        body.classification ?? null,
        body.source_note ?? null,
        actor.id,
      ],
    );
    await this.audit(
      actor,
      'intelligence.trace.created',
      'case_trace',
      String(rows[0].id),
      { case_id: caseId },
    );
    return rows[0];
  }
}
