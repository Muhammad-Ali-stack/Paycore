import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Roles } from '../../common/auth/auth.decorators';
import { UsersService } from '../users/users.service';
import {
  ApproveKycDto,
  KycAuditLogDto,
  KycMeDto,
  KycSubmissionDto,
  ListSubmissionsQuery,
  RejectKycDto,
  SubmitKycDto,
  TierLimitDto,
} from './dto/kyc.dto';
import { KycService, submissionView } from './kyc.service';
import { LimitsService, limitView } from './limits.service';

@ApiTags('kyc')
@ApiBearerAuth()
@Controller('kyc')
export class KycController {
  constructor(
    private readonly kyc: KycService,
    private readonly limits: LimitsService,
    private readonly users: UsersService,
  ) {}

  /** Current tier, its limits, and recent submissions. */
  @Get('me')
  @ApiOkResponse({ type: KycMeDto })
  async me(@CurrentUser() auth: AuthUser): Promise<KycMeDto> {
    const user = await this.users.getById(auth.id);
    const [limits, submissions] = await Promise.all([
      this.limits.listLimits(user.kycTier),
      this.kyc.mySubmissions(auth.id),
    ]);
    return { tier: user.kycTier, limits: limits.map(limitView), submissions: submissions.map(submissionView) };
  }

  /** Limits for every tier (for "upgrade to unlock" UX). */
  @Get('tiers')
  @ApiOkResponse({ type: [TierLimitDto] })
  async tiers(): Promise<TierLimitDto[]> {
    return (await this.limits.listLimits()).map(limitView);
  }

  @Post('submissions')
  @ApiCreatedResponse({ type: KycSubmissionDto })
  async submit(@CurrentUser() auth: AuthUser, @Body() dto: SubmitKycDto): Promise<KycSubmissionDto> {
    return submissionView(await this.kyc.submit(auth.id, dto));
  }
}

@ApiTags('admin / kyc')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/kyc')
export class AdminKycController {
  constructor(private readonly kyc: KycService) {}

  @Get('submissions')
  @ApiOkResponse({ type: [KycSubmissionDto] })
  async list(@Query() query: ListSubmissionsQuery): Promise<KycSubmissionDto[]> {
    return (await this.kyc.listSubmissions(query.status)).map(submissionView);
  }

  @Post('submissions/:id/approve')
  @HttpCode(200)
  @ApiOkResponse({ type: KycSubmissionDto })
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveKycDto, @CurrentUser() admin: AuthUser): Promise<KycSubmissionDto> {
    return submissionView(await this.kyc.approve(id, admin.id, dto.note));
  }

  @Post('submissions/:id/reject')
  @HttpCode(200)
  @ApiOkResponse({ type: KycSubmissionDto })
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectKycDto, @CurrentUser() admin: AuthUser): Promise<KycSubmissionDto> {
    return submissionView(await this.kyc.reject(id, admin.id, dto.reason));
  }

  @Get('users/:userId/audit')
  @ApiOkResponse({ type: [KycAuditLogDto] })
  async audit(@Param('userId', ParseUUIDPipe) userId: string): Promise<KycAuditLogDto[]> {
    const rows = await this.kyc.auditTrail(userId);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }
}
