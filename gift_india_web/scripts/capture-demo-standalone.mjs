#!/usr/bin/env node
/**
 * Fast demo screenshot capture against an already-running dev server (no Playwright webServer).
 * Usage: node scripts/capture-demo-standalone.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.DEMO_BASE_URL || 'http://localhost:8000';
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
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForRankedResults(page) {
  await page.getByRole('button', { name: /Override/i }).first().waitFor({ timeout: 90_000 });
}

async function pickMaharashtraIfPossible(page) {
  const stateCombo = page.getByRole('combobox').first();
  if (!(await stateCombo.isVisible().catch(() => false))) return;
  await stateCombo.click();
  const maharashtra = page.getByRole('option', { name: /Maharashtra/i });
  if (await maharashtra.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await maharashtra.click();
    await sleep(800);
  } else {
    await page.keyboard.press('Escape');
  }
}

async function enrich(page, idx) {
  if (idx === 3) {
    await page.getByRole('button', { name: /^ICU$/i }).click();
    await sleep(400);
    await pickMaharashtraIfPossible(page);
  }
  if (idx === 4) await waitForRankedResults(page);
  if (idx === 5) {
    await waitForRankedResults(page);
    const expand = page.getByRole('button', { name: /Expand|Show details/i }).first();
    if (await expand.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expand.click();
      await sleep(500);
    }
  }
  if (idx === 6) {
    const suspicious = page.getByRole('button', { name: /Suspicious/i });
    if (await suspicious.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await suspicious.click();
      await sleep(600);
    }
  }
  if (idx === 7) {
    const override = page.getByRole('button', { name: /Override assessment/i }).first();
    if (await override.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await override.click();
      await sleep(500);
    }
  }
  if (idx === 9) {
    await page.goto(BASE + '/data-quality');
    await sleep(800);
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  await page.goto(BASE + '/');
  await page.getByRole('button', { name: /Demo walkthrough/i }).click();
  await page.getByRole('dialog', { name: 'Demo walkthrough' }).waitFor({ timeout: 15_000 });

  const manifest = [];
  let atIdx = 0;

  for (const step of DEMO_STEPS) {
    while (atIdx < step.idx) {
      await page.keyboard.press('ArrowRight');
      await sleep(550);
      atIdx++;
    }
    await sleep(400);
    await enrich(page, step.idx);

    const slug = String(step.idx + 1).padStart(2, '0');
    const file = `${slug}-${step.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}.png`;
    await page.screenshot({ path: join(OUT_DIR, file), fullPage: false, animations: 'disabled' });
    manifest.push({ ...step, file });
    console.log(`Captured ${step.idx + 1}/${DEMO_STEPS.length}: ${file}`);
  }

  await page.keyboard.press('Escape');
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await browser.close();
  console.log(`Done — ${manifest.length} screenshots in ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
