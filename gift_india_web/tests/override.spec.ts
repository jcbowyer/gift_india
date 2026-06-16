import { test, expect } from '@playwright/test';

/**
 * Track 1 minimum workflow (README): expand a ranked facility → read citations →
 * override the assessment with a note → see it in My Reviews.
 */
test('expand facility, override assessment, review saved to My Reviews', async ({ page }) => {
  await page.goto('/');

  // Wait for ranked facilities (API may be slow on first load).
  const firstRow = page.locator('[data-demo="results"] button').first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  await firstRow.click();

  await expect(page.locator('[data-demo="facility-expanded"]')).toBeVisible();
  await expect(page.getByText(/Supporting evidence/i).first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /Override assessment|Edit planner review/i }).click();

  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Override assessment')).toBeVisible();

  await page.getByLabel(/Qualitative reviewer note/i).fill(
    'Confirmed by phone with district health officer — demo override',
  );
  await page.getByRole('button', { name: 'Save to My Reviews' }).click();

  await expect(page.getByText('View in My Reviews')).toBeVisible({ timeout: 10_000 });

  await page.goto('/reviews');
  await expect(page.getByRole('heading', { name: 'My reviews' })).toBeVisible();
  await expect(page.getByText(/Confirmed by phone with district health officer/i).first()).toBeVisible({
    timeout: 10_000,
  });
});
