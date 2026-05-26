import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('page_visits')
export class PageVisit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  page: string;

  @Column({ name: 'session_id', type: 'varchar', length: 64 })
  sessionId: string;

  @Column({ type: 'varchar', nullable: true })
  referrer: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
