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
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForRankedResults(page) {
  await page.getByRole('button', { name: /Override/i }).first().waitFor({ timeout: 90_000 });
}

async function enrich(page, idx) {
  if (idx >= 4 && idx <= 8) {
    try {
      const hasOverride = await page.getByRole('button', { name: /Override/i }).first().isVisible({ timeout: 8_000 });
      if (!hasOverride) return;
      if (idx === 4) {
        const combo = page.getByRole('combobox').first();
        if (await combo.isVisible().catch(() => false)) {
          await combo.click();
          const opt = page.getByRole('option', { name: /Maharashtra/i });
          if (await opt.isVisible().catch(() => false)) await opt.click();
          else await page.keyboard.press('Escape');
          await sleep(600);
        }
      }
      if (idx === 7) {
        const sus = page.getByRole('radio', { name: /Suspicious/i });
        if (await sus.isVisible().catch(() => false)) await sus.click();
        await sleep(500);
      }
      if (idx >= 6) {
        const expanded = await page.locator('[data-demo="facility-expanded"]').first().isVisible().catch(() => false);
        if (!expanded) {
          await page.getByRole('button', { name: /Override/i }).first().click();
          await page.locator('[data-demo="facility-expanded"]').first().waitFor({ timeout: 15_000 });
        }
      }
      if (idx === 8) {
        const dlg = page.getByRole('dialog');
        if (!(await dlg.isVisible().catch(() => false))) {
          await page.getByRole('button', { name: /Override assessment|Edit review/i }).first().click({ timeout: 5_000 }).catch(() => undefined);
        }
      }
    } catch {
      /* live data unavailable — still capture the demo frame */
    }
    return;
  }
  if (idx === 9) {
    await page.waitForURL('**/reviews**', { timeout: 15_000 }).catch(() => undefined);
    return;
  }
  if (idx === 10) {
    await page.waitForURL('**/data-quality**', { timeout: 15_000 }).catch(() => undefined);
    await page.locator('[data-demo="data-quality"]').waitFor({ timeout: 10_000 }).catch(() => undefined);
    return;
  }
  if (idx === 11) {
    await page.waitForURL('**/navigator**', { timeout: 15_000 }).catch(() => undefined);
    await page.locator('[data-demo="navigator-map"]').waitFor({ timeout: 10_000 }).catch(() => undefined);
    await sleep(1500);
    return;
  }
  if (idx === 12) {
    await page.waitForURL('**/scorecard**', { timeout: 15_000 }).catch(() => undefined);
    await page.locator('[data-demo="scorecard"]').waitFor({ timeout: 10_000 }).catch(() => undefined);
    const search = page.getByPlaceholder(/search/i);
    if (await search.isVisible().catch(() => false)) {
      await search.fill('Mumbai');
      await sleep(1000);
      const hit = page.getByRole('button').filter({ hasText: /Mumbai|Hospital|Clinic/i }).first();
      if (await hit.isVisible().catch(() => false)) await hit.click();
      await sleep(600);
    }
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
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
      if (atIdx === 1) {
        const reveal = page.getByLabel('Reveal punchline now');
        if (await reveal.isVisible().catch(() => false)) {
          await reveal.click();
          await sleep(1200);
        }
      }
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
