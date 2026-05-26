import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { join } from 'path';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { EventsModule } from './events/events.module';
import { PengkurbanModule } from './pengkurban/pengkurban.module';
import { VouchersModule } from './vouchers/vouchers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SeedModule } from './seed/seed.module';
import { ActivityLogsModule } from './activity-logs/activity-logs.module';
import { ActivityLogInterceptor } from './activity-logs/activity-log.interceptor';
import { DonationsModule } from './donations/donations.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { NotificationsModule } from './common/notifications/notifications.module';
import { RekapModule } from './rekap/rekap.module';
import { FormResponsesModule } from './form-responses/form-responses.module';
import { AnimalsModule } from './animals/animals.module';
import { PortalModule } from './portal/portal.module';
import { SchedulingModule } from './scheduling/scheduling.module';

import { AppController } from './app.controller';

const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      host: !process.env.DATABASE_URL
        ? process.env.DB_HOST || 'localhost'
        : undefined,
      port: !process.env.DATABASE_URL
        ? parseInt(process.env.DB_PORT || '5432', 10)
        : undefined,
      username: !process.env.DATABASE_URL
        ? process.env.DB_USERNAME || 'admin'
        : undefined,
      password: !process.env.DATABASE_URL
        ? process.env.DB_PASSWORD || 'admin123'
        : undefined,
      database: !process.env.DATABASE_URL
        ? process.env.DB_NAME || 'panitia_kurban'
        : undefined,
      autoLoadEntities: true,
      synchronize: process.env.DB_SYNCHRONIZE !== 'false', // Set DB_SYNCHRONIZE=false to skip schema sync
      ssl: isProduction,
      extra: isProduction
        ? {
            ssl: {
              rejectUnauthorized: false,
            },
          }
        : {},
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'client'),
      exclude: ['/api/{*splat}'],
    }),
    AuthModule,
    UsersModule,
    EventsModule,
    PengkurbanModule,
    VouchersModule,
    DashboardModule,
    SeedModule,
    ActivityLogsModule,
    DonationsModule,
    AnalyticsModule,
    NotificationsModule,
    RekapModule,
    ScheduleModule.forRoot(),
    FormResponsesModule,
    SchedulingModule,
    AnimalsModule,
    PortalModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ActivityLogInterceptor,
    },
  ],
})
export class AppModule {}
