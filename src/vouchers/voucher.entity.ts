import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Event } from '../events/event.entity';
import { User } from '../users/user.entity';
import { VoucherStatus } from '../common/enums/voucher-status.enum';
import { ScanLog } from './scan-log.entity';

@Entity('vouchers')
export class Voucher {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_id' })
  eventId: string;

  @ManyToOne(() => Event, (event) => event.vouchers)
  @JoinColumn({ name: 'event_id' })
  event: Event;

  @Column({ name: 'voucher_code', unique: true })
  voucherCode: string;

  @Column({ name: 'qr_data' })
  qrData: string;

  @Column({
    type: 'enum',
    enum: VoucherStatus,
    default: VoucherStatus.ACTIVE,
  })
  status: VoucherStatus;

  @Column({ name: 'distribution_date', type: 'date', nullable: true })
  distributionDate: Date;

  @Column({ name: 'claimed_by', nullable: true })
  claimedById: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'claimed_by' })
  claimedBy: User;

  @Column({ name: 'claimed_at', type: 'timestamp', nullable: true })
  claimedAt: Date;

  @Column({ name: 'pickup_cluster', nullable: true })
  pickupCluster: string;

  @Column({ name: 'pickup_unit', nullable: true })
  pickupUnit: string;

  @Column({ name: 'pickup_phone', nullable: true })
  pickupPhone: string;

  @Column({ name: 'picked_up_at', type: 'timestamp', nullable: true })
  pickedUpAt: Date;

  @Column({ name: 'picked_up_by', nullable: true })
  pickedUpById: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'picked_up_by' })
  pickedUpBy: User;

  @Column({ name: 'created_by', nullable: true })
  createdById: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => ScanLog, (scanLog) => scanLog.voucher)
  scanLogs: ScanLog[];
}
