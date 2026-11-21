import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Capture one full-page screenshot per in-app demo step (DemoGuide.tsx / DEMO.md).
 * Output: demo-screenshots/*.png + manifest.json for build-demo-screenshots-pdf.py
 */
const OUT_DIR = join(process.cwd(), 'demo-screenshots');

const DEMO_STEPS = [
  { idx: 0, clock: '0:00 – 0:20', phase: 'Title', title: 'Beyond the Hospital Directory', route: '/', screen: 'Trust Gauge landing — Before/After process improvement slide' },
  { idx: 1, clock: '0:20 – 0:32', phase: 'Open', title: "Priya's User Story", route: '/', screen: 'Trust Gauge landing — Priya narrative' },
  { idx: 2, clock: '0:32 – 0:42', phase: 'Problem', title: 'The burning question', route: '/', screen: 'Trust Gauge — hero stats spotlight' },
  { idx: 3, clock: '0:42 – 0:52', phase: 'Solution', title: 'Capability + region', route: '/', screen: 'ICU capability tile + state filter' },
  { idx: 4, clock: '0:52 – 1:04', phase: 'Solution', title: 'Ranked by evidence', route: '/', screen: 'Ranked facility list with trust dials' },
  { idx: 5, clock: '1:04 – 1:22', phase: 'Solution', title: 'Third-party evidence — not website copy', route: '/', screen: 'Expanded facility — NABH/registry citations' },
  { idx: 6, clock: '1:22 – 1:32', phase: 'Solution', title: 'Automated flagging', route: '/', screen: 'Suspicious filter — Human review badge + reason' },
  { idx: 7, clock: '1:32 – 1:42', phase: 'Solution', title: 'Human-in-the-loop override', route: '/', screen: 'Override assessment dialog' },
  { idx: 8, clock: '1:42 – 1:52', phase: 'Solution', title: 'An auditable trail', route: '/reviews', screen: 'My Reviews — override log' },
  { idx: 9, clock: '1:52 – 2:07', phase: 'Why it matters', title: 'Splink dedupe & registry crosswalk', route: '/data-quality', screen: 'Data Quality — Splink merge recommendations' },
  { idx: 10, clock: '2:07 – 2:19', phase: 'Why it matters', title: 'How the trust dial works', route: '/', screen: 'Trust scoring explainer (immersive)' },
  { idx: 11, clock: '2:19 – 2:31', phase: 'Tech', title: 'Built on Lakehouse', route: '/', screen: 'Lakehouse stack beat (immersive)' },
  { idx: 12, clock: '2:31 – 3:00', phase: 'Close', title: 'Closing the loop', route: '/', screen: 'Closing — hero spotlight' },
] as const;

const PAGE_HEADING = /Governance, Integrity.*GIFT.*Gauge/i;

async function startDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Demo walkthrough/i }).click();
  await expect(page.getByRole('dialog', { name: 'Demo walkthrough' })).toBeVisible({ timeout: 15_000 });
}

async function advanceToStep(page: Page, fromIdx: number, toIdx: number) {
  for (let i = fromIdx; i < toIdx; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(600);
  }
}

