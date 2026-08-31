import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('cases')
export class Case {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  @Index()
  organizationId: string;

  @Column({ name: 'client_id', type: 'uuid' })
  @Index()
  clientId: string;

  @Index({ unique: true })
  @Column({ name: 'case_number', type: 'text' })
  caseNumber: string;

  @Column({ name: 'title', type: 'text' })
  title: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description?: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ['open', 'closed', 'pending', 'on_hold', 'archived'],
    default: 'open',
  })
  status: string;

  @Column({ name: 'assigned_to', type: 'uuid', nullable: true })
  @Index()
  assignedTo?: string;

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

  @Column({ name: 'assigned_investigator_id', type: 'uuid', nullable: true })
  assignedInvestigatorId?: string;

  @Column({ name: 'engagement_template_id', type: 'uuid', nullable: true })
  engagementTemplateId?: string;

  @Column({
    name: 'workflow_phase',
    type: 'enum',
    enum: [
      'transfer_preparation',
      'receiving_bank_review',
      'bank_acceptance_verification',
      'document_verification',
      'case_review',
      'completed',
    ],
    default: 'transfer_preparation',
  })
  @Index()
  workflowPhase: string;

  @Column({ name: 'workflow_phase_number', type: 'integer', default: 1 })
  workflowPhaseNumber: number;

  @Column({ name: 'workflow_updated_at', type: 'timestamptz', nullable: true })
  workflowUpdatedAt?: Date;

  @Column({ name: 'current_transfer_id', type: 'uuid', nullable: true })
  currentTransferId?: string;
}
