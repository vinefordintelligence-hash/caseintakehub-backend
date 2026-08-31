/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { TransactionAuthorizationService } from './transaction-authorization.service';

describe('Transaction Authorization receiving-bank presentation', () => {
  const service = new TransactionAuthorizationService({} as never, {} as never);
  const present = (overrides: Record<string, unknown> = {}) =>
    (
      service as unknown as {
        present: (row: Record<string, unknown>, client: boolean) => any;
      }
    ).present(
      {
        id: 'review',
        case_id: 'case',
        status: 'PENDING_DOCUMENTATION',
        document_status: 'REQUESTED',
        payment_receipt_status: 'REQUESTED',
        authoritative_payment_id: null,
        accepted_document_type: 'DIVORCE_DOCUMENT',
        presented_transaction_amount: '114780.00',
        presented_transaction_currency: 'USD',
        presented_transaction_reference: null,
        presented_account_holder: 'Gayl M Chenoweth',
        presented_bank_name: 'Security Bank of the Ozarks',
        presented_account_type: null,
        presented_account_number: '0113382501',
        presented_routing_number: '081518605',
        presented_bank_verified: false,
        ...overrides,
      },
      true,
    );

  it('returns the authorized amount without fabricating reference or account type', () => {
    const result = present();
    expect(result.transaction).toMatchObject({
      amount: 114780,
      currency: 'USD',
      reference: null,
    });
    expect(result.receiving_bank.account_type).toBeNull();
  });

  it('never exposes full bank identifiers and does not infer verification', () => {
    const result = present();
    expect(result.receiving_bank).toMatchObject({
      account_holder: 'Gayl M Chenoweth',
      bank_name: 'Security Bank of the Ozarks',
      account_number: '******2501',
      routing_number: '*****8605',
      verification_status: 'NOT_VERIFIED',
    });
    expect(JSON.stringify(result)).not.toContain('0113382501');
    expect(JSON.stringify(result)).not.toContain('081518605');
  });

  it('preserves the divorce-document and fee gates', () => {
    const result = present();
    expect(result.accepted_document).toBe('DIVORCE_DOCUMENT');
    expect(result.document.status).toBe('REQUIRED');
    expect(result.fee.status).toBe('NOT_AVAILABLE');
    expect(result.status).toBe('PENDING_DOCUMENTATION');
  });
});
