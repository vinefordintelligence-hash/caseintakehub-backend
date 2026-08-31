import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ClientActionStatus = 'active' | 'inactive' | 'completed';

@Entity('case_client_actions')
export class CaseClientAction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'case_id', type: 'uuid' })
  caseId: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'title', type: 'text' })
  title: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'action_url', type: 'text', nullable: true })
  actionUrl: string | null;

  @Column({ name: 'action_label', type: 'text', nullable: true })
  actionLabel: string | null;

  @Column({
    name: 'status',
    type: 'text',
    default: 'active',
  })
  status: ClientActionStatus;

  @Column({ name: 'is_client_visible', type: 'boolean', default: true })
  isClientVisible: boolean;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({
    name: 'activated_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  activatedAt: Date;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

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

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'completed_by', type: 'uuid', nullable: true })
  completedBy: string | null;
}
