import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { Idempotent, idempotencyKeyOf } from '../../common/idempotency/idempotency.interceptor';
import { moneyView } from '../../common/money/money';
import { IntegrityReportDto, JournalEntryDto, LedgerAccountDetailDto, LedgerAccountDto, ReverseEntryDto } from './ledger.dto';
import { accountView, entryView } from './ledger.mapper';

export { ReverseEntryDto } from './ledger.dto';
import { LedgerService } from './ledger.service';

@ApiTags('admin / ledger')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/ledger')
export class LedgerAdminController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('system-accounts')
  @ApiOkResponse({ type: [LedgerAccountDto] })
  async systemAccounts(): Promise<LedgerAccountDto[]> {
    return (await this.ledger.listSystemAccounts()).map(accountView);
  }

  @Get('accounts/:id')
  @ApiOkResponse({ type: LedgerAccountDetailDto })
  async account(@Param('id', ParseUUIDPipe) id: string): Promise<LedgerAccountDetailDto> {
    const account = await this.ledger.getAccount(id);
    const derived = await this.ledger.derivedBalance(id);
    return { ...accountView(account), derivedBalance: moneyView(derived, account.currency) };
  }

  @Get('entries/:id')
  @ApiOkResponse({ type: JournalEntryDto })
  async entry(@Param('id', ParseUUIDPipe) id: string): Promise<JournalEntryDto> {
    return entryView(await this.ledger.getEntry(id));
  }

  @Post('entries/:id/reversals')
  @Idempotent()
  @ApiCreatedResponse({ type: JournalEntryDto })
  async reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseEntryDto,
    @CurrentUser() admin: AuthUser,
    @Req() req: Request,
  ): Promise<JournalEntryDto> {
    const posted = await this.ledger.reverse(id, {
      actorId: admin.id,
      reason: dto.reason,
      externalRef: `idem:${admin.id}:${idempotencyKeyOf(req)}`,
    });
    return entryView(posted);
  }

  @Get('integrity')
  @ApiOkResponse({ type: IntegrityReportDto })
  async integrity(): Promise<IntegrityReportDto> {
    return this.ledger.integrityReport();
  }
}
