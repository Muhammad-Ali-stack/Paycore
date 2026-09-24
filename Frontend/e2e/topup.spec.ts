import { expect, test } from '@playwright/test';
import { balances, login } from './helpers';

test.describe('Top up (simulated bank)', () => {
  test('bank transfer goes PENDING -> SUCCEEDED and only then credits the wallet', async ({ page }) => {
    await login(page, 'consumer');
    const before = await balances(page);

    await page.goto('/topup');
    await page.getByTestId('topup-amount').fill('2500');
    await page.getByTestId('topup-continue').click();
    await page.getByTestId('topup-confirm').click();

    await page.waitForURL('**/funding/*');
    const status = page.getByTestId('funding-status');
    await expect(status).toHaveText('PENDING');
    await expect(page.getByText('Transfer instructions')).toBeVisible();
    // Not credited while pending.
    expect((await balances(page)).PKR).toBe(before.PKR);

    // The page polls until the bank answers (mock delay 3 s).
    await expect(status).toHaveText('SUCCEEDED', { timeout: 20_000 });
    await expect(page.getByText(/was added to your wallet/)).toBeVisible();
    const after = await balances(page);
    expect(after.PKR! - before.PKR!).toBe(250000n);
  });

  test('a declined transfer ends FAILED and nothing is credited', async ({ page }) => {
    await login(page, 'consumer');
    const before = await balances(page);
    await page.goto('/topup');
    await page.getByTestId('topup-amount').fill('13.13'); // mock: amounts ending .13 fail
    await page.getByTestId('topup-continue').click();
    await page.getByTestId('topup-confirm').click();
    await page.waitForURL('**/funding/*');
    await expect(page.getByTestId('funding-status')).toHaveText('FAILED', { timeout: 20_000 });
    await expect(page.getByText("The bank didn't complete this transfer.")).toBeVisible();
    expect((await balances(page)).PKR).toBe(before.PKR);
  });
});
