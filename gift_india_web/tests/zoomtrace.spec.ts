import { test } from '@playwright/test';
const G = 'svg.touch-none > g';
const k = (t:string|null) => { const m=t&&t.match(/scale\(([0-9.]+)\)/); return m?(+m[1]).toFixed(2):'?'; };
test('zoom trace', async ({ page }) => {
  const logs:string[]=[];
  page.on('console', m => { const t=m.text(); if(t.startsWith('DRILLFX')) logs.push(t); });
  await page.goto('/navigator');
  await page.locator('svg.touch-none').waitFor();
  await page.waitForTimeout(1500);
  const pt = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('svg.touch-none path')) as SVGPathElement[];
    const c = ps.filter(p => getComputedStyle(p).cursor === 'pointer');
    let best:any=null; for(const p of c){const r=p.getBoundingClientRect();const a=r.width*r.height;if(!best||a>best.area)best={x:r.x+r.width/2,y:r.y+r.height/2,area:a};}
    return best;
  });
  await page.mouse.click(pt.x, pt.y);
  const traj:string[]=[];
  for(let i=0;i<16;i++){ await page.waitForTimeout(200); traj.push(k(await page.locator(G).getAttribute('transform'))); }
  console.log('TRAJECTORY::'+traj.join(','));
});
