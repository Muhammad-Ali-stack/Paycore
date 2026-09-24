import { Inject, Injectable } from '@nestjs/common';
import { KycSubmission, KycSubmissionStatus, KycTier, Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DomainError } from '../../common/errors/domain-error';
import { isUniqueViolation } from '../../common/errors/error-response';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { sha256 } from '../../common/util/crypto';
import {
  DOCUMENT_VERIFIER,
  DocumentVerificationResult,
  DocumentVerifier,
  normaliseDocumentNumber,
} from './document-verification.adapter';
import { SubmitKycDto } from './dto/kyc.dto';
import { tierRank } from './limits.policy';

const PERSONAL_ID_DOCUMENTS = new Set(['CNIC', 'PASSPORT', 'EMIRATES_ID']);

export function submissionView(s: KycSubmission) {
  return {
    id: s.id,
    userId: s.userId,
    targetTier: s.targetTier,
    status: s.status,
    documentType: s.documentType,
    documentNumberLast4: s.documentLast4,
    documentRef: s.documentRef,
    businessName: s.businessName,
    verificationResult: s.verificationResult,
    reviewedById: s.reviewedById,
    reviewedAt: s.reviewedAt?.toISOString() ?? null,
    rejectionReason: s.rejectionReason,
    createdAt: s.createdAt.toISOString(),
  };
}

function isAdult(dateOfBirth: string, now = new Date()): boolean {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return false;
  const eighteenth = new Date(Date.UTC(dob.getUTCFullYear() + 18, dob.getUTCMonth(), dob.getUTCDate()));
  return eighteenth <= now;
}

