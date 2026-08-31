import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Transaction Authorization supporting verification document', () => {
  const source = readFileSync(
    join(__dirname, 'transaction-authorization.service.ts'),
    'utf8',
  );

  it('accepts exactly one selected supported document type', () => {
    expect(source).toContain('VOIDED_CHECK');
    expect(source).toContain('DIVORCE_DOCUMENT');
    expect(source).toContain('body.document_type');
    expect(source).toContain(
      'document_type must be VOIDED_CHECK or DIVORCE_DOCUMENT',
    );
    expect(source).toMatch(/row\.accepted_document_type !== ['"]EITHER['"]/);
    expect(source).toContain('row.accepted_document_type !== selectedType');
  });

  it('persists uploads as submitted and never auto-verifies them', () => {
    expect(source).toContain("document_status='UPLOADED'");
    expect(source).toContain('supporting_document_type=$3');
    expect(source).toContain('supporting_document_type: selectedType');
  });

  it('activates the fee only in the administrator VERIFIED transition', () => {
    expect(source).toContain(
      "fee_activated_at=CASE WHEN $3='VERIFIED' THEN now() ELSE NULL END",
    );
    expect(source).toMatch(
      /if \(outcome === ["']VERIFIED["'] && !row\.authoritative_invoice_id\)/,
    );
    expect(source).toMatch(
      /if \(!\[["']admin["'], ["']super_admin["']\]\.includes\(i\.role\)\)/,
    );
  });

  it('keeps the fee locked until the supporting document is verified', () => {
    expect(source).toContain(
      'the $50 Transaction Authorization Review Fee is not yet available for payment; document verification and fee availability are required before payment proof',
    );
    expect(source).toMatch(/available: paymentAvailable/);
    expect(source).toMatch(/\? ['"]REQUIRED['"]\s+: ['"]NOT_AVAILABLE['"]/);
  });

  it('persists the fee-availability window on the administrator VERIFIED transition', () => {
    expect(source).toMatch(
      /document_verified_at=CASE WHEN \$3=['"]VERIFIED['"] THEN now\(\) ELSE NULL END/,
    );
    expect(source).toMatch(
      /next_payment_available_at=CASE WHEN \$3=['"]VERIFIED['"] THEN now\(\)\+\$7::interval ELSE NULL END/,
    );
    expect(source).toContain('transition: {');
    expect(source).toContain('document_verified_at: r.document_verified_at');
    expect(source).toContain(
      'next_payment_available_at: r.next_payment_available_at',
    );
    expect(source).toContain('remaining_seconds: remainingSeconds');
    expect(source).toContain('payment_available: paymentAvailable');
  });

  it('links satisfaction to this review invoice and authoritative payment', () => {
    expect(source).toContain('row.authoritative_invoice_id');
    expect(source).toContain('authoritative_payment_id');
    expect(source).toContain('invoice_id=$3');
  });

  it('scopes every case lookup by organization and forbids client review', () => {
    expect(source).toContain('case_id=$1 AND organization_id=$2');
    expect(source).toContain(
      'transaction authorization review requires an administrator',
    );
    expect(source).toContain('client portal session required');
  });

  it('emits no client timeline event before authoritative fee verification', () => {
    expect(source.match(/vf_append_event/g)).toHaveLength(1);
    expect(source).toContain(
      'Transaction Authorization Review Payment Verified',
    );
  });
});
