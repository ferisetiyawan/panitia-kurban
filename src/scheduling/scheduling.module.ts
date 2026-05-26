import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Animal } from '../animals/animal.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { FormResponse } from '../form-responses/form-response.entity';
import { Event } from '../events/event.entity';
import { NotificationsModule } from '../common/notifications/notifications.module';
import { SchedulingService } from './scheduling.service';
import { SchedulingBroadcastService } from './scheduling-broadcast.service';
import { SchedulingPdfService } from './scheduling-pdf.service';
import { SchedulingSesetPdfService } from './scheduling-seset-pdf.service';
import { SchedulingController } from './scheduling.controller';
import { SchedulingPortalController } from './scheduling.portal.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Animal, Pengkurban, FormResponse, Event]),
    NotificationsModule,
  ],
  providers: [SchedulingService, SchedulingBroadcastService, SchedulingPdfService, SchedulingSesetPdfService],
  controllers: [SchedulingController, SchedulingPortalController],
  exports: [SchedulingService],
})
export class SchedulingModule {}
