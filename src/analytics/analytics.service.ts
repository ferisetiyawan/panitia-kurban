import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PageVisit } from './page-visit.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { Donation } from '../donations/donation.entity';
import { RegistrationStatus } from '../common/enums/registration-status.enum';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(PageVisit)
    private visitRepo: Repository<PageVisit>,
  ) {}

  async track(
    page: string,
    sessionId: string,
    referrer?: string,
  ): Promise<void> {
    await this.visitRepo.save(
      this.visitRepo.create({ page, sessionId, referrer: referrer || null }),
    );
  }

  async getStats() {
    // Visits per page: total + unique sessions
    const perPage = await this.visitRepo
      .createQueryBuilder('v')
      .select('v.page', 'page')
      .addSelect('COUNT(*)', 'total')
      .addSelect('COUNT(DISTINCT v.session_id)', 'unique')
      .groupBy('v.page')
      .orderBy('total', 'DESC')
      .getRawMany<{ page: string; total: string; unique: string }>();

    // Daily visits (last 30 days)
    const daily = await this.visitRepo
      .createQueryBuilder('v')
      .select("DATE_TRUNC('day', v.created_at)", 'date')
      .addSelect('v.page', 'page')
      .addSelect('COUNT(*)', 'total')
      .addSelect('COUNT(DISTINCT v.session_id)', 'unique')
      .where("v.created_at >= NOW() - INTERVAL '30 days'")
      .groupBy("DATE_TRUNC('day', v.created_at)")
      .addGroupBy('v.page')
      .orderBy('date', 'ASC')
      .getRawMany<{
        date: string;
        page: string;
        total: string;
        unique: string;
      }>();

    // Funnel: daftar sessions → registrations → proof uploaded → confirmed
    const daftarSessions = await this.visitRepo
      .createQueryBuilder('v')
      .select('COUNT(DISTINCT v.session_id)', 'count')
      .where("v.page = 'daftar'")
      .getRawOne<{ count: string }>();

    const manager = this.visitRepo.manager;
    const totalRegistrations = await manager.count(Pengkurban);
    const withProof = await manager
      .createQueryBuilder(Pengkurban, 'p')
      .where('p.payment_proof_paths IS NOT NULL')
      .getCount();
    const confirmed = await manager.count(Pengkurban, {
      where: { status: RegistrationStatus.CONFIRMED },
    });

    return {
      perPage: perPage.map((r) => ({
        page: r.page,
        total: Number(r.total),
        unique: Number(r.unique),
      })),
      daily: daily.map((r) => ({
        date: r.date,
        page: r.page,
        total: Number(r.total),
        unique: Number(r.unique),
      })),
      funnel: {
        daftarVisits: Number(daftarSessions?.count ?? 0),
        registrations: totalRegistrations,
        proofUploaded: withProof,
        confirmed,
      },
    };
  }
}
