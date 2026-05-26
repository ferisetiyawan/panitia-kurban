import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pengkurban } from './pengkurban.entity';
import { FormResponse } from '../form-responses/form-response.entity';
import { PengkurbanService } from './pengkurban.service';
import { PengkurbanController } from './pengkurban.controller';
import { PublicPengkurbanController } from './public-pengkurban.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Pengkurban, FormResponse])],
  providers: [PengkurbanService],
  controllers: [PengkurbanController, PublicPengkurbanController],
  exports: [PengkurbanService],
})
export class PengkurbanModule {}
