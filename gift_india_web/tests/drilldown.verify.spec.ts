import { test, expect } from '@playwright/test';

// Temporary manual-verification spec for the SoI drilldown map.
test('navigator drilldown: click a state zooms and shows districts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/navigator');
  const svg = page.locator('svg').first();
  await expect(svg).toBeVisible();
  await page.waitForTimeout(1200); // topo + world load

  await page.screenshot({ path: '.smoke-test/drill-0-nation.png' });

  // Click the largest clickable (data-backed) state path so the drill is reliable.
  const pt = await page.evaluate(() => {
    const paths = Array.from(document.querySelectorAll('svg path')) as SVGPathElement[];
    const clickable = paths.filter((p) => getComputedStyle(p).cursor === 'pointer');
    let best: { x: number; y: number; area: number } | null = null;
    for (const p of clickable) {
      const b = p.getBBox();
      const r = p.getBoundingClientRect();
      const area = b.width * b.height;
      if (!best || area > best.area) best = { x: r.x + r.width / 2, y: r.y + r.height / 2, area };
    }
    return best;
  });
  if (!pt) throw new Error('no clickable state path found');
  await page.mouse.click(pt.x, pt.y);

  // Breadcrumb should now show a Back button (we drilled in).
  const back = page.getByRole('button', { name: /Back/i });
  await expect(back).toBeVisible();
  await page.waitForTimeout(1100); // let van Wijk zoom + district fade-in settle

  await page.screenshot({ path: '.smoke-test/drill-1-state.png', animations: 'disabled', timeout: 5000 }).catch(() => undefined);

  expect(errors, `console/page errors: ${errors.join('\n')}`).toEqual([]);
});
