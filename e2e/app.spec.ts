import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers';

test('title screen lists the three worlds and enters one from the keyboard', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?e2e');
  await expect(page.getByRole('heading', { name: 'Slowlight' })).toBeVisible();
  await expect(page.locator('.plate')).toHaveCount(3);
  await page.locator('.plate[data-world="slow-light"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as any).slowlight?.world === 'slow-light');
  await expect(page.locator('.tour-title')).toHaveText('A town at 12 m/s');
  await page.getByRole('button', { name: '← Worlds' }).click();
  await expect(page.locator('.plate')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('a shared link restores the dial settings', async ({ page }) => {
  await page.goto('./?world=slow-light&quality=low&e2e&c=50');
  await page.waitForFunction(() => (window as any).slowlight?.world === 'slow-light');
  const c = await page.evaluate(() => (window as any).slowlight.constants.c);
  expect(c).toBeCloseTo(50, 6);
  await expect(page.locator('.dial-value').first()).toContainText('50 m/s');
});

test('phone layout keeps the dials behind a toggle', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?world=slow-light&quality=low&e2e');
  await page.waitForFunction(() => (window as any).slowlight?.frames > 3);
  await expect(page.locator('#panel')).toBeHidden();
  await page.getByRole('button', { name: 'Dials' }).click();
  await expect(page.locator('#panel')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
