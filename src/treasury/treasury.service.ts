import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { AlgorandService } from '../funding/algorand.service';
import { DepositAddressProvider } from './deposit-address-provider';
import { ConfigService } from '@nestjs/config';

type Payload = Record<string, unknown>;
type Row = Record<string, any>;

@Injectable()
export class TreasuryService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly algorand: AlgorandService,
    private readonly addresses: DepositAddressProvider,
    private readonly config: ConfigService,
  ) {}

  private text(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim())
      throw new BadRequestException(`${field} is required`);
    return value.trim();
  }
  private admin(identity: VerifiedIdentity): void {
    if (!['admin', 'super_admin', 'financial_analyst'].includes(identity.role))
      throw new ForbiddenException('Treasury administrator access required');
  }
  private verifier(identity: VerifiedIdentity): void {
    if (!['admin', 'super_admin'].includes(identity.role))
      throw new ForbiddenException(
        'Treasury funding verification requires an administrator',
      );
  }
  private async account(
    id: string,
    identity: VerifiedIdentity,
    manager: DataSource | EntityManager = this.db,
  ): Promise<Row> {
    const rows = await manager.query(
      `SELECT * FROM public.treasury_accounts WHERE id=$1 AND organization_id=$2 AND status='active'`,
      [id, identity.organizationId],
    );
    if (!rows[0])
      throw new NotFoundException('active Treasury account not found');
    if (
      identity.role === 'client' &&
      (!identity.caseId || rows[0].case_id !== identity.caseId)
    )
      throw new ForbiddenException('Treasury account is outside client scope');
    return rows[0];
  }
  private async audit(
    manager: DataSource | EntityManager,
    identity: VerifiedIdentity,
    action: string,
    type: string,
    id: string,
    changes: Payload = {},
  ): Promise<void> {
    await manager.query(
      `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,changes) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        identity.organizationId,
        identity.actorId,
        action,
        type,
        id,
        JSON.stringify(changes),
      ],
    );
  }

  async overview(identity: VerifiedIdentity): Promise<Row[]> {
    const client = identity.role === 'client';
    return this.db.query(
      `SELECT a.id,a.account_reference,a.currency,a.case_id,
      COALESCE(SUM(CASE WHEN e.entry_type IN ('credit','adjustment') THEN e.amount WHEN e.entry_type IN ('debit','release','allocation') THEN -e.amount ELSE 0 END),0) derived_balance,
      COALESCE((SELECT SUM(d.amount) FROM public.treasury_chain_deposits d WHERE d.treasury_account_id=a.id AND d.status IN ('detected','confirming','verified')),0) pending_deposits,
      COALESCE((SELECT SUM(w.amount) FROM public.treasury_chain_withdrawals w WHERE w.treasury_account_id=a.id AND w.status IN ('approved','execution_pending','broadcast','confirming')),0) reserved_funds
      FROM public.treasury_accounts a LEFT JOIN public.treasury_ledger_entries e ON e.treasury_account_id=a.id
      WHERE a.organization_id=$1 ${client ? 'AND a.case_id=$2' : ''} GROUP BY a.id ORDER BY a.created_at DESC`,
      client
        ? [identity.organizationId, identity.caseId]
        : [identity.organizationId],
    );
  }

  async managedAccounts(identity: VerifiedIdentity): Promise<Row[]> {
    if (identity.role !== 'client') this.admin(identity);
    return this.db.query(
      `SELECT a.id,a.account_reference,a.currency,a.case_id,c.case_number,c.client_id,
      COALESCE(SUM(CASE WHEN e.entry_type IN ('credit','adjustment') THEN e.amount WHEN e.entry_type IN ('debit','release','allocation') THEN -e.amount ELSE 0 END),0) derived_balance,
      COALESCE((SELECT SUM(f.amount) FROM public.treasury_funding_allocations f WHERE f.treasury_account_id=a.id AND f.status IN ('pending','under_review') AND f.funding_effect='credit'),0) pending_funding,
      COALESCE((SELECT SUM(w.amount) FROM public.treasury_chain_withdrawals w WHERE w.treasury_account_id=a.id AND w.status IN ('approved','execution_pending','broadcast','confirming')),0) reserved_funds
      FROM public.treasury_accounts a LEFT JOIN public.cases c ON c.id=a.case_id AND c.organization_id=a.organization_id LEFT JOIN public.treasury_ledger_entries e ON e.treasury_account_id=a.id
      WHERE a.organization_id=$1 ${identity.role === 'client' ? 'AND a.case_id=$2' : ''} GROUP BY a.id,c.case_number,c.client_id ORDER BY a.created_at DESC`,
      identity.role === 'client'
        ? [identity.organizationId, identity.caseId]
        : [identity.organizationId],
    );
  }

  async assignAddress(body: Payload, identity: VerifiedIdentity): Promise<Row> {
    const accountId = this.text(
      body.treasury_account_id,
      'treasury_account_id',
    );
    const account = await this.account(accountId, identity);
    const caseId =
      typeof body.case_id === 'string' ? body.case_id : account.case_id;
    if (caseId && account.case_id && caseId !== account.case_id)
      throw new ForbiddenException('case scope mismatch');
    if (
      identity.role === 'client' &&
      (caseId !== identity.caseId ||
        (body.app_user_id && body.app_user_id !== identity.actorId))
    )
      throw new ForbiddenException('client deposit scope mismatch');
    const appUserId =
      identity.role === 'client'
        ? identity.actorId
        : typeof body.app_user_id === 'string'
          ? body.app_user_id
          : null;
    const network = this.text(body.network, 'network');
    const asset = this.text(body.asset, 'asset').toUpperCase();
    const publicAddress =
      typeof body.deposit_address === 'string'
        ? body.deposit_address.trim()
        : undefined;
    if (publicAddress && identity.role !== 'super_admin')
      throw new ForbiddenException(
        'only a super administrator may assign a public Testnet deposit address',
      );
    if (publicAddress) {
      const duplicate = await this.db.query(
        'SELECT id FROM public.treasury_deposit_addresses WHERE network=$1 AND deposit_address=$2 LIMIT 1',
        [network, publicAddress],
      );
      if (duplicate[0])
        throw new ConflictException('deposit address is already assigned');
    }
    const externalReference = `${identity.organizationId}:${accountId}:${caseId ?? 'organization'}:${appUserId ?? 'unassigned'}`;
    const assigned = await this.addresses.assign(
      network,
      asset,
      externalReference,
      publicAddress,
    );
    const rows = await this.db.query(
      `INSERT INTO public.treasury_deposit_addresses(organization_id,treasury_account_id,case_id,app_user_id,network,asset,deposit_address,address_type,status,provider_name,provider_reference,metadata,created_by,activated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'awaiting_deposit',$9,$10,$11::jsonb,$12,now()) RETURNING *`,
      [
        identity.organizationId,
        accountId,
        caseId,
        appUserId,
        network,
        asset,
        assigned.address,
        assigned.addressType,
        assigned.provider,
        assigned.reference,
        JSON.stringify(assigned.metadata),
        identity.actorId,
      ],
    );
    await this.audit(
      this.db,
      identity,
      'treasury.deposit_address.assigned',
      'treasury_deposit_address',
      rows[0].id,
      { network, asset, case_id: caseId },
    );
    return rows[0];
  }

  async addressesFor(identity: VerifiedIdentity): Promise<Row[]> {
    return this.db.query(
      `SELECT d.* FROM public.treasury_deposit_addresses d WHERE d.organization_id=$1 ${identity.role === 'client' ? 'AND d.app_user_id=$2 AND d.case_id=$3' : ''} ORDER BY d.created_at DESC`,
      identity.role === 'client'
        ? [identity.organizationId, identity.actorId, identity.caseId]
        : [identity.organizationId],
    );
  }
  async deposits(identity: VerifiedIdentity): Promise<Row[]> {
    return this.db.query(
      `SELECT d.* FROM public.treasury_chain_deposits d JOIN public.treasury_deposit_addresses a ON a.id=d.deposit_address_id WHERE d.organization_id=$1 ${identity.role === 'client' ? 'AND a.app_user_id=$2 AND a.case_id=$3' : ''} ORDER BY d.detected_at DESC`,
      identity.role === 'client'
        ? [identity.organizationId, identity.actorId, identity.caseId]
        : [identity.organizationId],
    );
  }

  async funding(identity: VerifiedIdentity): Promise<Row[]> {
    const client = identity.role === 'client';
    if (!client) this.admin(identity);
    if (client)
      return this.db.query(
        `SELECT f.id,f.amount,f.currency,f.funding_type,f.funding_effect,f.funding_date,f.status,f.verified_at,f.created_at,f.updated_at
      FROM public.treasury_funding_allocations f WHERE f.organization_id=$1 AND f.case_id=$2
      AND f.client_id=(SELECT client_id FROM public.cases WHERE id=$2 AND organization_id=$1) ORDER BY f.created_at DESC`,
        [identity.organizationId, identity.caseId],
      );
    return this.db.query(
      `SELECT f.id,f.treasury_account_id,f.client_id,f.case_id,f.amount,f.currency,f.funding_reference,f.funding_type,f.funding_effect,f.external_reference,f.funding_date,f.status,f.notes,f.rejection_reason,f.verified_at,f.created_at,f.updated_at,
      submitter.name submitted_by_name,verifier.name verified_by_name,d.title supporting_document_title,e.title supporting_evidence_title,
      coalesce((SELECT jsonb_agg(jsonb_build_object('from_status',h.from_status,'to_status',h.to_status,'reason',h.reason,'changed_by',u.name,'created_at',h.created_at) ORDER BY h.created_at) FROM public.treasury_funding_status_history h LEFT JOIN public.app_users u ON u.id=h.changed_by WHERE h.funding_id=f.id),'[]'::jsonb) audit_history
      FROM public.treasury_funding_allocations f
      LEFT JOIN public.app_users submitter ON submitter.id=f.submitted_by LEFT JOIN public.app_users verifier ON verifier.id=f.verified_by
      LEFT JOIN public.documents d ON d.id=f.supporting_document_id LEFT JOIN public.evidence e ON e.id=f.supporting_evidence_id
      WHERE f.organization_id=$1 ORDER BY f.created_at DESC`,
      [identity.organizationId],
    );
  }

  async createFunding(body: Payload, identity: VerifiedIdentity): Promise<Row> {
    this.admin(identity);
    const accountId = this.text(
        body.treasury_account_id,
        'treasury_account_id',
      ),
      caseId = this.text(body.case_id, 'case_id'),
      clientId = this.text(body.client_id, 'client_id');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new BadRequestException('amount must be positive');
    const currency = this.text(body.currency, 'currency').toUpperCase(),
      reference = this.text(body.funding_reference, 'funding_reference');
    const type = this.text(body.funding_type, 'funding_type'),
      effect =
        typeof body.funding_effect === 'string'
          ? body.funding_effect
          : 'credit';
    if (
      ![
        'client_deposit',
        'organization_allocation',
        'verified_external_transfer',
        'bank_wire',
        'crypto_funding',
        'adjustment_correction',
      ].includes(type)
    )
      throw new BadRequestException('unsupported funding type');
    if (
      !['credit', 'debit'].includes(effect) ||
      (effect === 'debit' && type !== 'adjustment_correction')
    )
      throw new BadRequestException(
        'only an adjustment/correction may be a debit',
      );
    const documentId =
        typeof body.supporting_document_id === 'string'
          ? body.supporting_document_id
          : null,
      evidenceId =
        typeof body.supporting_evidence_id === 'string'
          ? body.supporting_evidence_id
          : null;
    if (documentId && evidenceId)
      throw new BadRequestException(
        'link one supporting document or evidence record',
      );
    if (
      type === 'adjustment_correction' &&
      !(typeof body.notes === 'string' && body.notes.trim())
    )
      throw new BadRequestException('an adjustment requires a reason');
    return this.db.transaction(async (manager) => {
      const accounts = await manager.query(
        `SELECT a.id,a.currency,a.case_id,c.client_id FROM public.treasury_accounts a JOIN public.cases c ON c.id=$3 AND c.organization_id=a.organization_id WHERE a.id=$1 AND a.organization_id=$2 AND a.status='active'`,
        [accountId, identity.organizationId, caseId],
      );
      if (
        !accounts[0] ||
        accounts[0].case_id !== caseId ||
        accounts[0].client_id !== clientId ||
        accounts[0].currency !== currency
      )
        throw new NotFoundException(
          'active case Treasury account/client/currency combination not found',
        );
      if (documentId || evidenceId) {
        const table = documentId ? 'documents' : 'evidence',
          source = documentId ?? evidenceId;
        const linked = await manager.query(
          `SELECT id FROM public.${table} WHERE id=$1 AND case_id=$2 AND organization_id=$3`,
          [source, caseId, identity.organizationId],
        );
        if (!linked[0])
          throw new NotFoundException('supporting record not found in case');
      }
      const rows = await manager.query(
        `INSERT INTO public.treasury_funding_allocations(organization_id,treasury_account_id,case_id,client_id,amount,currency,funding_reference,funding_type,funding_effect,external_reference,funding_date,status,submitted_by,supporting_document_id,supporting_evidence_id,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13,$14,$15,$12) RETURNING *`,
        [
          identity.organizationId,
          accountId,
          caseId,
          clientId,
          amount,
          currency,
          reference,
          type,
          effect,
          typeof body.external_reference === 'string'
            ? body.external_reference.trim() || null
            : null,
          body.funding_date ?? null,
          identity.actorId,
          documentId,
          evidenceId,
          typeof body.notes === 'string' ? body.notes.trim() || null : null,
        ],
      );
      await manager.query(
        `INSERT INTO public.treasury_funding_status_history(organization_id,funding_id,from_status,to_status,reason,changed_by) VALUES($1,$2,NULL,'pending',$3,$4)`,
        [identity.organizationId, rows[0].id, rows[0].notes, identity.actorId],
      );
      await this.audit(
        manager,
        identity,
        'treasury.funding.submitted',
        'treasury_funding_allocation',
        rows[0].id,
        { case_id: caseId, amount, currency, type, effect },
      );
      return rows[0];
    });
  }

  async reviewFunding(
    id: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    this.admin(identity);
    const target = this.text(body.status, 'status').toLowerCase(),
      reason =
        typeof body.reason === 'string' ? body.reason.trim() || null : null;
    if (!['under_review', 'verified', 'rejected', 'cancelled'].includes(target))
      throw new BadRequestException('unsupported funding status');
    if (target === 'verified') this.verifier(identity);
    if (['rejected', 'cancelled'].includes(target) && !reason)
      throw new BadRequestException('a reason is required');
    return this.db.transaction(async (manager) => {
      const rows = await manager.query(
        `SELECT * FROM public.treasury_funding_allocations WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [id, identity.organizationId],
      );
      const row = rows[0];
      if (!row) throw new NotFoundException('funding record not found');
      const allowed: Record<string, string[]> = {
        pending: ['under_review', 'cancelled'],
        under_review: ['verified', 'rejected', 'cancelled'],
      };
      if (!(allowed[row.status] ?? []).includes(target))
        throw new ConflictException(
          `invalid funding transition ${row.status} -> ${target}`,
        );
      if (target === 'verified') {
        if (
          !row.supporting_document_id &&
          !row.supporting_evidence_id &&
          row.funding_type !== 'organization_allocation'
        )
          throw new ConflictException(
            'supporting documentation or evidence is required before verification',
          );
        if (
          !row.external_reference &&
          [
            'client_deposit',
            'verified_external_transfer',
            'bank_wire',
            'crypto_funding',
          ].includes(row.funding_type)
        )
          throw new ConflictException(
            'an external funding reference is required before verification',
          );
        const account = await manager.query(
          `SELECT id,status,currency,case_id FROM public.treasury_accounts WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
          [row.treasury_account_id, identity.organizationId],
        );
        if (
          !account[0] ||
          account[0].status !== 'active' ||
          account[0].currency !== row.currency ||
          account[0].case_id !== row.case_id
        )
          throw new ConflictException(
            'Treasury account is not eligible for funding verification',
          );
        await manager.query(
          `INSERT INTO public.treasury_ledger_entries(organization_id,treasury_account_id,case_id,entry_type,amount,currency,reference,source_type,source_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'verified_funding',$8,$9)`,
          [
            identity.organizationId,
            row.treasury_account_id,
            row.case_id,
            row.funding_effect === 'debit' ? 'debit' : 'credit',
            row.amount,
            row.currency,
            `VERIFIED-FUNDING:${row.id}`,
            row.id,
            identity.actorId,
          ],
        );
      }
      const updated = (
        await manager.query(
          `UPDATE public.treasury_funding_allocations SET status=$3,verified_by=CASE WHEN $3='verified' THEN $4 ELSE verified_by END,verified_at=CASE WHEN $3='verified' THEN now() ELSE verified_at END,rejection_reason=CASE WHEN $3='rejected' THEN $5 ELSE rejection_reason END,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *`,
          [id, identity.organizationId, target, identity.actorId, reason],
        )
      )[0];
      await manager.query(
        `INSERT INTO public.treasury_funding_status_history(organization_id,funding_id,from_status,to_status,reason,changed_by) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          identity.organizationId,
          id,
          row.status,
          target,
          reason,
          identity.actorId,
        ],
      );
      await this.audit(
        manager,
        identity,
        'treasury.funding.status_changed',
        'treasury_funding_allocation',
        id,
        {
          from: row.status,
          to: target,
          ledger_effect: target === 'verified' ? row.funding_effect : null,
        },
      );
      return updated;
    });
  }

  async scanAddress(
    addressId: string,
    identity: VerifiedIdentity,
  ): Promise<Row[]> {
    const scoped = await this.db.query(
      `SELECT a.* FROM public.treasury_deposit_addresses a WHERE a.id=$1 AND a.organization_id=$2 AND a.status='awaiting_deposit' ${identity.role === 'client' ? 'AND a.app_user_id=$3 AND a.case_id=$4' : ''}`,
      identity.role === 'client'
        ? [
            addressId,
            identity.organizationId,
            identity.actorId,
            identity.caseId,
          ]
        : [addressId, identity.organizationId],
    );
    if (!scoped[0])
      throw new NotFoundException('active deposit address not found');
    const assignment = scoped[0];
    if (
      assignment.network !== 'algorand_testnet' ||
      assignment.asset !== 'ALGO'
    )
      throw new BadRequestException('unsupported deposit network/asset');
    const transactions = await this.algorand.lookupIncomingPayments(
      assignment.deposit_address,
    );
    const credited: Row[] = [];
    for (const transaction of transactions) {
      credited.push(
        await this.verifyDeposit(
          addressId,
          { transaction_hash: transaction.transactionHash },
          identity,
        ),
      );
    }
    return credited;
  }

  async verifyDeposit(
    addressId: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    const scoped = await this.db.query(
      `SELECT a.*,t.currency FROM public.treasury_deposit_addresses a JOIN public.treasury_accounts t ON t.id=a.treasury_account_id WHERE a.id=$1 AND a.organization_id=$2 ${identity.role === 'client' ? 'AND a.app_user_id=$3 AND a.case_id=$4' : ''}`,
      identity.role === 'client'
        ? [
            addressId,
            identity.organizationId,
            identity.actorId,
            identity.caseId,
          ]
        : [addressId, identity.organizationId],
    );
    if (!scoped[0]) throw new NotFoundException('deposit address not found');
    const assignment = scoped[0];
    if (
      assignment.network !== 'algorand_testnet' ||
      assignment.asset !== 'ALGO'
    )
      throw new BadRequestException('unsupported deposit network/asset');
    const txid = this.text(
      body.transaction_hash,
      'transaction_hash',
    ).toUpperCase();
    const verified = await this.algorand.lookupTransaction(txid);
    if (verified.receiver !== assignment.deposit_address)
      throw new BadRequestException(
        'transaction destination does not match assigned address',
      );
    if (verified.assetId !== null)
      throw new BadRequestException('transaction asset does not match ALGO');
    if (!verified.amount || verified.amount <= 0)
      throw new BadRequestException('transaction amount is invalid');
    const amount = verified.amount / 1_000_000;
    const required = Number(
      this.config.get<string>('TREASURY_ALGORAND_CONFIRMATIONS') ?? '1',
    );
    if (!Number.isSafeInteger(required) || required < 1)
      throw new ServiceUnavailableException(
        'invalid Algorand confirmation policy',
      );
    // Algorand confirmed rounds are final under the configured Testnet policy;
    // a future poller may increase this count without changing ledger semantics.
    const confirmations = 1;
    if (confirmations < required)
      throw new ConflictException('deposit is still confirming');
    return this.db.transaction(async (manager) => {
      await manager.query(
        'SELECT id FROM public.treasury_deposit_addresses WHERE id=$1 FOR UPDATE',
        [addressId],
      );
      let deposits = await manager.query(
        `INSERT INTO public.treasury_chain_deposits(organization_id,deposit_address_id,treasury_account_id,network,asset,transaction_hash,sender_address,destination_address,amount,block_reference,confirmations,required_confirmations,status,verified_source,raw_payload,verified_at) VALUES($1,$2,$3,'algorand_testnet','ALGO',$4,$5,$6,$7,$8,$9,$10,'verified','algorand_indexer',$11::jsonb,now()) ON CONFLICT(network,transaction_hash,asset,output_index,destination_address) DO NOTHING RETURNING *`,
        [
          identity.organizationId,
          addressId,
          assignment.treasury_account_id,
          txid,
          verified.sender,
          verified.receiver,
          amount,
          verified.confirmedRound,
          confirmations,
          required,
          JSON.stringify(verified.rawPayload),
        ],
      );
      if (!deposits[0])
        deposits = await manager.query(
          `SELECT * FROM public.treasury_chain_deposits WHERE network='algorand_testnet' AND transaction_hash=$1 AND asset='ALGO' AND output_index=0 AND destination_address=$2 FOR UPDATE`,
          [txid, assignment.deposit_address],
        );
      const deposit = deposits[0];
      if (
        !deposit ||
        deposit.organization_id !== identity.organizationId ||
        deposit.deposit_address_id !== addressId
      )
        throw new ConflictException(
          'transaction already belongs to another deposit assignment',
        );
      if (deposit.status === 'credited') return deposit;
      const ledger = await manager.query(
        `INSERT INTO public.treasury_ledger_entries(organization_id,treasury_account_id,case_id,entry_type,amount,currency,reference,source_type,source_id,created_by) VALUES($1,$2,$3,'credit',$4,$5,$6,'blockchain_deposit',$7,$8) ON CONFLICT(treasury_account_id,reference) DO NOTHING RETURNING id`,
        [
          identity.organizationId,
          assignment.treasury_account_id,
          assignment.case_id,
          amount,
          assignment.currency,
          `CHAIN-DEPOSIT:${deposit.id}`,
          deposit.id,
          identity.actorId,
        ],
      );
      const ledgerId =
        ledger[0]?.id ??
        (
          await manager.query(
            `SELECT id FROM public.treasury_ledger_entries WHERE source_type='blockchain_deposit' AND source_id=$1`,
            [deposit.id],
          )
        )[0]?.id;
      if (!ledgerId)
        throw new ConflictException(
          'deposit ledger credit could not be claimed',
        );
      const updated =
        (
          await manager.query(
            `UPDATE public.treasury_chain_deposits SET status='credited',ledger_entry_id=$2,credited_at=now(),last_checked_at=now() WHERE id=$1 AND ledger_entry_id IS NULL RETURNING *`,
            [deposit.id, ledgerId],
          )
        )[0] ??
        (
          await manager.query(
            'SELECT * FROM public.treasury_chain_deposits WHERE id=$1',
            [deposit.id],
          )
        )[0];
      await this.audit(
        manager,
        identity,
        'treasury.deposit.credited',
        'treasury_chain_deposit',
        deposit.id,
        { transaction_hash: txid, ledger_entry_id: ledgerId },
      );
      return updated;
    });
  }

  async requestWithdrawal(
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    this.admin(identity);
    const accountId = this.text(
      body.treasury_account_id,
      'treasury_account_id',
    );
    const account = await this.account(accountId, identity);
    const network = this.text(body.network, 'network'),
      asset = this.text(body.asset, 'asset').toUpperCase();
    if (network !== 'algorand_testnet' || asset !== 'ALGO')
      throw new BadRequestException('unsupported withdrawal network/asset');
    const destination = this.text(
      body.destination_address,
      'destination_address',
    );
    this.algorand.publicKey(destination);
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new BadRequestException('amount must be positive');
    const reason = this.text(body.reason, 'reason'),
      reference = this.text(body.reference, 'reference');
    return this.db.transaction(async (manager) => {
      await manager.query(
        'SELECT id FROM public.treasury_accounts WHERE id=$1 FOR UPDATE',
        [accountId],
      );
      const sums = (
        await manager.query(
          `SELECT COALESCE(SUM(CASE WHEN entry_type IN ('credit','adjustment') THEN amount WHEN entry_type IN ('debit','release','allocation') THEN -amount ELSE 0 END),0)::numeric balance FROM public.treasury_ledger_entries WHERE treasury_account_id=$1`,
          [accountId],
        )
      )[0];
      const reserved = (
        await manager.query(
          `SELECT COALESCE(SUM(amount),0)::numeric reserved FROM public.treasury_chain_withdrawals WHERE treasury_account_id=$1 AND status IN ('approved','execution_pending','broadcast','confirming')`,
          [accountId],
        )
      )[0];
      if (Number(sums.balance) - Number(reserved.reserved) < amount)
        throw new BadRequestException(
          'insufficient confirmed available balance',
        );
      const blockers = await this.transactionGate(manager, account, identity);
      const status = blockers.length
        ? 'verification_required'
        : 'pending_approval';
      const rows = await manager.query(
        `INSERT INTO public.treasury_chain_withdrawals(organization_id,treasury_account_id,case_id,requested_by,network,asset,destination_address,amount,reason,reference,status,verification_blockers) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING *`,
        [
          identity.organizationId,
          accountId,
          account.case_id,
          identity.actorId,
          network,
          asset,
          destination,
          amount,
          reason,
          reference,
          status,
          JSON.stringify(blockers),
        ],
      );
      await this.audit(
        manager,
        identity,
        'treasury.withdrawal.requested',
        'treasury_chain_withdrawal',
        rows[0].id,
        { amount, asset, network, status, verification_blockers: blockers },
      );
      return rows[0];
    });
  }

  /** Transaction compliance integration point: identity KYC remains distinct
   * from transfer/account-document and transfer-authorization requirements. */
  private async transactionGate(
    manager: EntityManager,
    account: Row,
    identity: VerifiedIdentity,
  ): Promise<string[]> {
    const blockers: string[] = [];
    if (!account.case_id) {
      blockers.push('case_scope_required');
      return blockers;
    }
    const ownership = await manager.query(
      `SELECT id,client_id FROM public.cases WHERE id=$1 AND organization_id=$2`,
      [account.case_id, identity.organizationId],
    );
    if (!ownership[0]) blockers.push('case_ownership_invalid');
    const kyc = await manager.query(
      `SELECT status,expires_at FROM public.client_kyc WHERE organization_id=$1 AND client_id=$2`,
      [identity.organizationId, ownership[0]?.client_id ?? null],
    );
    if (
      !kyc[0] ||
      kyc[0].status !== 'verified' ||
      (kyc[0].expires_at && new Date(kyc[0].expires_at) <= new Date())
    )
      blockers.push('kyc_verification_required');
    const documents = await manager.query(
      `SELECT count(*)::int total,count(*) FILTER(WHERE status='verified')::int verified FROM public.transfer_document_requirements WHERE case_id=$1 AND organization_id=$2 AND is_active=true`,
      [account.case_id, identity.organizationId],
    );
    if (Number(documents[0]?.total ?? 0) > Number(documents[0]?.verified ?? 0))
      blockers.push('document_verification_required');
    const transfer = await manager.query(
      `SELECT 1 FROM public.case_transfers WHERE case_id=$1 AND organization_id=$2 AND status IN ('authorized','executed') LIMIT 1`,
      [account.case_id, identity.organizationId],
    );
    if (!transfer[0]) blockers.push('transfer_authorization_required');
    return blockers;
  }
  async approveWithdrawal(
    id: string,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    this.admin(identity);
    return this.db.transaction(async (manager) => {
      const rows = await manager.query(
        `SELECT * FROM public.treasury_chain_withdrawals WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [id, identity.organizationId],
      );
      const row = rows[0];
      if (!row) throw new NotFoundException('withdrawal not found');
      if (row.requested_by === identity.actorId)
        throw new ForbiddenException('requester cannot approve own withdrawal');
      if (row.status !== 'pending_approval')
        throw new ConflictException('withdrawal is not pending approval');
      await manager.query(
        'SELECT id FROM public.treasury_accounts WHERE id=$1 AND organization_id=$2 FOR UPDATE',
        [row.treasury_account_id, identity.organizationId],
      );
      const sums = (
        await manager.query(
          `SELECT COALESCE(SUM(CASE WHEN entry_type IN ('credit','adjustment') THEN amount WHEN entry_type IN ('debit','release','allocation') THEN -amount ELSE 0 END),0)::numeric balance FROM public.treasury_ledger_entries WHERE treasury_account_id=$1`,
          [row.treasury_account_id],
        )
      )[0];
      const reserved = (
        await manager.query(
          `SELECT COALESCE(SUM(amount),0)::numeric reserved FROM public.treasury_chain_withdrawals WHERE treasury_account_id=$1 AND id<>$2 AND status IN ('approved','execution_pending','broadcast','confirming')`,
          [row.treasury_account_id, id],
        )
      )[0];
      if (Number(sums.balance) - Number(reserved.reserved) < Number(row.amount))
        throw new BadRequestException(
          'insufficient confirmed available balance at approval',
        );
      const updated = (
        await manager.query(
          `UPDATE public.treasury_chain_withdrawals SET status='approved',approved_by=$2,approved_at=now(),reserved_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,
          [id, identity.actorId],
        )
      )[0];
      await this.audit(
        manager,
        identity,
        'treasury.withdrawal.approved',
        'treasury_chain_withdrawal',
        id,
        {},
      );
      return updated;
    });
  }
  async withdrawals(identity: VerifiedIdentity): Promise<Row[]> {
    this.admin(identity);
    return this.db.query(
      `SELECT * FROM public.treasury_chain_withdrawals WHERE organization_id=$1 ORDER BY created_at DESC`,
      [identity.organizationId],
    );
  }
  async executeWithdrawal(): Promise<never> {
    throw new ServiceUnavailableException(
      'Testnet custody signing provider is not configured; execution remains disabled',
    );
  }
}
