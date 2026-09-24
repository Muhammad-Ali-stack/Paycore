// @vitest-environment node
/** i18n completeness: every English key exists in Urdu, with the same ICU placeholders. */
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import ur from '../../messages/ur.json';
import enMerchant from '../../messages/en.merchant.json';
import urMerchant from '../../messages/ur.merchant.json';
import enAdmin from '../../messages/en.admin.json';
import urAdmin from '../../messages/ur.admin.json';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/** Top-level ICU argument names, e.g. {amount}, {count, plural, ...}. */
function placeholders(s: string): string[] {
  const names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') {
      if (depth === 0) {
        const m = /^\{\s*([A-Za-z0-9_]+)/.exec(s.slice(i));
        if (m) names.add(m[1]!);
      }
      depth++;
    } else if (s[i] === '}') depth--;
  }
  return [...names].sort();
}

const catalogs = [
  ['core', en, ur],
  ['merchant', enMerchant, urMerchant],
  ['admin', enAdmin, urAdmin],
] as const;

// Proper nouns / codes that legitimately stay identical in both languages.
const SAME_OK = /^(PayCore|PKR|AED|USD|IBAN|CVV|MDR|PIN|OTP|CSV|PDF|ID|Visa|JSON|IP|API|URL|%|—|[\d\s.:/%+-]*)$/;

describe.each(catalogs)('%s messages', (_name, enCat, urCat) => {
  const e = flatten(enCat as unknown as Tree);
  const u = flatten(urCat as unknown as Tree);

  it('every en key exists in ur (and no extras)', () => {
    const missing = Object.keys(e).filter((k) => !(k in u));
    const extra = Object.keys(u).filter((k) => !(k in e));
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  it('ICU placeholders match', () => {
    const mismatched = Object.keys(e).filter(
      (k) => k in u && placeholders(e[k]!).join() !== placeholders(u[k]!).join(),
    );
    expect(mismatched).toEqual([]);
  });

  it('no empty strings', () => {
    expect(
      Object.entries(u)
        .filter(([, v]) => !v.trim())
        .map(([k]) => k),
    ).toEqual([]);
  });

  it('Urdu is actually translated (mostly Arabic script)', () => {
    const arabicScript = /[؀-ۿ]/;
    const untranslated = Object.keys(e).filter(
      (k) => u[k] === e[k] && !SAME_OK.test(e[k]!) && !arabicScript.test(u[k]!),
    );
    // Allow a handful of brand/technical strings; anything more means a missed translation.
    expect(untranslated.length, untranslated.join(', ')).toBeLessThanOrEqual(12);
  });
});
