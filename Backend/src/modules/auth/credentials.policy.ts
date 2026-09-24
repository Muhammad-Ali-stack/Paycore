import { hash, verify } from '@node-rs/argon2';

/** Argon2id (the library default algorithm) with OWASP-recommended minimum parameters. */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashSecret = (secret: string): Promise<string> => hash(secret, ARGON2_OPTIONS);

export async function verifySecret(hashed: string, secret: string): Promise<boolean> {
  try {
    return await verify(hashed, secret);
  } catch {
    return false;
  }
}

export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/;
export const PIN_PATTERN = /^\d{4,6}$/;

/** Reject trivially guessable PINs: repeated digits and straight sequences (1234, 9876...). */
export function isWeakPin(pin: string): boolean {
  if (!PIN_PATTERN.test(pin)) return true;
  if (/^(\d)\1+$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - (digits[i] as number));
  return steps.every((s) => s === 1) || steps.every((s) => s === -1);
}
