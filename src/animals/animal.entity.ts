import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Event } from '../events/event.entity';

@Entity('animals')
export class Animal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'animal_code', unique: true })
  animalCode: string; // ANM-1447H-XXXXXXXX

  @Column({ name: 'animal_type' })
  animalType: string; // DOMBA | KAMBING | SAPI_PERORANGAN | SAPI_KOLEKTIF_A | SAPI_KOLEKTIF_B | SAPI_KOLEKTIF_C

  @ManyToOne(() => Event, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: Event;

  @Column({ name: 'event_id' })
  eventId: string;

  // For individual animals (DOMBA/KAMBING/SAPI_PERORANGAN): linked pengkurban
  // For kolektif: null (sohibul fetched by querying all pengkurban of same type+event)
  // For vendor animals (no registration): also null, isVendorAnimal=true
  @Column({ name: 'pengkurban_id', type: 'varchar', nullable: true })
  pengkurbanId: string | null;

  @Column({ name: 'is_vendor_animal', default: false })
  isVendorAnimal: boolean;

  // PENDING = not yet received | RECEIVED = received from vendor
  @Column({ default: 'PENDING' })
  status: string;

  @Column({ name: 'received_at', type: 'timestamp', nullable: true })
  receivedAt: Date | null;

  @Column({ name: 'received_by_id', type: 'varchar', nullable: true })
  receivedById: string | null;

  // Array of filenames in uploads/animal-photos/
  @Column({ type: 'simple-json', nullable: true })
  photos: string[] | null;

  @Column({ type: 'varchar', nullable: true })
  notes: string | null;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  @Column({ name: 'scheduled_team', type: 'varchar', length: 20, nullable: true })
  scheduledTeam: 'SAPI' | 'KAMBING_DOMBA' | null;

  @Column({ name: 'scheduled_note', type: 'text', nullable: true })
  scheduledNote: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
