import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login } from './helpers';

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // Recharts draws decorative SVG internals; the charts carry role="img" + aria-label.
    .exclude('.recharts-surface')
    .analyze();
  return results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  );
}

test.describe('Accessibility (axe, WCAG 2.1 AA incl. colour contrast on the dark theme)', () => {
  test('login page', async ({ page }) => {
    await page.goto('/login');
    expect(await axe(page)).toEqual([]);
  });

  for (const path of ['/home', '/send', '/scan', '/topup', '/activity', '/cards', '/bills', '/profile']) {
    test(`consumer ${path}`, async ({ page }) => {
      await login(page, 'consumer');
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      expect(await axe(page)).toEqual([]);
    });
  }

  test('PIN sheet dialog', async ({ page }) => {
    await login(page, 'consumer');
    await page.goto('/send?to=%40ali_k');
    await page.getByTestId('amount-input').fill('10');
    await page.getByTestId('send-review').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test('merchant and admin portals', async ({ page }) => {
    await login(page, 'merchant');
    await page.goto('/merchant/qr');
    await page.waitForLoadState('networkidle');
    expect(await axe(page)).toEqual([]);
    await page.getByTestId('user-menu').filter({ visible: true }).click();
    await page.getByTestId('sign-out').click();
    await page.waitForURL('**/login');
    await login(page, 'admin');
    await page.goto('/admin/approvals');
    await page.waitForLoadState('networkidle');
    expect(await axe(page)).toEqual([]);
  });

  test('keyboard: skip link and gold focus ring', async ({ page }) => {
    await login(page, 'consumer');
    await page.goto('/home'); // fresh document: focus starts at the top
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    const outline = await skip.evaluate((el) => getComputedStyle(el).outlineColor);
    expect(outline).toBe('rgb(200, 162, 107)'); // --pc-accent
  });
});

test.describe('Urdu / RTL', () => {
  test('switching to Urdu flips direction, translates, keeps money LTR, and stays accessible', async ({ page }) => {
    await login(page, 'consumer');
    await page.goto('/profile');
    await page.waitForLoadState('networkidle'); // hydrated before clicking
    await page.getByRole('radio', { name: 'اردو' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ur');

    await page.goto('/home');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('السلام علیکم');

    // Desktop sidebar sits on the right in RTL.
    const sidebar = page.locator('aside').first();
    const box = await sidebar.boundingBox();
    const width = page.viewportSize()!.width;
    expect(box!.x).toBeGreaterThan(width / 2);

    // Money renders as an isolated LTR run with Latin digits.
    const total = page.getByTestId('total-balance').locator('.money');
    await expect(total).toHaveCSS('direction', 'ltr');
    await expect(total).toHaveText(/\d{1,3}(,\d{3})*\.\d{2}/);

    expect(await axe(page)).toEqual([]);

    // Back to English for the remaining tests.
    await page.goto('/profile');
    await page.waitForLoadState('networkidle'); // hydrated before clicking
    await page.getByRole('radio', { name: 'English (انگریزی)' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('mobile layout uses the bottom tab bar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, 'consumer');
    const tabs = page.getByRole('navigation', { name: 'Primary' }).last();
    await expect(tabs).toBeVisible();
    const box = await tabs.boundingBox();
    expect(box!.y + box!.height).toBeGreaterThan(800);
    await expect(page.locator('aside').first()).toBeHidden();
  });
});

test.describe('Route protection', () => {
  test('anonymous users are sent to login; wrong roles get /forbidden', async ({ page }) => {
    await page.goto('/cards');
    await expect(page).toHaveURL(/\/login\?next=%2Fcards/);
    await login(page, 'consumer');
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/forbidden$/);
    await page.goto('/merchant');
    await expect(page).toHaveURL(/\/forbidden$/);
  });

  test('tokens are httpOnly cookies, never readable by JS', async ({ page, context }) => {
    await login(page, 'consumer');
    const cookies = await context.cookies();
    const at = cookies.find((c) => c.name === 'pc_at')!;
    expect(at.httpOnly).toBe(true);
    expect(at.secure).toBe(true);
    expect(at.sameSite).toBe('Lax');
    expect(await page.evaluate(() => document.cookie)).not.toContain('pc_at');
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/eyJ/); // no JWTs in storage
  });

  test('responses carry a nonce-based CSP', async ({ page }) => {
    const res = await page.goto('/login');
    const csp = res!.headers()['content-security-policy'];
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
