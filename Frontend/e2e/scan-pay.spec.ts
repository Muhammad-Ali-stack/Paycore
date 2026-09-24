import { expect, test } from '@playwright/test';
import QRCode from 'qrcode';
import { STATIC_QR_PAYLOAD } from '../src/mocks/db';
import { balances, enterPin, login } from './helpers';

test.describe('Scan & pay', () => {
  test('static merchant QR (pasted code): payer enters the amount', async ({ page }) => {
    await login(page, 'consumer');
    const before = await balances(page);
    await page.goto('/scan');
    await page.getByTestId('qr-paste').fill(STATIC_QR_PAYLOAD);
    await page.getByTestId('qr-paste-submit').click();

    const preview = page.getByTestId('qr-preview');
    await expect(preview.getByTestId('qr-payee')).toHaveText('Chai Point');
    await expect(preview).toContainText('Chai Point, Gulberg');
    await page.getByTestId('qr-amount').fill('350');
    await page.getByTestId('qr-pay').click();
    await enterPin(page, '1234');

    const receipt = page.getByTestId('receipt-success');
    await expect(receipt).toContainText('Paid');
    await expect(receipt).toContainText('Chai Point');
    const after = await balances(page);
    expect(before.PKR! - after.PKR!).toBe(35000n);
  });

  test('file-upload fallback decodes a QR image (no camera in CI)', async ({ page }) => {
    await login(page, 'consumer');
    await page.goto('/scan');
    const png = await QRCode.toBuffer(STATIC_QR_PAYLOAD, { errorCorrectionLevel: 'M', margin: 4, scale: 8 });
    await page.getByTestId('qr-upload').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByTestId('qr-payee')).toHaveText('Chai Point');
  });

  test('dynamic merchant QR: pay once via the camera test hook, second attempt is rejected', async ({ browser }) => {
    // Merchant generates a dynamic QR for Rs 1,250.00.
    const merchantCtx = await browser.newContext();
    const merchant = await merchantCtx.newPage();
    await login(merchant, 'merchant');
    await merchant.goto('/merchant/qr');
    await merchant.getByTestId('dynamic-qr-amount').fill('1250');
    await merchant.getByTestId('dynamic-qr-generate').click();
    const payloadEl = merchant.getByTestId('dynamic-qr-payload');
    await expect(payloadEl).toHaveText(/^PC1\./);
    const payload = (await payloadEl.textContent())!.trim();
    await expect(merchant.getByTestId('dynamic-qr-status')).toHaveText('ACTIVE');

    // Consumer "scans" it (mock-mode hook stands in for the camera).
    const consumerCtx = await browser.newContext();
    const consumer = await consumerCtx.newPage();
    await login(consumer, 'consumer');
    await consumer.goto('/scan');
    await consumer.waitForFunction(() => typeof window.__paycoreInjectQr === 'function');
    await consumer.evaluate((p) => window.__paycoreInjectQr!(p), payload);
    const preview = consumer.getByTestId('qr-preview');
    await expect(preview).toContainText('Amount set by merchant');
    await expect(preview).toContainText('1,250.00');
    await consumer.getByTestId('qr-pay').click();
    await enterPin(consumer, '1234');
    await expect(consumer.getByTestId('receipt-success')).toContainText('Chai Point');

    // Cashier screen flips to PAID by polling.
    await expect(merchant.getByTestId('dynamic-qr-status')).toHaveText('PAID', { timeout: 15_000 });

    // Single use: scanning again fails with QR_ALREADY_PAID.
    await consumer.getByRole('button', { name: 'Scan another' }).click();
    await consumer.waitForFunction(() => typeof window.__paycoreInjectQr === 'function');
    await consumer.evaluate((p) => window.__paycoreInjectQr!(p), payload);
    await expect(consumer.getByRole('alert').filter({ hasText: 'already been paid' })).toContainText(
      'This QR code has already been paid.',
    );

    await merchantCtx.close();
    await consumerCtx.close();
  });

  test('tampered payloads are rejected as invalid', async ({ page }) => {
    await login(page, 'consumer');
    await page.goto('/scan');
    await page.getByTestId('qr-paste').fill(`${STATIC_QR_PAYLOAD.slice(0, -3)}abc`);
    await page.getByTestId('qr-paste-submit').click();
    await expect(page.getByRole('alert').filter({ hasText: 'valid PayCore' })).toContainText(
      "This isn't a valid PayCore QR code.",
    );
  });
});
