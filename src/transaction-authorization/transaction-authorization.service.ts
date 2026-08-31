/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource, EntityManager } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

type Row = Record<string, any>;
type Payload = Record<string, unknown>;
const MAX_FILE = 8 * 1024 * 1024,
  MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const SUPPORTING_DOCUMENTS = {
  VOIDED_CHECK: {
    title: 'Voided Check',
    documentType: 'TRANSACTION_AUTHORIZATION_VOIDED_CHECK',
  },
  DIVORCE_DOCUMENT: {
    title: 'Divorce Document',
    documentType: 'TRANSACTION_AUTHORIZATION_DIVORCE_DOCUMENT',
  },
} as const;
const FINAL = ['APPROVED', 'REJECTED', 'CANCELLED'];
@Injectable()
export class TransactionAuthorizationService {
  private readonly feeAvailabilityDelayMs: number;
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {
    const configured = Number(
      this.config?.get?.('TAR_FEE_AVAILABILITY_DELAY_MS'),
    );
    this.feeAvailabilityDelayMs =
      Number.isFinite(configured) && configured >= 0
        ? Math.floor(configured)
        : 120000;
  }
  private feeDelay() {
    return `${this.feeAvailabilityDelayMs} milliseconds`;
  }
  private root() {
    return (
      this.config.get<string>('TRANSACTION_AUTH_PRIVATE_STORAGE_ROOT') ??
      '/opt/vineford/backend/private/transaction-authorization'
    );
  }
  private staff(i: VerifiedIdentity) {
    if (!['admin', 'super_admin', 'investigator', 'staff'].includes(i.role))
      throw new ForbiddenException('authorized staff access required');
  }
  private reviewer(i: VerifiedIdentity) {
    if (!['admin', 'super_admin'].includes(i.role))
      throw new ForbiddenException(
        'transaction authorization review requires an administrator',
      );
  }
  private async caseAccess(
    caseId: string,
    i: VerifiedIdentity,
    m: DataSource | EntityManager = this.db,
  ) {
    const rows = await m.query(
      `SELECT c.id,c.organization_id FROM public.cases c WHERE c.id=$1 AND c.organization_id=$2 ${i.role === 'client' ? 'AND c.id=$3' : ''}`,
      i.role === 'client'
        ? [caseId, i.organizationId, i.caseId]
        : [caseId, i.organizationId],
    );
    if (!rows[0]) throw new NotFoundException('case not found');
    return rows[0];
  }
  private async requireActiveGate(
    caseId: string,
    i: VerifiedIdentity,
    m: DataSource | EntityManager = this.db,
  ) {
    const rows = await m.query(
      `SELECT id FROM public.case_payments WHERE case_id=$1 AND organization_id=$2 AND gate_enabled=true AND blocks_progress=true`,
      [caseId, i.organizationId],
    );
    if (!rows[0])
      throw new ConflictException(
        'Transaction Authorization Review requires Payment Gate and Block Next Action to be enabled',
      );
  }
  private text(v: unknown, name: string, max = 500) {
    if (typeof v !== 'string' || !v.trim() || v.trim().length > max)
      throw new BadRequestException(`${name} is required`);
    return v.trim();
  }
  private async audit(
    m: DataSource | EntityManager,
    i: VerifiedIdentity,
    caseId: string,
    action: string,
    id: string,
    changes: Payload = {},
  ) {
    await m.query(
      `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,case_id,changes) VALUES($1,$2,$3,'transaction_authorization_review',$4,$5,$6::jsonb)`,
      [
        i.organizationId,
        i.actorId,
        action,
        id,
        caseId,
        JSON.stringify(changes),
      ],
    );
  }
  async create(caseId: string, body: Payload, i: VerifiedIdentity) {
    this.staff(i);
    await this.caseAccess(caseId, i);
    await this.requireActiveGate(caseId, i);
    const transferId =
      typeof body.transfer_id === 'string' ? body.transfer_id : null;
    if (transferId) {
      const transfer = await this.db.query(
        `SELECT id FROM public.case_transfers WHERE id=$1 AND case_id=$2 AND organization_id=$3`,
        [transferId, caseId, i.organizationId],
      );
      if (!transfer[0])
        throw new NotFoundException('scoped transaction not found');
    }
    const rows = await this.db.query(
      `INSERT INTO public.transaction_authorization_reviews(organization_id,case_id,transfer_id) VALUES($1,$2,$3) ON CONFLICT(case_id) DO NOTHING RETURNING id`,
      [i.organizationId, caseId, transferId],
    );
    if (!rows[0])
      throw new ConflictException(
        'transaction authorization review already exists',
      );
    await this.audit(
      this.db,
      i,
      caseId,
      'transaction_authorization.document.requested',
      rows[0].id,
      {},
    );
    return this.get(caseId, i);
  }
  async get(caseId: string, i: VerifiedIdentity) {
    await this.caseAccess(caseId, i);
    const rows = await this.db.query(
      `SELECT r.*,cp.enabled_at payment_gate_enabled_at,clock_timestamp() server_time,COALESCE(r.transaction_amount,t.amount) presented_transaction_amount,COALESCE(r.transaction_currency,t.currency) presented_transaction_currency,COALESCE(r.transaction_reference,t.transfer_reference) presented_transaction_reference,t.status transaction_status,COALESCE(r.receiving_account_holder,t.beneficiary_name) presented_account_holder,COALESCE(r.receiving_bank_name,t.receiving_institution_name) presented_bank_name,COALESCE(r.receiving_account_type,t.receiving_account_type) presented_account_type,COALESCE(r.receiving_account_number,t.receiving_account_number) presented_account_number,COALESCE(r.receiving_routing_number,t.receiving_institution_routing_number) presented_routing_number,COALESCE(r.receiving_bank_verified,t.receiving_details_verified,false) presented_bank_verified,cfg.payment_title,cfg.amount_usd,cfg.asset,cfg.network,cfg.payment_address FROM public.transaction_authorization_reviews r JOIN public.case_payments cp ON cp.case_id=r.case_id AND cp.organization_id=r.organization_id AND cp.gate_enabled=true AND cp.blocks_progress=true LEFT JOIN public.case_transfers t ON t.id=r.transfer_id AND t.case_id=r.case_id AND t.organization_id=r.organization_id CROSS JOIN public.transaction_authorization_payment_config cfg WHERE cfg.enabled=true AND r.supporting_verification_required=true AND r.case_id=$1 AND r.organization_id=$2 LIMIT 1`,
      [caseId, i.organizationId],
    );
    if (!rows[0]) return null;
    return this.present(rows[0], i.role === 'client');
  }
  private present(r: Row, client: boolean) {
    const verified = r.document_status === 'VERIFIED';
    const serverMs = new Date(r.server_time).getTime();
    const availabilityMs = r.next_payment_available_at
      ? new Date(r.next_payment_available_at).getTime()
      : null;
    const paymentAvailable = Boolean(
      verified && availabilityMs !== null && availabilityMs <= serverMs,
    );
    const remainingSeconds = Math.max(
      0,
      Math.ceil(((availabilityMs ?? serverMs) - serverMs) / 1000),
    );
    const paid =
      r.document_status === 'VERIFIED' &&
      r.payment_receipt_status === 'VERIFIED' &&
      Boolean(r.authoritative_payment_id);
    const status = FINAL.includes(r.status)
      ? r.status
      : paid
        ? 'UNDER_AUTHORIZATION_REVIEW'
        : r.document_status === 'VERIFIED'
          ? 'FEE_REQUIRED'
          : r.document_status === 'UNDER_REVIEW'
            ? 'DOCUMENT_UNDER_REVIEW'
            : r.document_status === 'UPLOADED'
              ? 'PENDING_DOCUMENTATION'
              : 'PENDING_DOCUMENTATION';
    const next =
      status === 'APPROVED'
        ? 'Transaction authorization approved.'
        : status === 'REJECTED' || status === 'CANCELLED'
          ? 'No client action is currently available.'
          : paid
            ? 'Transaction authorization review is in progress.'
            : r.payment_receipt_status === 'REJECTED' ||
                r.payment_receipt_status === 'REPLACEMENT_REQUESTED'
              ? 'Upload a replacement payment receipt.'
              : r.payment_receipt_status === 'UPLOADED' ||
                  r.payment_receipt_status === 'UNDER_REVIEW'
                ? 'Your payment is under review.'
                : paymentAvailable
                  ? 'Complete the $50 Transaction Authorization Review Fee.'
                  : verified
                    ? `Your supporting verification document has been verified; the $50 Transaction Authorization Review Fee becomes available in ${remainingSeconds} seconds.`
                    : r.document_status === 'REJECTED' ||
                        r.document_status === 'REPLACEMENT_REQUESTED'
                      ? 'Upload a replacement supporting verification document.'
                      : r.document_status === 'UNDER_REVIEW'
                        ? 'Your supporting verification document is under review.'
                        : r.document_status === 'UPLOADED'
                          ? 'Your supporting verification document has been submitted for review.'
                          : r.accepted_document_type === 'DIVORCE_DOCUMENT'
                            ? 'Upload the required divorce document to complete supporting verification before continuing the Transaction Authorization Review.'
                            : r.accepted_document_type === 'VOIDED_CHECK'
                              ? 'Upload a voided check for the receiving account to complete supporting verification before continuing the Transaction Authorization Review.'
                              : 'Upload an accepted document to complete supporting verification before continuing the Transaction Authorization Review.';
    return {
      id: r.id,
      case_id: r.case_id,
      supporting_verification_required: r.supporting_verification_required,
      accepted_document: r.accepted_document_type,
      enabled_at: r.payment_gate_enabled_at,
      server_time: r.server_time,
      status,
      transaction:
        r.presented_transaction_amount !== null
          ? {
              amount: Number(r.presented_transaction_amount),
              currency: r.presented_transaction_currency,
              reference: r.presented_transaction_reference,
              status: r.transaction_status,
            }
          : null,
      receiving_bank: {
        account_holder: r.presented_account_holder,
        bank_name: r.presented_bank_name,
        account_type: r.presented_account_type,
        account_number: this.mask(r.presented_account_number),
        routing_number: this.mask(r.presented_routing_number),
        verification_status: r.presented_bank_verified
          ? 'VERIFIED'
          : 'NOT_VERIFIED',
      },
      document: {
        type: r.supporting_document_type,
        title:
          SUPPORTING_DOCUMENTS[
            r.supporting_document_type as keyof typeof SUPPORTING_DOCUMENTS
          ]?.title ?? null,
        status:
          r.document_status === 'REQUESTED'
            ? 'REQUIRED'
            : r.document_status === 'REPLACEMENT_REQUESTED'
              ? 'REPLACEMENT_REQUIRED'
              : r.document_status,
        file_name: r.original_file_name,
        submitted_at: r.submitted_at,
        reviewed_at: r.reviewed_at,
        ...(!client ? { review_note: r.review_note } : {}),
      },
      fee: {
        title: 'Transaction Authorization Review Fee',
        amount: 50,
        currency: 'USD',
        available: paymentAvailable,
        status: paid
          ? 'VERIFIED'
          : ['UPLOADED', 'UNDER_REVIEW'].includes(r.payment_receipt_status)
            ? 'UNDER_REVIEW'
            : ['REJECTED', 'REPLACEMENT_REQUESTED'].includes(
                  r.payment_receipt_status,
                )
              ? r.payment_receipt_status
              : paymentAvailable
                ? 'REQUIRED'
                : 'NOT_AVAILABLE',
        message: paymentAvailable
          ? 'Your receiving-bank documentation has been verified. A $50 Transaction Authorization Review Fee is now required to continue the authorization review. Payment allows the review to proceed but does not guarantee transaction approval, transfer, release, or receipt of funds.'
          : null,
        instructions: paymentAvailable
          ? {
              asset: r.asset,
              network: r.network,
              address: r.payment_address,
              payment_reference: r.presented_transaction_reference,
              amount_label: '$50 USD equivalent in BTC',
              warning:
                'Send only Bitcoin (BTC) on Bitcoin Mainnet. Never share a private key or seed phrase. Payment does not guarantee transaction approval, release, recovery, transfer, or receipt of funds.',
            }
          : null,
      },
      payment_receipt: {
        type: 'TRANSACTION_AUTHORIZATION_PAYMENT_RECEIPT',
        status: r.payment_receipt_status,
        file_name: r.payment_receipt_file_name,
        txid: r.payment_txid,
        client_note: r.payment_client_note,
        submitted_at: r.payment_submitted_at,
        reviewed_at: r.payment_reviewed_at,
        ...(!client ? { review_note: r.payment_review_note } : {}),
      },
      transition: {
        document_verified_at: r.document_verified_at ?? null,
        next_payment_available_at: r.next_payment_available_at ?? null,
        remaining_seconds: remainingSeconds,
        payment_available: paymentAvailable,
      },
      next_required_action: next,
    };
  }
  private mask(value: unknown, visible = 4) {
    if (typeof value !== 'string' || !value) return null;
    const clean = value.replace(/\s/g, '');
    return `${'*'.repeat(Math.max(4, clean.length - visible))}${clean.slice(-visible)}`;
  }
  async upload(caseId: string, body: Payload, i: VerifiedIdentity) {
    if (i.role !== 'client')
      throw new ForbiddenException('client portal session required');
    await this.caseAccess(caseId, i);
    await this.requireActiveGate(caseId, i);
    const row = (
      await this.db.query(
        `SELECT * FROM public.transaction_authorization_reviews WHERE case_id=$1 AND organization_id=$2`,
        [caseId, i.organizationId],
      )
    )[0];
    if (!row)
      throw new NotFoundException('transaction authorization review not found');
    if (!row.supporting_verification_required)
      throw new ConflictException('supporting verification is not required');
    if (
      !['REQUESTED', 'REJECTED', 'REPLACEMENT_REQUESTED', 'UPLOADED'].includes(
        row.document_status,
      )
    )
      throw new ConflictException(
        'supporting verification document is not accepting a replacement',
      );
    const selectedType = this.text(
      body.document_type,
      'document_type',
      40,
    ).toUpperCase() as keyof typeof SUPPORTING_DOCUMENTS;
    const selected = SUPPORTING_DOCUMENTS[selectedType];
    if (!selected)
      throw new BadRequestException(
        'document_type must be VOIDED_CHECK or DIVORCE_DOCUMENT',
      );
    if (
      row.accepted_document_type !== 'EITHER' &&
      row.accepted_document_type !== selectedType
    )
      throw new BadRequestException(
        `this payment gate accepts only ${row.accepted_document_type}`,
      );
    const mime = this.text(body.mime_type, 'mime_type', 100).toLowerCase();
    if (!MIME.includes(mime))
      throw new BadRequestException(
        'only PDF, JPEG, or PNG documents are accepted',
      );
    const name = this.text(body.file_name, 'file_name', 255).replace(
        /[\r\n]/g,
        ' ',
      ),
      encoded = this.text(body.content_base64, 'content_base64', 12_000_000);
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > MAX_FILE || !this.magic(bytes, mime))
      throw new BadRequestException(
        'invalid or unsupported supporting verification document',
      );
    const key = `${i.organizationId}/${caseId}/${randomUUID()}`,
      path = join(this.root(), key);
    await mkdir(join(this.root(), i.organizationId, caseId), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    try {
      await this.db.transaction(async (m) => {
        const doc = (
          await m.query(
            `INSERT INTO public.documents(case_id,organization_id,title,document_type,file_url,file_name,file_size,document_status,is_client_visible,uploaded_by,uploaded_at,mime_type,metadata) VALUES($1,$2,$3,$4,NULL,$5,$6,'submitted',false,$7,now(),$8,$9::jsonb) RETURNING id`,
            [
              caseId,
              i.organizationId,
              selected.title,
              selected.documentType,
              name,
              bytes.length,
              i.actorId,
              mime,
              JSON.stringify({
                transaction_authorization_review_id: row.id,
                supporting_document_type: selectedType,
                private_storage: true,
              }),
            ],
          )
        )[0];
        await m.query(
          `UPDATE public.transaction_authorization_reviews SET supporting_document_type=$3,current_document_id=$4,storage_key=$5,original_file_name=$6,mime_type=$7,file_size=$8,file_sha256=$9,document_status='UPLOADED',status='PENDING_DOCUMENTATION',submitted_at=now(),submitted_by=$10,reviewed_at=NULL,reviewed_by=NULL,review_note=NULL,fee_activated_at=NULL,document_verified_at=NULL,next_payment_available_at=NULL,updated_at=now() WHERE case_id=$1 AND organization_id=$2`,
          [
            caseId,
            i.organizationId,
            selectedType,
            doc.id,
            key,
            name,
            mime,
            bytes.length,
            createHash('sha256').update(bytes).digest('hex'),
            i.actorId,
          ],
        );
        await this.audit(
          m,
          i,
          caseId,
          'transaction_authorization.supporting_document.submitted',
          row.id,
          {
            document_id: doc.id,
            document_type: selectedType,
            file_name: name,
            file_size: bytes.length,
          },
        );
      });
    } catch (e) {
      await unlink(path).catch(() => undefined);
      throw e;
    }
    return this.get(caseId, i);
  }
  async review(caseId: string, body: Payload, i: VerifiedIdentity) {
    this.reviewer(i);
    await this.caseAccess(caseId, i);
    await this.requireActiveGate(caseId, i);
    const requestedOutcome = this.text(body.status, 'status', 40).toUpperCase();
    const outcome =
      requestedOutcome === 'REPLACEMENT_REQUIRED'
        ? 'REPLACEMENT_REQUESTED'
        : requestedOutcome;
    if (
      ![
        'UNDER_REVIEW',
        'VERIFIED',
        'REJECTED',
        'REPLACEMENT_REQUESTED',
        'NOTE',
      ].includes(outcome)
    )
      throw new BadRequestException('invalid document review status');
    const note =
      typeof body.note === 'string'
        ? body.note.trim().slice(0, 2000) || null
        : null;
    if (['REJECTED', 'REPLACEMENT_REQUESTED'].includes(outcome) && !note)
      throw new BadRequestException('a review note is required');
    return this.db.transaction(async (m) => {
      const row = (
        await m.query(
          `SELECT * FROM public.transaction_authorization_reviews WHERE case_id=$1 AND organization_id=$2 FOR UPDATE`,
          [caseId, i.organizationId],
        )
      )[0];
      if (!row?.current_document_id)
        throw new ConflictException(
          'no supporting verification document has been submitted',
        );
      if (!['UPLOADED', 'UNDER_REVIEW'].includes(row.document_status))
        throw new ConflictException(
          'supporting verification document is not reviewable',
        );
      if (outcome === 'NOTE') {
        if (!note) throw new BadRequestException('a review note is required');
        await m.query(
          `UPDATE public.transaction_authorization_reviews SET reviewed_at=now(),reviewed_by=$3,review_note=$4,updated_at=now() WHERE case_id=$1 AND organization_id=$2`,
          [caseId, i.organizationId, i.actorId, note],
        );
        await this.audit(
          m,
          i,
          caseId,
          'transaction_authorization.supporting_document.note_added',
          row.id,
          { document_id: row.current_document_id, note },
        );
        return this.get(caseId, i);
      }
      const status =
        outcome === 'VERIFIED'
          ? 'FEE_REQUIRED'
          : outcome === 'UNDER_REVIEW'
            ? 'DOCUMENT_UNDER_REVIEW'
            : 'PENDING_DOCUMENTATION';
      await m.query(
        `UPDATE public.transaction_authorization_reviews SET document_status=$3,status=$4,reviewed_at=now(),reviewed_by=$5,review_note=$6,fee_activated_at=CASE WHEN $3='VERIFIED' THEN now() ELSE NULL END,document_verified_at=CASE WHEN $3='VERIFIED' THEN now() ELSE NULL END,next_payment_available_at=CASE WHEN $3='VERIFIED' THEN now()+$7::interval ELSE NULL END,updated_at=now() WHERE case_id=$1 AND organization_id=$2`,
        [
          caseId,
          i.organizationId,
          outcome,
          status,
          i.actorId,
          note,
          this.feeDelay(),
        ],
      );
      await m.query(
        `UPDATE public.documents SET document_status=$3,updated_at=now() WHERE id=$1 AND organization_id=$2`,
        [
          row.current_document_id,
          i.organizationId,
          outcome === 'REPLACEMENT_REQUESTED'
            ? 'needs_information'
            : outcome.toLowerCase(),
        ],
      );
      if (outcome === 'VERIFIED' && !row.authoritative_invoice_id) {
        const c = (
          await m.query(
            `SELECT client_id FROM public.cases WHERE id=$1 AND organization_id=$2`,
            [caseId, i.organizationId],
          )
        )[0];
        const invoice = (
          await m.query(
            `INSERT INTO public.invoices(organization_id,client_id,case_id,invoice_number,amount,status,due_date) VALUES($1,$2,$3,$4,50,'sent',current_date) RETURNING id`,
            [
              i.organizationId,
              c.client_id,
              caseId,
              `TAR-${randomUUID().slice(0, 12).toUpperCase()}`,
            ],
          )
        )[0];
        await m.query(
          `UPDATE public.transaction_authorization_reviews SET authoritative_invoice_id=$3 WHERE case_id=$1 AND organization_id=$2`,
          [caseId, i.organizationId, invoice.id],
        );
        await m.query(
          `UPDATE public.case_payments SET status='required',amount=50,currency='USD',payment_title='Transaction Authorization Review Fee',payment_description='Supporting verification document verified. External BTC payment proof requires Admin verification.',invoice_id=$3,client_visible=true,updated_by=$4,updated_at=now() WHERE case_id=$1 AND organization_id=$2 AND gate_enabled=true AND blocks_progress=true`,
          [caseId, i.organizationId, invoice.id, i.actorId],
        );
        await this.audit(
          m,
          i,
          caseId,
          'transaction_authorization.fee.invoice_created',
          row.id,
          { invoice_id: invoice.id, amount: 50, currency: 'USD' },
        );
      }
      await this.audit(
        m,
        i,
        caseId,
        `transaction_authorization.supporting_document.${outcome.toLowerCase()}`,
        row.id,
        { document_id: row.current_document_id, note },
      );
      if (outcome === 'VERIFIED')
        await this.audit(
          m,
          i,
          caseId,
          'transaction_authorization.fee.activated',
          row.id,
          { amount: 50, currency: 'USD' },
        );
      return this.get(caseId, i);
    });
  }
  async authorize(caseId: string, body: Payload, i: VerifiedIdentity) {
    this.reviewer(i);
    const target = this.text(body.status, 'status', 50).toUpperCase();
    if (!FINAL.includes(target))
      throw new BadRequestException('invalid final authorization status');
    return this.db.transaction(async (m) => {
      const view = await this.get(caseId, i);
      if (!view)
        throw new NotFoundException(
          'transaction authorization review not found',
        );
      if (target === 'APPROVED' && view.status !== 'UNDER_AUTHORIZATION_REVIEW')
        throw new ConflictException(
          'verified documentation and authoritative payment are required before approval',
        );
      const rows = await m.query(
        `UPDATE public.transaction_authorization_reviews SET status=$3,updated_at=now() WHERE case_id=$1 AND organization_id=$2 RETURNING id`,
        [caseId, i.organizationId, target],
      );
      await this.audit(
        m,
        i,
        caseId,
        `transaction_authorization.${target.toLowerCase()}`,
        rows[0].id,
        {},
      );
      return this.get(caseId, i);
    });
  }
  async uploadPaymentReceipt(
    caseId: string,
    body: Payload,
    i: VerifiedIdentity,
  ) {
    if (i.role !== 'client')
      throw new ForbiddenException('client portal session required');
    await this.caseAccess(caseId, i);
    await this.requireActiveGate(caseId, i);
    const row = (
      await this.db.query(
        `SELECT r.*,clock_timestamp() server_time,cfg.payment_address FROM public.transaction_authorization_reviews r CROSS JOIN public.transaction_authorization_payment_config cfg WHERE cfg.enabled=true AND r.case_id=$1 AND r.organization_id=$2`,
        [caseId, i.organizationId],
      )
    )[0];
    if (!row)
      throw new NotFoundException('transaction authorization review not found');
    const feeAvailableForPayment =
      row.next_payment_available_at !== null &&
      row.next_payment_available_at !== undefined &&
      new Date(row.next_payment_available_at).getTime() <=
        new Date(row.server_time).getTime();
    if (!feeAvailableForPayment || !row.authoritative_invoice_id)
      throw new ConflictException(
        'the $50 Transaction Authorization Review Fee is not yet available for payment; document verification and fee availability are required before payment proof',
      );
    if (
      !['REQUESTED', 'REJECTED', 'REPLACEMENT_REQUESTED', 'UPLOADED'].includes(
        row.payment_receipt_status,
      )
    )
      throw new ConflictException(
        'payment receipt is not accepting a replacement',
      );
    if (!this.validBitcoinMainnetAddress(row.payment_address))
      throw new ConflictException(
        'configured Bitcoin destination failed checksum validation',
      );
    const txid = this.text(body.txid, 'txid', 64).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(txid))
      throw new BadRequestException(
        'Bitcoin transaction ID must be 64 hexadecimal characters',
      );
    const mime = this.text(body.mime_type, 'mime_type', 100).toLowerCase();
    if (!MIME.includes(mime))
      throw new BadRequestException(
        'only PDF, JPEG, or PNG receipts are accepted',
      );
    const name = this.text(body.file_name, 'file_name', 255).replace(
        /[\r\n]/g,
        ' ',
      ),
      encoded = this.text(body.content_base64, 'content_base64', 12_000_000),
      bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > MAX_FILE || !this.magic(bytes, mime))
      throw new BadRequestException(
        'invalid or unsupported payment receipt file',
      );
    const note =
      typeof body.client_note === 'string'
        ? body.client_note.trim().slice(0, 2000) || null
        : null;
    const key = `${i.organizationId}/${caseId}/payment/${randomUUID()}`,
      path = join(this.root(), key);
    await mkdir(join(this.root(), i.organizationId, caseId, 'payment'), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    try {
      await this.db.transaction(async (m) => {
        const doc = (
          await m.query(
            `INSERT INTO public.documents(case_id,organization_id,title,document_type,file_url,file_name,file_size,document_status,is_client_visible,uploaded_by,uploaded_at,mime_type,metadata) VALUES($1,$2,'Transaction Authorization Payment Receipt','TRANSACTION_AUTHORIZATION_PAYMENT_RECEIPT',NULL,$3,$4,'submitted',false,$5,now(),$6,$7::jsonb) RETURNING id`,
            [
              caseId,
              i.organizationId,
              name,
              bytes.length,
              i.actorId,
              mime,
              JSON.stringify({
                transaction_authorization_review_id: row.id,
                payment_requirement: true,
                private_storage: true,
              }),
            ],
          )
        )[0];
        await m.query(
          `UPDATE public.transaction_authorization_reviews SET payment_receipt_document_id=$3,payment_receipt_storage_key=$4,payment_receipt_file_name=$5,payment_receipt_mime_type=$6,payment_receipt_file_size=$7,payment_receipt_sha256=$8,payment_txid=$9,payment_client_note=$10,payment_receipt_status='UPLOADED',payment_submitted_at=now(),payment_submitted_by=$11,payment_reviewed_at=NULL,payment_reviewed_by=NULL,payment_review_note=NULL,authoritative_payment_id=NULL,updated_at=now() WHERE case_id=$1 AND organization_id=$2`,
          [
            caseId,
            i.organizationId,
            doc.id,
            key,
            name,
            mime,
            bytes.length,
            createHash('sha256').update(bytes).digest('hex'),
            txid,
            note,
            i.actorId,
          ],
        );
        await this.audit(
          m,
          i,
          caseId,
          'transaction_authorization.payment_receipt.submitted',
          row.id,
          { document_id: doc.id, txid, file_size: bytes.length },
        );
      });
    } catch (e) {
      await unlink(path).catch(() => undefined);
      throw e;
    }
    return this.get(caseId, i);
  }
  async reviewPaymentReceipt(
    caseId: string,
    body: Payload,
    i: VerifiedIdentity,
  ) {
    this.reviewer(i);
    await this.caseAccess(caseId, i);
    await this.requireActiveGate(caseId, i);
    const outcome = this.text(body.status, 'status', 40).toUpperCase();
    if (
      ![
        'UNDER_REVIEW',
        'VERIFIED',
        'REJECTED',
        'REPLACEMENT_REQUESTED',
      ].includes(outcome)
    )
      throw new BadRequestException('invalid payment review status');
    const note =
      typeof body.note === 'string'
        ? body.note.trim().slice(0, 2000) || null
        : null;
    if (['REJECTED', 'REPLACEMENT_REQUESTED'].includes(outcome) && !note)
      throw new BadRequestException('a review note is required');
    return this.db.transaction(async (m) => {
      const row = (
        await m.query(
          `SELECT * FROM public.transaction_authorization_reviews WHERE case_id=$1 AND organization_id=$2 FOR UPDATE`,
          [caseId, i.organizationId],
        )
      )[0];
      if (!row?.payment_receipt_document_id || !row.payment_txid)
        throw new ConflictException('no payment proof has been submitted');
      if (
        row.document_status !== 'VERIFIED' ||
        !['UPLOADED', 'UNDER_REVIEW'].includes(row.payment_receipt_status)
      )
        throw new ConflictException('payment proof is not reviewable');
      let paymentId: null | string = null;
      if (outcome === 'VERIFIED') {
        const conflict = (
          await m.query(
            `SELECT payment_title FROM public.case_payments WHERE case_id=$1 AND organization_id=$2`,
            [caseId, i.organizationId],
          )
        )[0];
        if (
          conflict &&
          conflict.payment_title &&
          conflict.payment_title !== 'Transaction Authorization Review Fee'
        )
          throw new ConflictException(
            'case has a different active payment requirement',
          );
        const duplicate = await m.query(
          `SELECT id FROM public.payments WHERE organization_id=$1 AND reference_number=$2`,
          [i.organizationId, row.payment_txid],
        );
        if (duplicate[0])
          throw new ConflictException(
            'Bitcoin transaction ID is already recorded',
          );
        paymentId = (
          await m.query(
            `INSERT INTO public.payments(organization_id,invoice_id,amount,payment_method,reference_number,verification_status,verified_by,verified_at,verification_note,proof_reference,proof_document_id) VALUES($1,$2,50,'Bitcoin (BTC)',$3,'verified',$4,now(),$5,$3,$6) RETURNING id`,
            [
              i.organizationId,
              row.authoritative_invoice_id,
              row.payment_txid,
              i.actorId,
              note,
              row.payment_receipt_document_id,
            ],
          )
        )[0].id;
        const gate = await m.query(
          `UPDATE public.case_payments SET status='paid',amount=50,currency='USD',payment_method='Bitcoin (BTC)',invoice_id=$3,reference_number=$4,payment_title='Transaction Authorization Review Fee',payment_description='Verified external BTC payment proof.',blocks_progress=false,gate_enabled=false,client_visible=true,updated_by=$5,updated_at=now() WHERE case_id=$1 AND organization_id=$2 AND gate_enabled=true AND blocks_progress=true RETURNING id`,
          [
            caseId,
            i.organizationId,
            row.authoritative_invoice_id,
            row.payment_txid,
            i.actorId,
          ],
        );
        if (!gate[0])
          throw new ConflictException(
            'active blocking payment gate is required',
          );
      }
      await m.query(
        `UPDATE public.transaction_authorization_reviews SET payment_receipt_status=$3,payment_reviewed_at=now(),payment_reviewed_by=$4,payment_review_note=$5,authoritative_payment_id=COALESCE($6,authoritative_payment_id),status=CASE WHEN $3='VERIFIED' THEN 'UNDER_AUTHORIZATION_REVIEW' ELSE status END,authorization_started_at=CASE WHEN $3='VERIFIED' THEN now() ELSE authorization_started_at END,updated_at=now() WHERE case_id=$1 AND organization_id=$2`,
        [caseId, i.organizationId, outcome, i.actorId, note, paymentId],
      );
      await m.query(
        `UPDATE public.documents SET document_status=$3,updated_at=now() WHERE id=$1 AND organization_id=$2`,
        [
          row.payment_receipt_document_id,
          i.organizationId,
          outcome.toLowerCase(),
        ],
      );
      await this.audit(
        m,
        i,
        caseId,
        `transaction_authorization.payment_receipt.${outcome.toLowerCase()}`,
        row.id,
        {
          document_id: row.payment_receipt_document_id,
          txid: row.payment_txid,
          payment_id: paymentId,
          note,
        },
      );
      if (outcome === 'VERIFIED')
        await m.query(
          `SELECT public.vf_append_event($1,$2,'Transaction Authorization Review Payment Verified','The $50 Transaction Authorization Review Fee payment was authoritatively verified. Normal case progression is no longer blocked by this payment gate.','PAYMENT','VERIFIED',$3,true,NULL,NULL,50,'USD',NULL,NULL,$4::jsonb,now())`,
          [
            caseId,
            i.organizationId,
            i.actorId,
            JSON.stringify({
              source: 'transaction_authorization_review',
              payment_id: paymentId,
            }),
          ],
        );
      return this.get(caseId, i);
    });
  }
  async downloadPaymentReceipt(caseId: string, i: VerifiedIdentity) {
    await this.caseAccess(caseId, i);
    const r = (
      await this.db.query(
        `SELECT payment_receipt_storage_key storage_key,payment_receipt_file_name file_name,payment_receipt_mime_type mime_type,id FROM public.transaction_authorization_reviews WHERE case_id=$1 AND organization_id=$2`,
        [caseId, i.organizationId],
      )
    )[0];
    if (!r?.storage_key)
      throw new NotFoundException('payment receipt not found');
    const file = await readFile(join(this.root(), r.storage_key)).catch(() => {
      throw new NotFoundException('payment receipt content not found');
    });
    await this.audit(
      this.db,
      i,
      caseId,
      'transaction_authorization.payment_receipt.accessed',
      r.id,
      {},
    );
    return {
      file,
      fileName: String(r.file_name).replace(/["\r\n]/g, '_'),
      mimeType: r.mime_type,
    };
  }
  async download(caseId: string, i: VerifiedIdentity) {
    await this.caseAccess(caseId, i);
    const rows = await this.db.query(
      `SELECT storage_key,original_file_name,mime_type,id FROM public.transaction_authorization_reviews WHERE case_id=$1 AND organization_id=$2`,
      [caseId, i.organizationId],
    );
    if (!rows[0]?.storage_key)
      throw new NotFoundException('supporting verification document not found');
    const file = await readFile(join(this.root(), rows[0].storage_key)).catch(
      () => {
        throw new NotFoundException(
          'supporting verification document content not found',
        );
      },
    );
    await this.audit(
      this.db,
      i,
      caseId,
      'transaction_authorization.supporting_document.accessed',
      rows[0].id,
      {},
    );
    return {
      file,
      fileName: String(rows[0].original_file_name).replace(/["\r\n]/g, '_'),
      mimeType: rows[0].mime_type,
    };
  }
  private magic(b: Buffer, m: string) {
    if (m === 'application/pdf') return b.subarray(0, 5).toString() === '%PDF-';
    if (m === 'image/png')
      return b
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    return (
      b[0] === 0xff &&
      b[1] === 0xd8 &&
      b[b.length - 2] === 0xff &&
      b[b.length - 1] === 0xd9
    );
  }
  private validBitcoinMainnetAddress(address: unknown) {
    if (
      typeof address !== 'string' ||
      address !== address.toLowerCase() ||
      !address.startsWith('bc1')
    )
      return false;
    const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l',
      separator = address.lastIndexOf('1');
    const data = [...address.slice(separator + 1)].map((char) =>
      alphabet.indexOf(char),
    );
    if (data.some((value) => value < 0)) return false;
    const values: number[] = [];
    for (const char of address.slice(0, separator))
      values.push(char.charCodeAt(0) >> 5);
    values.push(0);
    for (const char of address.slice(0, separator))
      values.push(char.charCodeAt(0) & 31);
    values.push(...data);
    let checksum = 1;
    for (const value of values) {
      const top = checksum >>> 25;
      checksum = ((checksum & 0x1ffffff) << 5) ^ value;
      for (let bit = 0; bit < 5; bit++)
        if ((top >>> bit) & 1)
          checksum ^= [
            0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
          ][bit];
    }
    return checksum >>> 0 === 1;
  }
}
