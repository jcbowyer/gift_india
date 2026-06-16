import { test, expect } from '@playwright/test';

/**
 * Track 1 minimum workflow (README): expand a ranked facility → read citations →
 * override the assessment with a note → see it in My Reviews.
 */
test('expand facility, override assessment, review saved to My Reviews', async ({ page }) => {
  await page.goto('/');

  // Wait for ranked facilities (API may be slow on first load).
  const overrideBtn = page.getByRole('button', { name: /Override/i }).first();
  await expect(overrideBtn).toBeVisible({ timeout: 30_000 });
  await overrideBtn.click();

  await expect(page.locator('[data-demo="facility-expanded"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Supporting evidence/i).first()).toBeVisible({ timeout: 15_000 });

  // Dialog may already be open from row Override; otherwise use the in-panel action.
  const dialog = page.getByRole('dialog');
  if (!(await dialog.isVisible())) {
    await page.getByRole('button', { name: /Override assessment|Edit review/i }).first().click();
  }
  await expect(dialog).toBeVisible();
  await expect(page.getByText('Override assessment')).toBeVisible();

  await page.getByRole('button', { name: /Weak \/ suspicious/i }).click();

  await page.getByLabel(/Qualitative reviewer note/i).fill(
    'Confirmed by phone with district health officer — demo override',
  );
  await page.getByRole('button', { name: 'Save to My Reviews' }).click();

  await expect(page.getByText('My Reviews →')).toBeVisible({ timeout: 10_000 });

  await page.goto('/reviews');
  await expect(page.getByRole('heading', { name: 'My reviews' })).toBeVisible();
  await expect(page.getByText(/Confirmed by phone with district health officer/i).first()).toBeVisible({
    timeout: 10_000,
  });
});
