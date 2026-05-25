import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnimalsService } from './animals.service';
import { AnimalsController } from './animals.controller';
import { Animal } from './animal.entity';
import { Event } from '../events/event.entity';
import { Pengkurban } from '../pengkurban/pengkurban.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Animal, Event, Pengkurban])],
  providers: [AnimalsService],
  controllers: [AnimalsController],
  exports: [AnimalsService],
})
export class AnimalsModule {}
