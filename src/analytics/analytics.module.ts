import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PageVisit } from './page-visit.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { Donation } from '../donations/donation.entity';
import { AnalyticsService } from './analytics.service';
import {
  AnalyticsController,
  PublicTrackController,
} from './analytics.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PageVisit, Pengkurban, Donation])],
  providers: [AnalyticsService],
  controllers: [AnalyticsController, PublicTrackController],
})
export class AnalyticsModule {}
