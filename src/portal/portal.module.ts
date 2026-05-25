import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PortalService } from './portal.service';
import { PortalController } from './portal.controller';
import { PortalJwtStrategy } from './portal-jwt.strategy';
import { Pengkurban } from '../pengkurban/pengkurban.entity';
import { FormResponse } from '../form-responses/form-response.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Pengkurban, FormResponse]),
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'panitia-kurban-secret-key-2026',
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as any },
    }),
  ],
  providers: [PortalService, PortalJwtStrategy],
  controllers: [PortalController],
})
export class PortalModule {}
