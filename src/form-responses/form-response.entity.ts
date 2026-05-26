import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { Pengkurban } from '../pengkurban/pengkurban.entity';

@Entity('pengkurban_form_responses')
@Unique(['pengkurbanId', 'formKey'])
@Index(['formKey'])
export class FormResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'pengkurban_id', type: 'uuid' })
  pengkurbanId: string;

  @ManyToOne(() => Pengkurban, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pengkurban_id' })
  pengkurban: Pengkurban;

  @Column({ name: 'form_key', length: 64 })
  formKey: string;

  @Column({ type: 'jsonb' })
  data: Record<string, string>;

  @Column({ name: 'form_submitted_at', type: 'timestamptz' })
  formSubmittedAt: Date;

  @CreateDateColumn({ name: 'synced_at', type: 'timestamptz' })
  syncedAt: Date;
}
