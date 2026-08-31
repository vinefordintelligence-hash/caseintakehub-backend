import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type ClientPortalAccessGateState = {
  configured: boolean;
  locked: boolean;
  supporting_verification_status: string;
  specific_payment_requirement_status: string;
};

@Injectable()
export class ClientPortalAccessGateService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async state(
    caseId: string,
    organizationId: string,
  ): Promise<ClientPortalAccessGateState> {
    const row = (
      await this.db.query(
        `SELECT r.supporting_verification_required,r.document_status,r.payment_receipt_status,r.authoritative_payment_id,cp.id payment_gate_id,cp.status payment_gate_status,cp.amount,cp.currency,cp.payment_title,cp.invoice_id,EXISTS(SELECT 1 FROM public.payments p JOIN public.invoices i ON i.id=p.invoice_id AND i.organization_id=p.organization_id WHERE p.id=r.authoritative_payment_id AND p.organization_id=r.organization_id AND p.invoice_id=cp.invoice_id AND p.verification_status='verified' AND p.amount=50 AND cp.amount=50 AND upper(cp.currency)='USD' AND i.case_id=r.case_id AND i.amount=50) specific_payment_verified FROM public.transaction_authorization_reviews r LEFT JOIN public.case_payments cp ON cp.case_id=r.case_id AND cp.organization_id=r.organization_id WHERE r.case_id=$1 AND r.organization_id=$2`,
        [caseId, organizationId],
      )
    )[0] as Record<string, unknown> | undefined;
    const configured = Boolean(
      row?.supporting_verification_required &&
      row.payment_gate_id &&
      row.payment_title === 'Transaction Authorization Review Fee' &&
      Number(row.amount) === 50 &&
      String(row.currency).toUpperCase() === 'USD',
    );
    const documentVerified = row?.document_status === 'VERIFIED';
    const paymentVerified = Boolean(row?.specific_payment_verified);
    return {
      configured,
      locked: configured && !(documentVerified && paymentVerified),
      supporting_verification_status: this.documentStatus(row?.document_status),
      specific_payment_requirement_status: paymentVerified
        ? 'VERIFIED'
        : documentVerified
          ? 'PAYMENT_REQUIRED'
          : 'LOCKED',
    };
  }

  private documentStatus(value: unknown): string {
    if (value === 'REQUESTED') return 'REQUIRED';
    if (value === 'REPLACEMENT_REQUESTED') return 'REPLACEMENT_REQUIRED';
    return typeof value === 'string' ? value : 'NOT_REQUIRED';
  }
}
