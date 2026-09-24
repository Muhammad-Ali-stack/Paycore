/**
 * Message catalogs are split per area so teams can own them:
 *   messages/<locale>.json           core + consumer
 *   messages/<locale>.merchant.json  { merchant: ... }
 *   messages/<locale>.admin.json     { admin: ... }
 * Top-level namespaces are disjoint, so a shallow merge is enough.
 */
import type core from '../../messages/en.json';
import type merchant from '../../messages/en.merchant.json';
import type admin from '../../messages/en.admin.json';
import type { Locale } from './config';

export type Messages = typeof core & typeof merchant & typeof admin;

export async function loadMessages(locale: Locale): Promise<Messages> {
  const [c, m, a] = await Promise.all([
    import(`../../messages/${locale}.json`),
    import(`../../messages/${locale}.merchant.json`),
    import(`../../messages/${locale}.admin.json`),
  ]);
  return { ...c.default, ...m.default, ...a.default } as Messages;
}
