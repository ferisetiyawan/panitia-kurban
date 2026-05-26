import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Event } from '../events/event.entity';
import { AnimalType } from '../common/enums/animal-type.enum';
import { PurchaseType } from '../common/enums/purchase-type.enum';
import { RegistrationStatus } from '../common/enums/registration-status.enum';

@Entity('pengkurban')
export class Pengkurban {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_id' })
  eventId: string;

  @ManyToOne(() => Event, (event) => event.pengkurban)
  @JoinColumn({ name: 'event_id' })
  event: Event;

  @Column()
  name: string;

  @Column({ name: 'address', type: 'varchar', nullable: true })
  address: string;

  @Column({ type: 'enum', enum: AnimalType, name: 'animal_type' })
  animalType: AnimalType;

  @Column({ type: 'enum', enum: PurchaseType, name: 'purchase_type' })
  purchaseType: PurchaseType;

  @Column({ name: 'animal_size', type: 'varchar', nullable: true })
  animalSize: string | null;

  @Column({ name: 'shohibul_name', type: 'text', nullable: true })
  shohibulName: string | null;

  @Column({
    name: 'price',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  price: number | null;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  notes: string;

  @Column({ name: 'payment_proof_paths', type: 'simple-json', nullable: true })
  paymentProofPaths: string[];

  @Column({ name: 'registration_number', unique: true })
  registrationNumber: string;

  @Column({
    type: 'enum',
    enum: RegistrationStatus,
    name: 'status',
    default: RegistrationStatus.PENDING_PAYMENT,
  })
  status: RegistrationStatus;

  @Column({ name: 'infaq_paid', type: 'boolean', default: false })
  infaqPaid: boolean;

  @Column({ name: 'infaq_paid_at', type: 'timestamptz', nullable: true })
  infaqPaidAt: Date | null;

  // Nominal infaq yang diharapkan dari pengkurban ini. NULL = waiver (di-skip
  // dari rekap sumbangan — mis. infaq via potongan daging / institutional).
  // Default di-set di service create() berdasarkan animal_type; admin bisa
  // override atau set null untuk waiver.
  @Column({
    name: 'infaq_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  infaqAmount: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
