import { expect, test } from '@playwright/test';
import { balances, enterPin, login, selectOption } from './helpers';

test.describe('Send money', () => {
  test('cross-currency transfer with live FX quote, wrong PIN, then success receipt', async ({ page }) => {
    await login(page, 'consumer');
    const before = await balances(page);

    await page.goto('/send');
    await page.getByTestId('recipient-search').fill('@sara');
    await page.getByTestId('recipient-find').click();
    await expect(page.getByTestId('recipient-name')).toHaveText('Sara A.');

    // Send PKR, Sara receives AED -> FX quote.
    await selectOption(page, page.getByRole('combobox', { name: 'From wallet' }), /^PKR/);
    await selectOption(page, page.getByRole('combobox', { name: 'They receive in' }), 'AED');
    await page.getByTestId('amount-input').fill('5000');

    const quote = page.getByTestId('quote-panel');
    await expect(quote.getByTestId('fx-rate')).toContainText('1 PKR =');
    await expect(quote).toContainText('Mid-market');
    await expect(quote.getByTestId('quote-countdown')).toContainText(/Quote expires in \d+s/);
    await expect(quote).toContainText('Rs'); // fee in PKR
    await expect(quote).toContainText('Total debited');

    await page.getByTestId('send-review').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Enter your PIN');

    // Wrong PIN: stays open, shows attempts remaining, clears the field.
    await enterPin(page, '9999');
    await expect(dialog.getByRole('alert')).toContainText(/Incorrect PIN\. \d attempts? left\./);
    await expect(page.getByLabel('PIN', { exact: true })).toHaveValue('');

    await enterPin(page, '1234');
    const receipt = page.getByTestId('receipt-success');
    await expect(receipt).toBeVisible();
    await expect(receipt).toContainText('Sent');
    await expect(receipt).toContainText('Sara A.');
    await expect(receipt.getByTestId('payment-id')).toHaveText(/^[0-9A-F]{8}$/);

    // PKR decreased by 5,000.00 + the fixed FX fee (Rs 50.00); balances never go through floats.
    const after = await balances(page);
    expect(before.PKR! - after.PKR!).toBe(500000n + 5000n);

    // The activity feed shows the transfer.
    await page.goto('/activity');
    await expect(page.getByTestId('activity-row').first()).toContainText('To Sara A.');
  });

  test('same-currency transfer has no FX and no fee', async ({ page }) => {
    await login(page, 'consumer');
    await page.goto('/send?to=%40ali_k');
    await expect(page.getByTestId('recipient-name')).toHaveText('Ali K.');
    await selectOption(page, page.getByRole('combobox', { name: 'From wallet' }), /^PKR/);
    await page.getByTestId('amount-input').fill('250');
    await expect(page.getByTestId('quote-panel')).toContainText('No conversion, no fee');
    await page.getByTestId('send-review').click();
    await enterPin(page, '1234');
    await expect(page.getByTestId('receipt-success')).toContainText('Ali K.');
  });

  test('unknown recipient shows a not-found message', async ({ page }) => {
    await login(page, 'consumer');
    await page.goto('/send');
    await page.getByTestId('recipient-search').fill('@nobody_here');
    await page.getByTestId('recipient-find').click();
    await expect(page.getByText('No PayCore user with that phone or username.')).toBeVisible();
  });
});
