import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type HandoffGrantStatus = 'active' | 'revoked' | 'expired';

@Entity('case_handoff_grants')
export class CaseHandoffGrant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'case_id', type: 'uuid' })
  caseId: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'client_action_id', type: 'uuid', nullable: true })
  clientActionId: string | null;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ name: 'purpose', type: 'text', default: 'phase6_handoff' })
  purpose: string;

  @Column({ name: 'token', type: 'text', nullable: true })
  token: string | null;

  @Column({
    name: 'status',
    type: 'text',
    default: 'active',
  })
  status: HandoffGrantStatus;

  @Column({
    name: 'issued_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  issuedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'revoked_by', type: 'uuid', nullable: true })
  revokedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'unlocked_at', type: 'timestamptz', nullable: true })
  unlockedAt: Date | null;

  @Column({ name: 'verified_count', type: 'int', default: 0 })
  verifiedCount: number;

  @Column({ name: 'last_verified_at', type: 'timestamptz', nullable: true })
  lastVerifiedAt: Date | null;

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
