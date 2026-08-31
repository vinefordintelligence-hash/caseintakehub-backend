import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type DocumentRequirementStatus =
  'required' | 'submitted' | 'under_review' | 'verified' | 'rejected';

@Entity('transfer_document_requirements')
export class TransferDocumentRequirement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'case_id', type: 'uuid' })
  caseId: string;

  @Column({ name: 'transfer_id', type: 'uuid', nullable: true })
  transferId: string | null;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'requirement_key', type: 'text' })
  requirementKey: string;

  @Column({ name: 'title', type: 'text' })
  title: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'category', type: 'text', nullable: true })
  category: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ['required', 'submitted', 'under_review', 'verified', 'rejected'],
    default: 'required',
  })
  status: DocumentRequirementStatus;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'submitted_document_id', type: 'uuid', nullable: true })
  submittedDocumentId: string | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ name: 'submitted_by', type: 'uuid', nullable: true })
  submittedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote: string | null;

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
