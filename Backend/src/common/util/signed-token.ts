import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Compact HMAC-SHA256 tokens: `<PREFIX>.<base64url(json claims)>.<base64url(signature)>`.
 * The signature covers `<PREFIX>.<base64url(json claims)>`, so the prefix (format version) is
 * bound too. Verification is constant-time. Used for QR payloads (PC1) and QR preview tokens (PV1).
 */
export const b64url = {
  encode: (value: Buffer | string): string => Buffer.from(value).toString('base64url'),
  decode: (value: string): Buffer => Buffer.from(value, 'base64url'),
};

const B64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function hmacSign(secret: string, signingInput: string): Buffer {
  return createHmac('sha256', secret).update(signingInput).digest();
}

export function signToken(prefix: string, claims: Record<string, unknown>, secret: string): string {
  const body = `${prefix}.${b64url.encode(JSON.stringify(claims))}`;
  return `${body}.${b64url.encode(hmacSign(secret, body))}`;
}

export interface ParsedToken {
  claims: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
}

/** Structural parse only (NOT verified). Returns null for anything malformed. */
export function parseToken(prefix: string, token: string): ParsedToken | null {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [p, body, sig] = parts as [string, string, string];
  if (p !== prefix || !B64URL_PATTERN.test(body) || !B64URL_PATTERN.test(sig)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(b64url.decode(body).toString('utf8'));
  } catch {
    return null;
  }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
  return { claims: claims as Record<string, unknown>, signingInput: `${p}.${body}`, signature: b64url.decode(sig) };
}

export function verifySignature(parsed: ParsedToken, secret: string): boolean {
  const expected = hmacSign(secret, parsed.signingInput);
  return expected.length === parsed.signature.length && timingSafeEqual(expected, parsed.signature);
}