@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOCUMENT_VERIFIER) private readonly verifier: DocumentVerifier,
    @InjectPinoLogger(KycService.name) private readonly logger: PinoLogger,
  ) {}

  async submit(userId: string, dto: SubmitKycDto): Promise<KycSubmission> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new DomainError('NOT_FOUND', 'User not found');
    this.validateSubmission(user.kycTier, user.role, dto);

    const pending = await this.prisma.kycSubmission.count({ where: { userId, status: 'PENDING' } });
    if (pending > 0) throw new DomainError('KYC_SUBMISSION_PENDING', 'A KYC submission is already under review');

    const verification = await this.verifier.verify({
      documentType: dto.documentType,
      documentNumber: dto.documentNumber,
      fullName: user.fullName,
      dateOfBirth: dto.dateOfBirth,
    });
    const normalised = normaliseDocumentNumber(dto.documentNumber);

    // Automated decisioning: hard verification failures are rejected; basic tier is auto-approved
    // on a clean pass; ID-verified and business tiers always require a human reviewer.
    const status: KycSubmissionStatus =
      verification.outcome === 'FAILED'
        ? 'REJECTED'
        : verification.outcome === 'PASSED' && dto.targetTier === 'TIER_1'
          ? 'APPROVED'
          : 'PENDING';

    try {
      return await this.prisma.$transaction(async (tx) => {
        const submission = await tx.kycSubmission.create({
          data: {
            userId,
            targetTier: dto.targetTier,
            status,
            documentType: dto.documentType,
            documentNumberHash: sha256(normalised),
            documentLast4: normalised.slice(-4),
            documentRef: dto.documentRef,
            dateOfBirth: dto.dateOfBirth,
            address: dto.address,
            businessName: dto.businessName,
            verificationResult: verification as unknown as Prisma.InputJsonValue,
            reviewedAt: status === 'PENDING' ? null : new Date(),
            rejectionReason: status === 'REJECTED' ? `Automated verification failed: ${verification.reasons.join(', ')}` : null,
          },
        });
        await this.audit(tx, { userId, submissionId: submission.id, actorId: userId, action: 'SUBMITTED', toTier: dto.targetTier });
        await this.audit(tx, {
          userId,
          submissionId: submission.id,
          actorId: null,
          action: `AUTO_VERIFICATION_${verification.outcome}`,
          details: this.auditDetails(verification),
        });
        if (status === 'REJECTED') {
          await this.audit(tx, { userId, submissionId: submission.id, actorId: null, action: 'REJECTED' });
        }
        if (status === 'APPROVED') {
          await this.applyTier(tx, userId, submission.id, dto.targetTier, null);
        }
        return submission;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError('KYC_SUBMISSION_PENDING', 'A KYC submission is already under review');
      }
      throw err;
    }
  }

  async approve(submissionId: string, adminId: string, note?: string): Promise<KycSubmission> {
    return this.prisma.$transaction(async (tx) => {
      const submission = await this.claimPending(tx, submissionId, adminId, 'APPROVED');
      await this.audit(tx, {
        userId: submission.userId,
        submissionId,
        actorId: adminId,
        action: 'APPROVED',
        details: note ? { note } : undefined,
      });
      await this.applyTier(tx, submission.userId, submissionId, submission.targetTier, adminId);
      this.logger.info({ submissionId, adminId, userId: submission.userId }, 'KYC submission approved');
      return submission;
    });
  }

  async reject(submissionId: string, adminId: string, reason: string): Promise<KycSubmission> {
    return this.prisma.$transaction(async (tx) => {
      const submission = await this.claimPending(tx, submissionId, adminId, 'REJECTED', reason);
      await this.audit(tx, {
        userId: submission.userId,
        submissionId,
        actorId: adminId,
        action: 'REJECTED',
        details: { reason },
      });
      this.logger.info({ submissionId, adminId, userId: submission.userId }, 'KYC submission rejected');
      return submission;
    });
  }

  listSubmissions(status?: KycSubmissionStatus): Promise<KycSubmission[]> {
    return this.prisma.kycSubmission.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  mySubmissions(userId: string): Promise<KycSubmission[]> {
    return this.prisma.kycSubmission.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 });
  }

  auditTrail(userId: string) {
    return this.prisma.kycAuditLog.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  }

  // ─────────────────────────── internals ───────────────────────────

  private validateSubmission(currentTier: KycTier, role: string, dto: SubmitKycDto): void {
    if (tierRank(dto.targetTier) <= tierRank(currentTier)) {
      throw new DomainError('KYC_INVALID_TARGET_TIER', `Already at ${currentTier}; target must be higher`);
    }
    const fail = (message: string) => {
      throw new DomainError('KYC_INVALID_TARGET_TIER', message);
    };
    if (!dto.dateOfBirth || !dto.address) fail('dateOfBirth and address are required');
    if (dto.dateOfBirth && !isAdult(dto.dateOfBirth)) fail('Applicant must be at least 18 years old');
    if (dto.targetTier === 'TIER_2' && !PERSONAL_ID_DOCUMENTS.has(dto.documentType)) {
      fail('TIER_2 requires a CNIC, passport or Emirates ID');
    }
    if (dto.targetTier === 'TIER_3') {
      if (role !== 'MERCHANT') fail('TIER_3 is only available to merchant accounts');
      if (dto.documentType !== 'BUSINESS_REGISTRATION' || !dto.businessName) {
        fail('TIER_3 requires businessName and a BUSINESS_REGISTRATION document');
      }
    }
  }

  /** Compare-and-set PENDING -> decided, so two admins can't both decide the same submission. */
  private async claimPending(
    tx: Tx,
    submissionId: string,
    adminId: string,
    status: 'APPROVED' | 'REJECTED',
    reason?: string,
  ): Promise<KycSubmission> {
    const submission = await tx.kycSubmission.findUnique({ where: { id: submissionId } });
    if (!submission) throw new DomainError('NOT_FOUND', 'Submission not found');
    if (submission.userId === adminId) throw new DomainError('FORBIDDEN', 'Reviewers cannot decide their own submission');
    const claimed = await tx.kycSubmission.updateMany({
      where: { id: submissionId, status: 'PENDING' },
      data: { status, reviewedById: adminId, reviewedAt: new Date(), rejectionReason: reason ?? null },
    });
    if (claimed.count !== 1) throw new DomainError('CONFLICT', 'Submission has already been decided');
    return { ...submission, status, reviewedById: adminId, reviewedAt: new Date(), rejectionReason: reason ?? null };
  }

  private async applyTier(
    tx: Tx,
    userId: string,
    submissionId: string,
    targetTier: KycTier,
    actorId: string | null,
  ): Promise<void> {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { kycTier: true } });
    if (tierRank(targetTier) <= tierRank(user.kycTier)) return;
    await tx.user.update({ where: { id: userId }, data: { kycTier: targetTier } });
    await this.audit(tx, { userId, submissionId, actorId, action: 'TIER_CHANGED', fromTier: user.kycTier, toTier: targetTier });
  }

  private auditDetails(v: DocumentVerificationResult): Prisma.InputJsonValue {
    return { provider: v.provider, reference: v.reference, score: v.score, reasons: v.reasons };
  }

  private async audit(
    tx: Tx,
    entry: {
      userId: string;
      submissionId?: string;
      actorId: string | null;
      action: string;
      fromTier?: KycTier;
      toTier?: KycTier;
      details?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await tx.kycAuditLog.create({ data: entry });
  }
}
