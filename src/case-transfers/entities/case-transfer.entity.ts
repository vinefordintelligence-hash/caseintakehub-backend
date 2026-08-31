import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type TransferStatus =
  | 'prepared'
  | 'under_review'
  | 'verified'
  | 'authorized'
  | 'executed'
  | 'rejected'
  | 'cancelled';
export type TransferMode = 'demo' | 'sandbox' | 'live';

@Entity('case_transfers')
export class CaseTransfer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'case_id', type: 'uuid' })
  caseId: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'transfer_reference', type: 'text' })
  transferReference: string;

  @Column({ name: 'amount', type: 'numeric', precision: 18, scale: 2 })
  amount: string;

  @Column({ name: 'currency', type: 'text', default: 'USD' })
  currency: string;

  @Column({
    name: 'mode',
    type: 'enum',
    enum: ['demo', 'sandbox', 'live'],
    default: 'demo',
  })
  mode: TransferMode;

  @Column({
    name: 'status',
    type: 'enum',
    enum: [
      'prepared',
      'under_review',
      'verified',
      'authorized',
      'executed',
      'rejected',
      'cancelled',
    ],
    default: 'prepared',
  })
  status: TransferStatus;

  @Column({
    name: 'prepared_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  preparedAt: Date;

  @Column({ name: 'prepared_by', type: 'uuid', nullable: true })
  preparedBy: string | null;

  @Column({ name: 'receiving_institution_name', type: 'text', nullable: true })
  receivingInstitutionName: string | null;

  @Column({
    name: 'receiving_institution_branch',
    type: 'text',
    nullable: true,
  })
  receivingInstitutionBranch: string | null;

  @Column({ name: 'receiving_institution_city', type: 'text', nullable: true })
  receivingInstitutionCity: string | null;

  @Column({
    name: 'receiving_institution_country',
    type: 'text',
    nullable: true,
  })
  receivingInstitutionCountry: string | null;

  @Column({ name: 'receiving_institution_swift', type: 'text', nullable: true })
  receivingInstitutionSwift: string | null;

  @Column({
    name: 'receiving_institution_routing_number',
    type: 'text',
    nullable: true,
  })
  receivingInstitutionRoutingNumber: string | null;

  @Column({ name: 'receiving_account_number', type: 'text', nullable: true })
  receivingAccountNumber: string | null;

  @Column({ name: 'receiving_account_type', type: 'text', nullable: true })
  receivingAccountType: string | null;

  @Column({ name: 'beneficiary_name', type: 'text', nullable: true })
  beneficiaryName: string | null;

  @Column({ name: 'beneficiary_legal_name', type: 'text', nullable: true })
  beneficiaryLegalName: string | null;

  @Column({ name: 'beneficiary_email', type: 'text', nullable: true })
  beneficiaryEmail: string | null;

  @Column({ name: 'beneficiary_phone', type: 'text', nullable: true })
  beneficiaryPhone: string | null;

  @Column({ name: 'beneficiary_id_type', type: 'text', nullable: true })
  beneficiaryIdType: string | null;

  @Column({ name: 'beneficiary_id_number', type: 'text', nullable: true })
  beneficiaryIdNumber: string | null;

  @Column({
    name: 'receiving_details_verified',
    type: 'boolean',
    default: false,
  })
  receivingDetailsVerified: boolean;

  @Column({
    name: 'receiving_details_verified_at',
    type: 'timestamptz',
    nullable: true,
  })
  receivingDetailsVerifiedAt: Date | null;

  @Column({
    name: 'receiving_details_verified_by',
    type: 'uuid',
    nullable: true,
  })
  receivingDetailsVerifiedBy: string | null;

  @Column({
    name: 'receiving_details_verification_note',
    type: 'text',
    nullable: true,
  })
  receivingDetailsVerificationNote: string | null;

  @Column({ name: 'acceptance_verified', type: 'boolean', default: false })
  acceptanceVerified: boolean;

  @Column({
    name: 'acceptance_verified_at',
    type: 'timestamptz',
    nullable: true,
  })
  acceptanceVerifiedAt: Date | null;

  @Column({ name: 'acceptance_verified_by', type: 'uuid', nullable: true })
  acceptanceVerifiedBy: string | null;

  @Column({
    name: 'acceptance_verification_note',
    type: 'text',
    nullable: true,
  })
  acceptanceVerificationNote: string | null;

  @Column({ name: 'execution_confirmed', type: 'boolean', default: false })
  executionConfirmed: boolean;

  @Column({
    name: 'execution_confirmed_at',
    type: 'timestamptz',
    nullable: true,
  })
  executionConfirmedAt: Date | null;

  @Column({
    name: 'execution_confirmation_reference',
    type: 'text',
    nullable: true,
  })
  executionConfirmationReference: string | null;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt: Date | null;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

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