async function exitDemo(page: Page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

async function waitForRankedResults(page: Page) {
  await expect(page.getByRole('button', { name: /Override/i }).first()).toBeVisible({ timeout: 60_000 });
}

async function pickMaharashtraIfPossible(page: Page) {
  const stateCombo = page.getByRole('combobox').first();
  if (!(await stateCombo.isVisible().catch(() => false))) return;
  await stateCombo.click();
  const maharashtra = page.getByRole('option', { name: /Maharashtra/i });
  if (await maharashtra.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await maharashtra.click();
    await page.waitForTimeout(800);
  } else {
    await page.keyboard.press('Escape');
  }
}

async function switchToSuspiciousFilter(page: Page) {
  const suspicious = page.getByRole('radio', { name: /Suspicious/i });
  if (await suspicious.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await suspicious.click();
    await page.waitForTimeout(600);
  }
}

async function expandFirstFacility(page: Page) {
  const rowBtn = page.getByRole('button', { name: /Override/i }).first();
  await rowBtn.click();
  await expect(page.locator('[data-demo="facility-expanded"]').first()).toBeVisible({ timeout: 15_000 });
}

async function openOverrideDialog(page: Page) {
  const dialog = page.getByRole('dialog', { name: /Override|assessment/i });
  if (await dialog.isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: /Override assessment|Edit review/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
}

async function ensureReviewExists(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: PAGE_HEADING })).toBeVisible({ timeout: 30_000 });
  await page.goto('/reviews');
  if (await page.getByText(/Screenshot walkthrough override|Confirmed by phone/i).first().isVisible({ timeout: 3_000 }).catch(() => false)) {
    return;
  }
  await page.goto('/');
  await page.getByRole('button', { name: /^ICU$/i }).click();
  await pickMaharashtraIfPossible(page);
  await waitForRankedResults(page);
  await expandFirstFacility(page);
  await openOverrideDialog(page);
  await page.getByRole('button', { name: /Weak \/ suspicious|Strong/i }).first().click();
  const note = `Screenshot walkthrough override — ${new Date().toISOString()}`;
  await page.getByLabel(/Qualitative reviewer note/i).fill(note);
  await page.getByRole('button', { name: 'Save to My Reviews' }).click();
  await expect(page.getByText('My Reviews →')).toBeVisible({ timeout: 15_000 });
}

async function openMissingFinderDrill(page: Page) {
  await expect(page.locator('[data-demo="data-quality"]')).toBeVisible({ timeout: 20_000 });
  const missingCell = page.locator('tbody tr').filter({ has: page.locator('span.text-red-600') }).first();
  if (await missingCell.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await missingCell.click();
    await page.waitForTimeout(1200);
  }
}

/** Set up live UI while the demo guide is on an app-focus step (no route changes). */
async function enrichLiveUiForStep(page: Page, idx: number) {
  if (idx === 3) {
    await page.getByRole('button', { name: /^ICU$/i }).click();
    await page.waitForTimeout(400);
    await pickMaharashtraIfPossible(page);
    return;
  }

  if (idx >= 4 && idx <= 7) {
    const hasExpanded = await page.locator('[data-demo="facility-expanded"]').first().isVisible().catch(() => false);
    const hasListOverride = await page.getByRole('button', { name: /Override/i }).first().isVisible().catch(() => false);
    if (!hasExpanded && !hasListOverride) await waitForRankedResults(page);
    if (idx === 6) await switchToSuspiciousFilter(page);
    if (idx >= 5) {
      if (!(await page.locator('[data-demo="facility-expanded"]').first().isVisible().catch(() => false))) {
        await expandFirstFacility(page);
      }
    }
    if (idx === 7) await openOverrideDialog(page);
    return;
  }

  if (idx === 8) {
    await page.waitForURL('**/reviews**', { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /My reviews/i })).toBeVisible({ timeout: 20_000 });
    return;
  }

  if (idx === 9) {
    await page.waitForURL('**/data-quality**', { timeout: 20_000 });
    await openMissingFinderDrill(page);
  }
}

test.describe.configure({ mode: 'serial' });

test('capture demo walkthrough screenshots', async ({ page }) => {
  test.setTimeout(12 * 60_000);
  await page.setViewportSize({ width: 1280, height: 800 });

  mkdirSync(OUT_DIR, { recursive: true });
  const manifest: Array<(typeof DEMO_STEPS)[number] & { file: string }> = [];

  await ensureReviewExists(page);
  await startDemo(page);

  let atIdx = 0;
  for (const step of DEMO_STEPS) {
    await advanceToStep(page, atIdx, step.idx);
    atIdx = step.idx;
    await enrichLiveUiForStep(page, step.idx);

    const slug = String(step.idx + 1).padStart(2, '0');
    const file = `${slug}-${step.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}.png`;
    const path = join(OUT_DIR, file);
    await page.screenshot({ path, fullPage: false, animations: 'disabled' });
    manifest.push({ ...step, file });
    console.log(`Captured step ${step.idx + 1}/${DEMO_STEPS.length}: ${file}`);
  }

  await exitDemo(page);
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`Wrote ${manifest.length} screenshots to ${OUT_DIR}`);
});
