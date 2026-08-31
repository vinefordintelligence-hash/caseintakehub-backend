import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type CasePaymentStatus =
  | 'not_required'
  | 'required'
  | 'pending'
  | 'received'
  | 'failed'
  | 'cancelled'
  | 'waived'
  | 'paid';

@Entity('case_payments')
export class CasePayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'case_id', type: 'uuid' })
  caseId: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId: string | null;

  @Column({ type: 'text', default: 'not_required' })
  status: CasePaymentStatus;

  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true })
  amount: string | null;

  @Column({ type: 'text', default: 'USD' })
  currency: string;

  @Column({ name: 'payment_method', type: 'text', nullable: true })
  paymentMethod: string | null;

  @Column({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId: string | null;

  @Column({ name: 'reference_number', type: 'text', nullable: true })
  referenceNumber: string | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ name: 'client_visible', type: 'boolean', default: false })
  clientVisible: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @Column({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
