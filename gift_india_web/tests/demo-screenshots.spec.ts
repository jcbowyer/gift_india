import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Capture one full-page screenshot per in-app demo step (DemoGuide.tsx / DEMO.md).
 * Output: demo-screenshots/*.png + manifest.json for build-demo-screenshots-pdf.py
 */
const OUT_DIR = join(process.cwd(), 'demo-screenshots');

const DEMO_STEPS = [
  { idx: 0, clock: '0:00 – 0:20', phase: 'Title', title: 'Beyond the Hospital Directory', route: '/', screen: 'Trust Gauge landing — immersive title card' },
  { idx: 1, clock: '0:20 – 0:45', phase: 'Open', title: 'The secret', route: '/', screen: 'Trust Gauge landing — grit punchline card' },
  { idx: 2, clock: '0:45 – 1:05', phase: 'Open', title: "Priya's User Story", route: '/', screen: 'Trust Gauge landing — Priya narrative' },
  { idx: 3, clock: '1:05 – 1:25', phase: 'Problem', title: 'The burning question', route: '/', screen: 'Trust Gauge — hero stats spotlight' },
  { idx: 4, clock: '1:25 – 1:45', phase: 'Solution', title: 'Capability + region', route: '/', screen: 'ICU capability tile + state filter' },
  { idx: 5, clock: '1:45 – 2:05', phase: 'Solution', title: 'Ranked by evidence', route: '/', screen: 'Ranked facility list with trust dials' },
  { idx: 6, clock: '2:05 – 2:20', phase: 'Solution', title: 'Deep dive on citations', route: '/', screen: 'Expanded facility — supporting citations' },
  { idx: 7, clock: '2:20 – 2:35', phase: 'Solution', title: 'Automated flagging', route: '/', screen: 'Suspicious filter — Human review badge + reason' },
  { idx: 8, clock: '2:35 – 2:50', phase: 'Solution', title: 'Human-in-the-loop override', route: '/', screen: 'Override assessment dialog' },
  { idx: 9, clock: '2:50 – 3:00', phase: 'Solution', title: 'An auditable trail', route: '/reviews', screen: 'My Reviews — override log' },
  { idx: 10, clock: '3:00 – 3:20', phase: 'Why it matters', title: 'Web address · missing & duplicate finder', route: '/data-quality', screen: 'Data Quality — web address KPIs + missing finder' },
  { idx: 11, clock: '3:20 – 3:35', phase: 'Why it matters', title: "Where trust lives — and where it's missing", route: '/navigator', screen: 'Facility Navigator map' },
  { idx: 12, clock: '3:35 – 3:50', phase: 'Why it matters', title: 'Scorecard · flagged capabilities', route: '/scorecard', screen: 'District scorecard — human review flags' },
  { idx: 13, clock: '3:50 – 4:08', phase: 'Why it matters', title: 'How the trust dial works', route: '/', screen: 'Trust scoring explainer (immersive)' },
  { idx: 14, clock: '4:08 – 4:20', phase: 'Why it matters', title: 'SQL scores, narration stub', route: '/', screen: 'Layer 2 narration explainer (immersive)' },
  { idx: 15, clock: '4:20 – 4:30', phase: 'Future', title: "What's scaling next", route: '/', screen: 'JCI cross-ref & anomaly roadmap (immersive)' },
  { idx: 16, clock: '4:30 – 4:42', phase: 'Tech', title: 'Built on Lakehouse', route: '/', screen: 'Lakehouse stack beat (immersive)' },
  { idx: 17, clock: '4:42 – 4:55', phase: 'Tech', title: 'Tech stack: Decisions we made for ourselves', route: '/', screen: 'Decision matrix table (immersive)' },
  { idx: 18, clock: '4:55 – 5:05', phase: 'Open', title: 'The "30 years" problem: Call to Action', route: '/', screen: '30 years CTA (immersive)' },
  { idx: 19, clock: '5:05 – 5:12', phase: 'Future', title: 'Future opportunities', route: '/', screen: 'Future opportunities numbered list (immersive)' },
  { idx: 20, clock: '5:12 – 5:30', phase: 'Close', title: 'Closing the loop', route: '/', screen: 'Closing — hero spotlight' },
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
  if (toIdx === 1) {
    const reveal = page.getByLabel('Reveal punchline now');
    if (await reveal.isVisible().catch(() => false)) {
      await reveal.click();
      await page.waitForTimeout(1200);
    }
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
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: /Override assessment|Edit review/i }).first().click();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
}

async function ensureReviewExists(page: Page) {
  await page.goto('/reviews');
  if (await page.getByText(/Screenshot walkthrough override|Confirmed by phone/i).first().isVisible({ timeout: 3_000 }).catch(() => false)) {
    return;
  }
  await page.goto('/');
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
  if (idx >= 4 && idx <= 8) {
    const hasExpanded = await page.locator('[data-demo="facility-expanded"]').first().isVisible().catch(() => false);
    const hasListOverride = await page.getByRole('button', { name: /Override/i }).first().isVisible().catch(() => false);
    if (!hasExpanded && !hasListOverride) await waitForRankedResults(page);
    if (idx === 4) await pickMaharashtraIfPossible(page);
    if (idx === 7) await switchToSuspiciousFilter(page);
    if (idx >= 6) {
      if (!(await page.locator('[data-demo="facility-expanded"]').first().isVisible().catch(() => false))) {
        await expandFirstFacility(page);
      }
    }
    if (idx === 8) await openOverrideDialog(page);
    return;
  }

  if (idx === 9) {
    await page.waitForURL('**/reviews**', { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /My reviews/i })).toBeVisible({ timeout: 20_000 });
    return;
  }

  if (idx === 10) {
    await page.waitForURL('**/data-quality**', { timeout: 20_000 });
    await openMissingFinderDrill(page);
    return;
  }

  if (idx === 11) {
    await page.waitForURL('**/navigator**', { timeout: 20_000 });
    await expect(page.locator('[data-demo="navigator-map"]')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2000);
    return;
  }

  if (idx === 12) {
    await page.waitForURL('**/scorecard**', { timeout: 20_000 });
    await expect(page.locator('[data-demo="scorecard"]')).toBeVisible({ timeout: 20_000 });
    const search = page.getByPlaceholder(/search/i);
    if (await search.isVisible().catch(() => false)) {
      await search.fill('Mumbai');
      await page.waitForTimeout(1200);
      const result = page.getByRole('button').filter({ hasText: /Mumbai|Hospital|Clinic/i }).first();
      if (await result.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await result.click();
        await page.waitForTimeout(800);
      }
    }
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
