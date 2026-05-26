import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Voucher } from '../vouchers/voucher.entity';
import { Event } from '../events/event.entity';
import { User } from '../users/user.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { VoucherStatus } from '../common/enums/voucher-status.enum';
import { RegistrationStatus } from '../common/enums/registration-status.enum';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Voucher)
    private vouchersRepo: Repository<Voucher>,
    @InjectRepository(Event)
    private eventsRepo: Repository<Event>,
    @InjectRepository(User)
    private usersRepo: Repository<User>,
    @InjectRepository(Pengkurban)
    private pengkurbanRepo: Repository<Pengkurban>,
  ) {}

  async getStats(eventId?: string) {
    let activeEvent: Event | null = null;
    if (eventId === 'all') {
      eventId = undefined;
    } else if (!eventId) {
      activeEvent = await this.eventsRepo.findOne({
        where: { isActive: true },
        order: { createdAt: 'DESC' },
      });
      eventId = activeEvent?.id;
    } else {
      activeEvent = await this.eventsRepo.findOne({ where: { id: eventId } });
    }

    const voucherQb = this.vouchersRepo.createQueryBuilder('v');
    if (eventId) {
      voucherQb.where('v.event_id = :eventId', { eventId });
    }

    const totalVouchers = await voucherQb.getCount();
    const claimedVouchers = await voucherQb
      .clone()
      .andWhere('v.status = :status', { status: VoucherStatus.CLAIMED })
      .getCount();
    const activeVouchers = await voucherQb
      .clone()
      .andWhere('v.status = :status', { status: VoucherStatus.ACTIVE })
      .getCount();
    const cancelledVouchers = await voucherQb
      .clone()
      .andWhere('v.status = :status', { status: VoucherStatus.CANCELLED })
      .getCount();
    const distributedVouchers = await voucherQb
      .clone()
      .andWhere('v.status = :status', { status: VoucherStatus.DISTRIBUTED })
      .getCount();

    const totalUsers = await this.usersRepo.count({
      where: { isActive: true },
    });

    const pengkurbanWhere: Record<string, unknown> = {
      status: Not(RegistrationStatus.REJECTED),
    };
    if (eventId) {
      pengkurbanWhere.eventId = eventId;
    }
    const totalPengkurban = await this.pengkurbanRepo.count({
      where: pengkurbanWhere,
    });

    const totalEvents = await this.eventsRepo.count();

    // Recent scan activity
    const recentScansQb = this.vouchersRepo
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.claimedBy', 'claimer')
      .where('v.status = :status', { status: VoucherStatus.CLAIMED });

    if (eventId) {
      recentScansQb.andWhere('v.event_id = :eventId', { eventId });
    }

    const recentScans = await recentScansQb
      .orderBy('v.claimedAt', 'DESC')
      .take(10)
      .getMany();

    return {
      event: activeEvent,
      totalVouchers,
      claimedVouchers,
      activeVouchers,
      cancelledVouchers,
      distributedVouchers,
      totalUsers,
      totalPengkurban,
      totalEvents,
      claimPercentage:
        totalVouchers > 0
          ? Math.round((claimedVouchers / totalVouchers) * 100)
          : 0,
      recentScans: recentScans.map((s) => ({
        voucherCode: s.voucherCode,
        claimedAt: s.claimedAt,
        claimedBy: s.claimedBy ? { fullName: s.claimedBy.fullName } : null,
      })),
    };
  }
}
