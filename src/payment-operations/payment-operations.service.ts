/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-base-to-string, @typescript-eslint/restrict-template-expressions */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { WorkflowEngineService } from '../workflow-engine/workflow-engine.service';
import { FeeConfigurationService } from '../fee-configuration/fee-configuration.service';
import {
  canTransition,
  PaymentOperationOwner,
  PaymentOperationState,
} from './payment-operations';

type Row = Record<string, unknown>;
const ADMINS = new Set(['admin', 'super_admin']);
const MONEY = /^\d{1,18}(\.\d{1,2})?$/;

@Injectable()
export class PaymentOperationsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly workflow: WorkflowEngineService,
    private readonly feeConfig: FeeConfigurationService,
  ) {}

  async createRequirement(
    input: Row,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    this.requireAdmin(identity);
    let amount = this.money(input.amount, 'amount');
    const currency = this.currency(input.currency);
    const caseId = this.uuid(input.caseId, 'caseId');
    const owner = this.owner(input.originatingModule);
    const description = this.text(input.description, 'description', 500);
    const purpose = this.text(input.businessPurpose, 'businessPurpose', 120);
    const idempotencyKey = this.text(
      input.idempotencyKey,
      'idempotencyKey',
      200,
    );

    let feeSnapshot: any = null;
    if (input.feeDefinitionId) {
      const defId = this.uuid(input.feeDefinitionId, 'feeDefinitionId');
      feeSnapshot = await this.feeConfig.calculate(defId, amount);
      amount = feeSnapshot.total;
    }

    const fingerprint = this.fingerprint({
      caseId,
      amount,
      currency,
      owner,
      description,
      purpose,
      invoiceId: input.invoiceId ?? null,
      feeDefinitionId: input.feeDefinitionId ?? null,
    });
    return this.db.transaction(async (m) => {
      const existing = (
        await m.query(
          `SELECT * FROM public.payment_operations
           WHERE organization_id=$1 AND idempotency_key=$2 FOR UPDATE`,
          [identity.organizationId, idempotencyKey],
        )
      )[0];
      if (existing) {
        if (existing.request_fingerprint !== fingerprint)
          throw new ConflictException('payment operation idempotency conflict');
        return existing;
      }
      const caseRow = (
        await m.query(
          `SELECT id,client_id FROM public.cases
           WHERE id=$1 AND organization_id=$2`,
          [caseId, identity.organizationId],
        )
      )[0];
      if (!caseRow) throw new NotFoundException('case not found');
      const invoiceId =
        input.invoiceId == null
          ? null
          : this.uuid(input.invoiceId, 'invoiceId');
      if (invoiceId) {
        const invoice = (
          await m.query(
            `SELECT id FROM public.invoices
             WHERE id=$1 AND case_id=$2 AND organization_id=$3`,
            [invoiceId, caseId, identity.organizationId],
          )
        )[0];
        if (!invoice) throw new NotFoundException('invoice not found');
      }
      const row = (
        await m.query(
          `INSERT INTO public.payment_operations
           (organization_id,case_id,client_id,invoice_id,operation_reference,
            business_purpose,description,currency,authorized_amount,amount_paid,
            amount_remaining,payment_terms,due_at,state,originating_module,
            originating_record_id,created_by,correlation_id,idempotency_key,
            request_fingerprint,generation)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$9,$10,$11,'DRAFT',$12,$13,$14,$15,$16,$17,1)
           RETURNING *`,
          [
            identity.organizationId,
            caseId,
            caseRow.client_id,
            invoiceId,
            `PO-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
            purpose,
            description,
            currency,
            amount,
            input.paymentTerms == null
              ? null
              : this.text(input.paymentTerms, 'paymentTerms', 200),
            input.dueAt == null ? null : new Date(String(input.dueAt)),
            owner,
            input.originatingRecordId == null
              ? null
              : this.text(
                  input.originatingRecordId,
                  'originatingRecordId',
                  200,
                ),
            identity.actorId,
            input.correlationId == null
              ? randomUUID()
              : this.uuid(input.correlationId, 'correlationId'),
            idempotencyKey,
            fingerprint,
          ],
        )
      )[0];

      if (feeSnapshot) {
        await this.feeConfig.createSnapshot(
          row.id,
          input.feeDefinitionId as string,
          input.amount as string,
          m,
        );
      }

      await this.audit(
        m,
        identity,
        row,
        null,
        'DRAFT',
        'PAYMENT_OPERATION_CREATED',
      );
      await this.createInstallmentPlan(m, row, input.installments);
      await this.publish(m, row, 'PAYMENT_REQUIREMENT_CREATED', identity);
      return row;
    });
  }

  authorize(id: string, identity: VerifiedIdentity, reason: string) {
    return this.transition(
      id,
      identity,
      'AUTHORIZED',
      this.text(reason, 'authorizationReason', 500),
      'PAYMENT_REQUIREMENT_AUTHORIZED',
    );
  }

  issue(id: string, identity: VerifiedIdentity) {
    return this.transition(
      id,
      identity,
      'ISSUED',
      'ADMIN_ISSUED',
      'PAYMENT_REQUIREMENT_ISSUED',
    );
  }

  cancel(id: string, identity: VerifiedIdentity, reason: string) {
    return this.transition(
      id,
      identity,
      'CANCELLED',
      this.text(reason, 'reason', 500),
      'PAYMENT_REQUIREMENT_CANCELLED',
    );
  }

  expire(id: string, identity: VerifiedIdentity) {
    return this.transition(
      id,
      identity,
      'EXPIRED',
      'ADMIN_EXPIRED',
      'PAYMENT_REQUIREMENT_EXPIRED',
    );
  }

  markDisputed(id: string, identity: VerifiedIdentity, reason: string) {
    return this.transition(
      id,
      identity,
      'DISPUTED',
      this.text(reason, 'reason', 500),
      'PAYMENT_OPERATION_DISPUTED',
    );
  }

  resolveDispute(id: string, identity: VerifiedIdentity, reason: string) {
    return this.transition(
      id,
      identity,
      'DISPUTE_RESOLVED',
      this.text(reason, 'reason', 500),
      'PAYMENT_OPERATION_DISPUTE_RESOLVED',
    );
  }

  recordRefundState(
    id: string,
    identity: VerifiedIdentity,
    state: 'REFUND_PENDING' | 'PARTIALLY_REFUNDED' | 'REFUNDED',
    reason: string,
    refundedAmount?: string,
  ) {
    this.requireAdmin(identity);
    return this.db.transaction(async (m) => {
      const current = await this.lockOperation(m, id, identity);
      if (
        ![
          'VERIFIED',
          'DISPUTED',
          'DISPUTE_RESOLVED',
          'REFUND_PENDING',
          'PARTIALLY_REFUNDED',
        ].includes(String(current.state))
      )
        throw new ConflictException(
          'refund state is not valid for this operation',
        );
      const amount = refundedAmount ?? String(current.refunded_amount ?? '0');
      const updated = (
        await m.query(
          `UPDATE public.payment_operations
           SET state=$3,refunded_amount=$4::numeric,generation=generation+1,
               last_reason=$5,updated_at=now()
           WHERE id=$1 AND organization_id=$2 AND generation=$6
             AND $4::numeric >= 0 AND $4::numeric <= amount_paid
           RETURNING *`,
          [
            id,
            identity.organizationId,
            state,
            amount,
            reason,
            current.generation,
          ],
        )
      )[0];
      if (!updated)
        throw new ConflictException(
          'invalid refund amount or stale generation',
        );
      const locked = await this.lockOperation(m, id, identity);
      await this.audit(
        m,
        identity,
        locked,
        String(current.state),
        state,
        `PAYMENT_OPERATION_${state}`,
      );
      await this.publish(m, locked, `PAYMENT_OPERATION_${state}`, identity);
      return locked;
    });
  }

  @Interval(60_000)
  async processExpirations(limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException('expiration limit is invalid');
    return this.db.transaction(async (m) => {
      const rows = await m.query(
        `SELECT * FROM public.payment_operations
         WHERE due_at IS NOT NULL AND due_at<=now()
           AND state IN ('AUTHORIZED','ISSUED','PENDING','PROCESSING','PARTIALLY_PAID')
         ORDER BY due_at,id FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit],
      );
      let count = 0;
      for (const current of rows as Row[]) {
        const updated = await this.updateState(
          m,
          current,
          {
            actorId: '00000000-0000-4000-8000-000000000000',
            organizationId: String(current.organization_id),
            role: 'admin',
            supabaseUserId: 'payment-operations-expiration-worker',
          },
          'EXPIRED',
          'PAYMENT_OPERATION_EXPIRED',
        );
        await this.audit(
          m,
          {
            actorId: '00000000-0000-4000-8000-000000000000',
            organizationId: String(current.organization_id),
            role: 'admin',
            supabaseUserId: 'payment-operations-expiration-worker',
          },
          updated,
          String(current.state),
          'EXPIRED',
          'PAYMENT_REQUIREMENT_EXPIRED',
        );
        await this.publish(m, updated, 'PAYMENT_REQUIREMENT_EXPIRED', {
          actorId: '00000000-0000-4000-8000-000000000000',
          organizationId: String(current.organization_id),
          role: 'admin',
          supabaseUserId: 'payment-operations-expiration-worker',
        });
        count++;
      }
      await m.query(
        `UPDATE public.payment_operation_installments
         SET status='OVERDUE',generation=generation+1,updated_at=now()
         WHERE due_at<=now() AND status IN ('PENDING','PARTIALLY_PAID')`,
      );
      return count;
    });
  }

  async recordAuthoritativePayment(
    id: string,
    paymentId: string,
    identity: VerifiedIdentity,
    manager?: EntityManager,
  ) {
    this.requireAdmin(identity);
    const apply = (m: EntityManager) =>
      this.recordAuthoritativePaymentInTransaction(m, id, paymentId, identity);
    return manager ? apply(manager) : this.db.transaction(apply);
  }

  private async recordAuthoritativePaymentInTransaction(
    m: EntityManager,
    id: string,
    paymentId: string,
    identity: VerifiedIdentity,
  ) {
    const operation = await this.lockOperation(m, id, identity);
    const linked = (
      await m.query(
        `SELECT 1 FROM public.payment_operation_payments
         WHERE operation_id=$1 AND payment_id=$2`,
        [id, paymentId],
      )
    )[0];
    if (linked) return operation;
    if (
      ![
        'AUTHORIZED',
        'ISSUED',
        'PENDING',
        'PROCESSING',
        'PARTIALLY_PAID',
        'MANUAL_REVIEW',
      ].includes(String(operation.state))
    )
      throw new ConflictException(
        'payment operation cannot accept payment in its current state',
      );
    const payment = (
      await m.query(
        `SELECT p.id,p.invoice_id,p.organization_id,p.amount::text AS amount,
                  p.verification_status,p.reference_number
           FROM public.payments p
           WHERE p.id=$1 AND p.organization_id=$2`,
        [paymentId, identity.organizationId],
      )
    )[0];
    if (!payment) throw new NotFoundException('payment not found');
    if (payment.verification_status !== 'verified')
      throw new ConflictException('authoritative verified payment required');
    if (!operation.invoice_id || payment.invoice_id !== operation.invoice_id)
      return this.manualReview(
        m,
        operation,
        identity,
        'PAYMENT_OPERATION_PAYMENT_LINKAGE_MISMATCH',
      );
    await this.allocateToInstallments(
      m,
      operation,
      paymentId,
      String(payment.amount),
    );
    await m.query(
      `INSERT INTO public.payment_operation_payments
         (organization_id,operation_id,payment_id,amount,currency,reference_number)
         VALUES($1,$2,$3,$4,$5,$6)`,
      [
        identity.organizationId,
        id,
        paymentId,
        payment.amount,
        operation.currency,
        payment.reference_number ?? null,
      ],
    );
    const totals = (
      await m.query(
        `SELECT COALESCE(sum(amount),0)::text AS paid
           FROM public.payment_operation_payments
           WHERE organization_id=$1 AND operation_id=$2`,
        [identity.organizationId, id],
      )
    )[0];
    const comparison = await m.query(
      `SELECT
           ($1::numeric > authorized_amount) AS overpaid,
           ($1::numeric = authorized_amount) AS complete
         FROM public.payment_operations WHERE id=$2 AND organization_id=$3`,
      [totals.paid, id, identity.organizationId],
    );
    if (comparison[0].overpaid) {
      await this.setManualReview(
        m,
        operation,
        identity,
        'PAYMENT_OPERATION_OVERPAYMENT',
      );
      return this.lockOperation(m, id, identity);
    }

    const next: PaymentOperationState = comparison[0].complete
      ? 'VERIFIED'
      : 'PARTIALLY_PAID';
    const updated = await this.updateState(
      m,
      operation,
      identity,
      next,
      'AUTHORITATIVE_RECONCILIATION',
      totals.paid,
    );
    await this.publish(
      m,
      updated,
      next === 'VERIFIED' ? 'PAYMENT_VERIFIED' : 'PAYMENT_PARTIALLY_VERIFIED',
      identity,
    );
    return updated;
  }

  async reconcileAuthoritativeInvoice(
    invoiceId: string,
    identity: VerifiedIdentity,
    manager?: EntityManager,
  ): Promise<number> {
    if (!['admin', 'super_admin', 'financial_analyst'].includes(identity.role))
      throw new ForbiddenException('financial reconciliation access denied');
    const executor = manager ?? this.db;
    const operations = await executor.query(
      `SELECT o.id
       FROM public.payment_operations o
       WHERE o.organization_id=$1 AND o.invoice_id=$2
         AND o.state IN
           ('AUTHORIZED','ISSUED','PENDING','PROCESSING','PARTIALLY_PAID')
       ORDER BY o.id`,
      [identity.organizationId, invoiceId],
    );
    if (operations.length !== 1) {
      if (operations.length > 1) {
        const markAmbiguous = async (m: EntityManager) => {
          for (const row of operations as Row[]) {
            const operation = await this.lockOperation(m, String(row.id), {
              ...identity,
              role: identity.role === 'super_admin' ? 'super_admin' : 'admin',
            });
            await this.setManualReview(
              m,
              operation,
              {
                ...identity,
                role: identity.role === 'super_admin' ? 'super_admin' : 'admin',
              },
              'PAYMENT_OPERATION_AMBIGUOUS_INVOICE_MATCH',
            );
          }
        };
        if (manager) await markAmbiguous(manager);
        else await this.db.transaction(markAmbiguous);
      }
      return 0;
    }
    const rows = await executor.query(
      `SELECT id FROM public.payments
       WHERE organization_id=$1 AND invoice_id=$2
         AND verification_status='verified'
       ORDER BY id`,
      [identity.organizationId, invoiceId],
    );
    let applied = 0;
    for (const row of rows as Row[]) {
      const applyIdentity = {
        ...identity,
        role: identity.role === 'super_admin' ? 'super_admin' : 'admin',
      };
      if (manager)
        await this.recordAuthoritativePaymentInTransaction(
          manager,
          String(operations[0].id),
          String(row.id),
          applyIdentity,
        );
      else
        await this.recordAuthoritativePayment(
          String(operations[0].id),
          String(row.id),
          applyIdentity,
        );
      applied++;
    }
    return applied;
  }

  async getRequirement(id: string, identity: VerifiedIdentity) {
    const row = (
      await this.db.query(
        `SELECT * FROM public.payment_operations
         WHERE id=$1 AND organization_id=$2`,
        [id, identity.organizationId],
      )
    )[0];
    if (!row) throw new NotFoundException('payment operation not found');
    if (identity.role === 'client' && row.client_id !== identity.actorId)
      throw new ForbiddenException('payment operation access denied');
    return row;
  }

  async listForCase(caseId: string, identity: VerifiedIdentity) {
    if (identity.role === 'client' && identity.caseId !== caseId)
      throw new ForbiddenException('payment operation access denied');
    return this.db.query(
      `SELECT id,operation_reference,description,currency,authorized_amount,
              amount_paid,amount_remaining,payment_terms,due_at,state,
              originating_module,generation,created_at,updated_at
       FROM public.payment_operations
       WHERE case_id=$1 AND organization_id=$2
       ORDER BY created_at DESC`,
      [caseId, identity.organizationId],
    );
  }

  private async transition(
    id: string,
    identity: VerifiedIdentity,
    next: PaymentOperationState,
    reason: string,
    eventType: string,
  ) {
    this.requireAdmin(identity);
    return this.db.transaction(async (m) => {
      const current = await this.lockOperation(m, id, identity);
      const from = current.state as PaymentOperationState;
      if (from === next) return current;
      if (!canTransition(from, next))
        throw new ConflictException(
          `illegal payment operation transition: ${from} -> ${next}`,
        );
      const updated = await this.updateState(
        m,
        current,
        identity,
        next,
        reason,
      );
      await this.audit(m, identity, updated, from, next, eventType);
      await this.publish(m, updated, eventType, identity);
      return updated;
    });
  }

  private async updateState(
    m: EntityManager,
    current: Row,
    identity: VerifiedIdentity,
    next: PaymentOperationState,
    reason: string,
    paid?: string,
  ) {
    if (
      !canTransition(current.state as PaymentOperationState, next) &&
      current.state !== next
    )
      throw new ConflictException(
        `illegal payment operation transition: ${current.state} -> ${next}`,
      );
    const result = (
      await m.query(
        `UPDATE public.payment_operations
         SET state=$4,amount_paid=COALESCE($5::numeric,amount_paid),
             amount_remaining=authorized_amount-COALESCE($5::numeric,amount_paid),
             generation=generation+1,updated_at=now(),
             last_reason=$6,authorized_by=CASE WHEN $4='AUTHORIZED' THEN $3 ELSE authorized_by END,
             authorization_reason=CASE WHEN $4='AUTHORIZED' THEN $6 ELSE authorization_reason END
         WHERE id=$1 AND organization_id=$2 AND generation=$7
         RETURNING *`,
        [
          current.id,
          identity.organizationId,
          identity.actorId,
          next,
          paid ?? null,
          reason,
          current.generation,
        ],
      )
    )[0];
    if (!result)
      throw new ConflictException('stale payment operation generation');
    return this.lockOperation(m, String(current.id), identity);
  }

  private async setManualReview(
    m: EntityManager,
    current: Row,
    identity: VerifiedIdentity,
    reason: string,
  ) {
    const updated = await this.updateState(
      m,
      current,
      identity,
      'MANUAL_REVIEW',
      reason,
    );
    await this.audit(
      m,
      identity,
      updated,
      current.state as string,
      'MANUAL_REVIEW',
      'PAYMENT_MANUAL_REVIEW_REQUIRED',
    );
    await this.publish(m, updated, 'PAYMENT_MANUAL_REVIEW_REQUIRED', identity);
  }

  private async createInstallmentPlan(
    m: EntityManager,
    operation: Row,
    raw: unknown,
  ) {
    if (raw === undefined || raw === null) return;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 60)
      throw new BadRequestException('installments are invalid');
    await m.query(
      `INSERT INTO public.payment_operation_installment_plans
       (organization_id,operation_id,total_amount,currency)
       VALUES($1,$2,$3,$4)`,
      [
        operation.organization_id,
        operation.id,
        operation.authorized_amount,
        operation.currency,
      ],
    );
    const plan = (
      await m.query(
        `SELECT id FROM public.payment_operation_installment_plans
         WHERE organization_id=$1 AND operation_id=$2`,
        [operation.organization_id, operation.id],
      )
    )[0];
    for (let index = 0; index < raw.length; index++) {
      const item = raw[index] as Row;
      const amount = this.money(item.amount, `installments[${index}].amount`);
      const dueAt = new Date(String(item.dueAt ?? ''));
      if (!Number.isFinite(dueAt.getTime()))
        throw new BadRequestException(
          `installments[${index}].dueAt is invalid`,
        );
      await m.query(
        `INSERT INTO public.payment_operation_installments
         (organization_id,plan_id,operation_id,sequence,amount,amount_remaining,due_at,status)
         VALUES($1,$2,$3,$4,$5,$5,$6,'PENDING')`,
        [
          operation.organization_id,
          plan.id,
          operation.id,
          index + 1,
          amount,
          dueAt,
        ],
      );
    }
    const total = (
      await m.query(
        `SELECT sum(amount)::numeric(20,2)=
           (SELECT authorized_amount FROM public.payment_operations WHERE id=$1) AS matches
         FROM public.payment_operation_installments WHERE operation_id=$1`,
        [operation.id],
      )
    )[0];
    if (!total.matches)
      throw new BadRequestException(
        'installments must equal authorized amount',
      );
  }

  private async allocateToInstallments(
    m: EntityManager,
    operation: Row,
    paymentId: string,
    paymentAmount: string,
  ) {
    const plan = (
      await m.query(
        `SELECT id FROM public.payment_operation_installment_plans
         WHERE organization_id=$1 AND operation_id=$2`,
        [operation.organization_id, operation.id],
      )
    )[0];
    if (!plan) return;
    const installments = await m.query(
      `SELECT id,amount_remaining FROM public.payment_operation_installments
       WHERE organization_id=$1 AND operation_id=$2 AND status<>'CANCELLED'
       ORDER BY due_at,sequence,id FOR UPDATE`,
      [operation.organization_id, operation.id],
    );
    for (const installment of installments as Row[]) {
      const available = (
        await m.query(
          `SELECT $1::numeric-COALESCE(sum(amount),0)::numeric AS amount
           FROM public.payment_operation_installment_allocations
           WHERE organization_id=$2 AND operation_id=$3 AND payment_id=$4`,
          [paymentAmount, operation.organization_id, operation.id, paymentId],
        )
      )[0];
      const allocation = (
        await m.query(`SELECT LEAST($1::numeric,$2::numeric) AS amount`, [
          available.amount,
          installment.amount_remaining,
        ])
      )[0];
      if (Number(allocation.amount) <= 0) continue;
      await m.query(
        `INSERT INTO public.payment_operation_installment_allocations
         (organization_id,operation_id,installment_id,payment_id,amount)
         VALUES($1,$2,$3,$4,$5::numeric) ON CONFLICT DO NOTHING`,
        [
          operation.organization_id,
          operation.id,
          installment.id,
          paymentId,
          allocation.amount,
        ],
      );
      await m.query(
        `UPDATE public.payment_operation_installments
         SET amount_paid=amount_paid+$2::numeric,
             amount_remaining=amount_remaining-$2::numeric,
             status=CASE WHEN amount_remaining-$2::numeric=0 THEN 'SATISFIED' ELSE 'PARTIALLY_PAID' END,
             generation=generation+1,updated_at=now()
         WHERE id=$1 AND organization_id=$3`,
        [installment.id, allocation.amount, operation.organization_id],
      );
    }
  }

  private manualReview(
    m: EntityManager,
    operation: Row,
    identity: VerifiedIdentity,
    reason: string,
  ) {
    return this.setManualReview(m, operation, identity, reason).then(() =>
      this.lockOperation(m, String(operation.id), identity),
    );
  }

  private async lockOperation(
    m: EntityManager,
    id: string,
    identity: VerifiedIdentity,
  ) {
    const row = (
      await m.query(
        `SELECT * FROM public.payment_operations
         WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [id, identity.organizationId],
      )
    )[0];
    if (!row) throw new NotFoundException('payment operation not found');
    return row as Row;
  }

  private async publish(
    m: EntityManager,
    row: Row,
    eventType: string,
    identity: VerifiedIdentity,
  ) {
    const accepted = await this.workflow.publish(
      {
        eventId: randomUUID(),
        eventType,
        organizationId: String(row.organization_id),
        caseId: String(row.case_id),
        actorId: identity.actorId,
        actorType: 'admin',
        entityType: 'payment_operation',
        entityId: String(row.id),
        occurredAt: new Date(),
        correlationId: String(row.correlation_id),
        metadata: {
          paymentOperationId: String(row.id),
          state: String(row.state),
          generation: Number(row.generation),
        },
      },
      m,
    );
    if (!accepted)
      throw new ConflictException('payment operation event duplicate');
  }

  private async audit(
    m: EntityManager,
    identity: VerifiedIdentity,
    row: Row,
    previous: string | null,
    next: string,
    action: string,
  ) {
    await m.query(
      `INSERT INTO public.audit_logs
       (organization_id,user_id,action,resource_type,resource_id,case_id,changes)
       VALUES($1,$2,$3,'payment_operation',$4,$5,$6::jsonb)`,
      [
        identity.organizationId,
        identity.actorId,
        action,
        row.id,
        row.case_id,
        JSON.stringify({
          previousState: previous,
          newState: next,
          generation: row.generation,
          correlationId: row.correlation_id,
          reason: row.last_reason ?? null,
        }),
      ],
    );
  }

  private requireAdmin(identity: VerifiedIdentity) {
    if (!ADMINS.has(identity.role))
      throw new ForbiddenException('administrator access required');
  }

  private text(value: unknown, field: string, max: number) {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
      throw new BadRequestException(`${field} is invalid`);
    return value.trim();
  }

  private uuid(value: unknown, field: string) {
    const text = this.text(value, field, 80);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        text,
      )
    )
      throw new BadRequestException(`${field} is invalid`);
    return text;
  }

  private money(value: unknown, field: string) {
    const text =
      typeof value === 'number' ? value.toFixed(2) : String(value ?? '');
    if (!MONEY.test(text) || Number(text) <= 0)
      throw new BadRequestException(`${field} is invalid`);
    return text;
  }

  private currency(value: unknown) {
    const currency = String(value ?? '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency))
      throw new BadRequestException('currency is invalid');
    return currency;
  }

  private owner(value: unknown): PaymentOperationOwner {
    const owner = String(value ?? '');
    if (
      ![
        'CASE',
        'INVOICE',
        'DOCUMENT_SERVICE',
        'INVESTIGATION_SERVICE',
        'FIELD_OPERATION',
        'SURVEILLANCE_OPERATION',
        'REPORT_SERVICE',
        'OTHER_APPROVED_SERVICE',
      ].includes(owner)
    )
      throw new BadRequestException('originatingModule is invalid');
    return owner as PaymentOperationOwner;
  }

  private fingerprint(value: Row) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}
