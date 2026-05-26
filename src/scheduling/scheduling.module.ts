import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Animal } from '../animals/animal.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { FormResponse } from '../form-responses/form-response.entity';
import { Event } from '../events/event.entity';
import { NotificationsModule } from '../common/notifications/notifications.module';
import { SchedulingService } from './scheduling.service';
import { SchedulingController } from './scheduling.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Animal, Pengkurban, FormResponse, Event]),
    NotificationsModule,
  ],
  providers: [SchedulingService],
  controllers: [SchedulingController],
  exports: [SchedulingService],
})
export class SchedulingModule {}
