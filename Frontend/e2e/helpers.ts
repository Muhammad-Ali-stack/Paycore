import { expect, type Page } from '@playwright/test';

export const DEMO = {
  consumer: { button: 'demo-demoConsumer', home: '/home' },
  merchant: { button: 'demo-demoMerchant', home: '/merchant' },
  admin: { button: 'demo-demoAdmin', home: '/admin' },
  checker: { button: 'demo-demoChecker', home: '/admin' },
} as const;

export async function login(page: Page, who: keyof typeof DEMO) {
  await page.goto('/login');
  await page.getByTestId(DEMO[who].button).click();
  await page.getByTestId('login-submit').click();
  await page.waitForURL(`**${DEMO[who].home}`);
}

/** Wallet balances straight from the BFF (same cookies as the page). */
export async function balances(page: Page): Promise<Record<string, bigint>> {
  const res = await page.request.get('/api/proxy/v1/wallets');
  expect(res.ok()).toBeTruthy();
  const wallets = (await res.json()) as { currency: string; balance: { amountMinor: string } }[];
  return Object.fromEntries(wallets.map((w) => [w.currency, BigInt(w.balance.amountMinor)]));
}

/** Pick an option in one of our Radix Select components (by its visible label). */
export async function selectOption(page: Page, trigger: ReturnType<Page['locator']>, option: string | RegExp) {
  await trigger.click();
  await page.getByRole('option', { name: option }).click();
}

export async function enterPin(page: Page, pin: string) {
  const input = page.getByLabel('PIN', { exact: true });
  await input.fill(pin);
  await page.getByTestId('pin-confirm').click();
}
