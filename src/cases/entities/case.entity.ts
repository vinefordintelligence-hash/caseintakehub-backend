import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('cases')
export class Case {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  caseReference: string;

  @Column()
  title: string;
}
