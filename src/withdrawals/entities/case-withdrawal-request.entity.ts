import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type WithdrawalRequestStatus =
  'pending_review' | 'needs_information' | 'approved' | 'rejected';

@Entity('case_withdrawal_requests')
export class CaseWithdrawalRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'case_id', type: 'uuid' })
  caseId: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId: string | null;

  @Column({ name: 'client_actor_id', type: 'uuid', nullable: true })
  clientActorId: string | null;

  @Column({ name: 'amount', type: 'numeric', precision: 18, scale: 2 })
  amount: string;

  @Column({ name: 'currency', type: 'text', default: 'USD' })
  currency: string;

  @Column({ name: 'requested_method', type: 'text', nullable: true })
  requestedMethod: string | null;

  @Column({ name: 'beneficiary_name', type: 'text', nullable: true })
  beneficiaryName: string | null;

  @Column({ name: 'account_number', type: 'text', nullable: true })
  accountNumber: string | null;

  @Column({ name: 'account_type', type: 'text', nullable: true })
  accountType: string | null;

  @Column({ name: 'routing_number', type: 'text', nullable: true })
  routingNumber: string | null;

  @Column({ name: 'client_note', type: 'text', nullable: true })
  clientNote: string | null;

  @Column({ name: 'status', type: 'text', default: 'pending_review' })
  status: WithdrawalRequestStatus;

  @Column({ name: 'admin_note', type: 'text', nullable: true })
  adminNote: string | null;

  @Column({ name: 'admin_reason', type: 'text', nullable: true })
  adminReason: string | null;

  @Column({ name: 'review_message', type: 'text', nullable: true })
  reviewMessage: string | null;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'rejected_by', type: 'uuid', nullable: true })
  rejectedBy: string | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt: Date | null;

  @Column({ name: 'info_requested_by', type: 'uuid', nullable: true })
  infoRequestedBy: string | null;

  @Column({ name: 'info_requested_at', type: 'timestamptz', nullable: true })
  infoRequestedAt: Date | null;

  @Column({ name: 'client_response', type: 'text', nullable: true })
  clientResponse: string | null;

  @Column({ name: 'responded_by', type: 'uuid', nullable: true })
  respondedBy: string | null;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

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
