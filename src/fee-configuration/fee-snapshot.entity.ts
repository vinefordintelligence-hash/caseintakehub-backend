import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('payment_operation_fee_snapshots')
export class FeeSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'operation_id', type: 'uuid' })
  operationId: string;

  @Column({ name: 'snapshot_json', type: 'jsonb' })
  snapshotJson: Record<string, unknown>;

  @CreateDateColumn({ name: 'calculated_at', type: 'timestamptz' })
  calculatedAt: Date;
}
