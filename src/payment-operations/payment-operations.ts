export const PAYMENT_OPERATION_STATES = [
  'DRAFT',
  'AUTHORIZED',
  'ISSUED',
  'PENDING',
  'PROCESSING',
  'PARTIALLY_PAID',
  'VERIFIED',
  'MANUAL_REVIEW',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'DISPUTED',
  'DISPUTE_RESOLVED',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;

export type PaymentOperationState = (typeof PAYMENT_OPERATION_STATES)[number];

export const TERMINAL_PAYMENT_OPERATION_STATES = new Set<PaymentOperationState>(
  ['EXPIRED', 'CANCELLED', 'REFUNDED'],
);

export const PAYMENT_OPERATION_OWNERS = [
  'CASE',
  'INVOICE',
  'DOCUMENT_SERVICE',
  'INVESTIGATION_SERVICE',
  'FIELD_OPERATION',
  'SURVEILLANCE_OPERATION',
  'REPORT_SERVICE',
  'OTHER_APPROVED_SERVICE',
] as const;

export type PaymentOperationOwner = (typeof PAYMENT_OPERATION_OWNERS)[number];

const transitions: Readonly<
  Record<PaymentOperationState, readonly PaymentOperationState[]>
> = {
  DRAFT: ['AUTHORIZED', 'CANCELLED'],
  AUTHORIZED: ['ISSUED', 'CANCELLED', 'EXPIRED'],
  ISSUED: [
    'PENDING',
    'PROCESSING',
    'PARTIALLY_PAID',
    'VERIFIED',
    'MANUAL_REVIEW',
    'CANCELLED',
    'EXPIRED',
  ],
  PENDING: [
    'PROCESSING',
    'PARTIALLY_PAID',
    'VERIFIED',
    'MANUAL_REVIEW',
    'CANCELLED',
    'EXPIRED',
  ],
  PROCESSING: [
    'PARTIALLY_PAID',
    'VERIFIED',
    'MANUAL_REVIEW',
    'FAILED',
    'CANCELLED',
  ],
  PARTIALLY_PAID: [
    'PROCESSING',
    'VERIFIED',
    'MANUAL_REVIEW',
    'DISPUTED',
    'EXPIRED',
  ],
  VERIFIED: ['DISPUTED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'],
  MANUAL_REVIEW: [
    'PROCESSING',
    'PARTIALLY_PAID',
    'VERIFIED',
    'FAILED',
    'CANCELLED',
  ],
  FAILED: ['PROCESSING', 'MANUAL_REVIEW', 'CANCELLED'],
  EXPIRED: [],
  CANCELLED: [],
  DISPUTED: ['MANUAL_REVIEW', 'DISPUTE_RESOLVED', 'REFUND_PENDING'],
  DISPUTE_RESOLVED: [
    'VERIFIED',
    'REFUND_PENDING',
    'PARTIALLY_REFUNDED',
    'REFUNDED',
  ],
  REFUND_PENDING: ['PARTIALLY_REFUNDED', 'REFUNDED', 'MANUAL_REVIEW'],
  PARTIALLY_REFUNDED: ['REFUND_PENDING', 'REFUNDED', 'DISPUTED'],
  REFUNDED: [],
};

export function canTransition(
  from: PaymentOperationState,
  to: PaymentOperationState,
): boolean {
  return transitions[from]?.includes(to) ?? false;
}

export function operationEventType(state: PaymentOperationState): string {
  return `PAYMENT_OPERATION_${state}`;
}
