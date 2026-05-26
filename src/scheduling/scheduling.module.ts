import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Animal } from '../animals/animal.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { FormResponse } from '../form-responses/form-response.entity';
import { NotificationsModule } from '../common/notifications/notifications.module';
import { SchedulingService } from './scheduling.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Animal, Pengkurban, FormResponse]),
    NotificationsModule,
  ],
  providers: [SchedulingService],
  controllers: [],
  exports: [SchedulingService],
})
export class SchedulingModule {}
