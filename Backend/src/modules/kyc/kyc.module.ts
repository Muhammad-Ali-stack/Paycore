import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { DOCUMENT_VERIFIER, SimulatedDocumentVerifier } from './document-verification.adapter';
import { AdminKycController, KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { LimitsService } from './limits.service';

@Module({
  imports: [UsersModule],
  controllers: [KycController, AdminKycController],
  providers: [KycService, LimitsService, { provide: DOCUMENT_VERIFIER, useClass: SimulatedDocumentVerifier }],
  exports: [LimitsService, KycService],
})
export class KycModule {}
