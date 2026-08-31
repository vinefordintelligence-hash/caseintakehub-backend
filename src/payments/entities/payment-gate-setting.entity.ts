import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('payment_gate_settings')
export class PaymentGateSetting {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ name: 'client_visible', type: 'boolean', default: false })
  clientVisible: boolean;

  @Column({ name: 'payment_title', type: 'text', nullable: true })
  paymentTitle: string | null;

  @Column({ name: 'payment_description', type: 'text', nullable: true })
  paymentDescription: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true })
  amount: string | null;

  @Column({ type: 'text', default: 'USD' })
  currency: string;

  @Column({ name: 'payment_methods', type: 'jsonb', default: () => "'[]'" })
  paymentMethods: string[];

  @Column({ name: 'due_date_behavior', type: 'jsonb', default: () => "'{}'" })
  dueDateBehavior: Record<string, unknown>;

  @Column({
    name: 'invoice_reference_behavior',
    type: 'jsonb',
    default: () => "'{}'",
  })
  invoiceReferenceBehavior: Record<string, unknown>;

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
