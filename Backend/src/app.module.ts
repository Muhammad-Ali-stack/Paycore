import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfig, AppConfigModule } from './config/app-config';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { RolesGuard } from './common/auth/roles.guard';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { HealthController } from './common/health/health.controller';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { createLoggingModule } from './common/logging/logging.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { RedisService } from './common/redis/redis.service';
import { RedisThrottlerStorage } from './common/throttling/redis-throttler.storage';
import { AppThrottlerGuard } from './common/throttling/throttling';
import { FaultsModule } from './common/faults/fault-injector';
import { QueueModule } from './common/queue/queue.module';
import { ActivityModule } from './modules/activity/activity.module';
import { AuthModule } from './modules/auth/auth.module';
import { FeesModule } from './modules/fees/fees.service';
import { FundingModule } from './modules/funding/funding.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { MerchantsModule } from './modules/merchants/merchants.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { QrModule } from './modules/qr/qr.module';
import { SettlementModule } from './modules/settlement/settlement.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { KycModule } from './modules/kyc/kyc.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { UsersModule } from './modules/users/users.module';
import { WalletsModule } from './modules/wallets/wallets.module';

@Module({
  imports: [
    AppConfigModule,
    createLoggingModule(),
    PrismaModule,
    RedisModule,
    IdempotencyModule,
    FaultsModule,
    QueueModule,
    JwtModule.registerAsync({
      global: true,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.get('JWT_ACCESS_SECRET'),
        signOptions: { algorithm: 'HS256', issuer: 'paycore' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'paycore' },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [AppConfig, RedisService],
      useFactory: (config: AppConfig, redis: RedisService) => ({
        throttlers: [
          { name: 'default', ttl: config.get('THROTTLE_TTL_SECONDS') * 1000, limit: config.get('THROTTLE_LIMIT') },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    AuthModule,
    UsersModule,
    KycModule,
    LedgerModule,
    WalletsModule,
    // phase 2
    FeesModule,
    PaymentsModule,
    TransfersModule,
    QrModule,
    MerchantsModule,
    FundingModule,
    SettlementModule,
    ActivityModule,
    JobsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Guard order matters: authenticate first so throttling can key on the user id.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useExisting: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
