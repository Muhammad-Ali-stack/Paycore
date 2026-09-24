import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { KycDocumentType } from '@prisma/client';

export const DOCUMENT_VERIFIER = Symbol('DOCUMENT_VERIFIER');

export interface DocumentVerificationRequest {
  documentType: KycDocumentType;
  documentNumber: string;
  fullName: string;
  dateOfBirth?: string;
}

export interface DocumentVerificationResult {
  outcome: 'PASSED' | 'FAILED' | 'MANUAL_REVIEW';
  /** Confidence score 0-100. */
  score: number;
  reasons: string[];
  provider: string;
  reference: string;
  checkedAt: string;
}

/** Port to an external identity-verification vendor (e.g. NADRA Verisys, UAE PASS, Onfido). */
export interface DocumentVerifier {
  verify(request: DocumentVerificationRequest): Promise<DocumentVerificationResult>;
}

export const normaliseDocumentNumber = (n: string): string => n.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/**
 * Deterministic simulator:
 *  - numbers ending in 0000 -> FAILED (document not found)
 *  - numbers ending in 9999 -> MANUAL_REVIEW (low image quality)
 *  - anything else          -> PASSED
 */
@Injectable()
export class SimulatedDocumentVerifier implements DocumentVerifier {
  async verify(request: DocumentVerificationRequest): Promise<DocumentVerificationResult> {
    const number = normaliseDocumentNumber(request.documentNumber);
    const base = { provider: 'simulated', reference: `sim_${randomUUID()}`, checkedAt: new Date().toISOString() };
    if (number.endsWith('0000')) return { ...base, outcome: 'FAILED', score: 5, reasons: ['DOCUMENT_NOT_FOUND'] };
    if (number.endsWith('9999')) return { ...base, outcome: 'MANUAL_REVIEW', score: 55, reasons: ['LOW_IMAGE_QUALITY'] };
    return { ...base, outcome: 'PASSED', score: 97, reasons: [] };
  }
}
