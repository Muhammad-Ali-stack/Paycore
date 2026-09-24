import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KycModule } from '../kyc/kyc.module';
import { LedgerModule } from '../ledger/ledger.module';
import { FxService } from './fx/fx.service';
import { RATE_PROVIDER, RatesService, SimulatedRateProvider } from './fx/rates.service';
import { PaymentsService } from './payments.service';
import { AdminWalletsController, FxController, WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

@Module({
  imports: [LedgerModule, KycModule, AuthModule],
  controllers: [WalletsController, FxController, AdminWalletsController],
  providers: [
    WalletsService,
    PaymentsService,
    FxService,
    RatesService,
    { provide: RATE_PROVIDER, useClass: SimulatedRateProvider },
  ],
  exports: [WalletsService, PaymentsService, FxService, RatesService],
})
export class WalletsModule {}
