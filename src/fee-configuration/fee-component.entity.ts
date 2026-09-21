import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FeeDefinition } from './fee-definition.entity';

@Entity('fee_components')
export class FeeComponent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'definition_id', type: 'uuid' })
  definitionId: string;

  @ManyToOne(() => FeeDefinition)
  @JoinColumn({ name: 'definition_id' })
  definition: FeeDefinition;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  type: 'FIXED' | 'PERCENT';

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  value: string;

  @Column({ name: 'is_vatable', type: 'boolean', default: false })
  isVatable: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'int' })
  ordering: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
