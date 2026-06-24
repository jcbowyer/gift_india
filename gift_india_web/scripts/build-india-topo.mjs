#!/usr/bin/env node
/**
 * Build simplified India map topologies for the navigator:
 *   - india-topo.json          nation + states only (~175 KB) — default nation view
 *   - topo/india-{region}.json states + districts per zone (~200–400 KB)
 *   - topo/districts/{state}.json per-state district layer for lazy drill-down
 *
 * Requires mapshaper on PATH. Source: data/topo/india-topo-source.json
 * (copy of the full SoI TopoJSON; not served to the client).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'data/topo/india-topo-source.json');
const publicDir = path.join(root, 'client/public');
const topoDir = path.join(publicDir, 'topo');
const districtDir = path.join(topoDir, 'districts');

/** Mirrors server/routes/gift_india/regions.ts */
const REGION_TO_STATES = {
  North: [
    'Jammu & Kashmir', 'Ladakh', 'Himachal Pradesh', 'Punjab', 'Haryana',
    'Delhi', 'Rajasthan', 'Chandigarh', 'Uttarakhand',
  ],
  Central: ['Uttar Pradesh', 'Madhya Pradesh', 'Chhattisgarh'],
  East: ['Bihar', 'Jharkhand', 'Odisha', 'West Bengal'],
  West: ['Maharashtra', 'Gujarat', 'Goa', 'Dadra & Nagar Haveli and Daman & Diu', 'Daman & Diu'],
  South: [
    'Karnataka', 'Telangana', 'Andhra Pradesh', 'Tamil Nadu', 'Kerala',
    'Puducherry', 'Lakshadweep', 'Andaman & Nicobar Islands',
  ],
  'North-East': [
    'Assam', 'Arunachal Pradesh', 'Nagaland', 'Manipur', 'Meghalaya',
    'Mizoram', 'Tripura', 'Sikkim',
  ],
};

const REGION_SLUG = {
  North: 'north',
  Central: 'central',
  East: 'east',
  West: 'west',
  South: 'south',
  'North-East': 'north-east',
};

function normState(s) {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

function stateFilterExpr(states) {
  const norms = states.map(normState);
  return `[${norms.map((n) => JSON.stringify(n)).join(',')}].indexOf(st_nm.toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]/g,"")) > -1`;
}

function runMapshaper(args, label) {
  const res = spawnSync('mapshaper', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.status !== 0) {
    console.error(`[build-india-topo] ${label} failed:\n${res.stderr || res.stdout}`);
    process.exit(1);
  }
  if (res.stdout.trim()) process.stdout.write(res.stdout);
}

function kb(file) {
  return `${(fs.statSync(file).size / 1024).toFixed(0)} KB`;
}

if (!fs.existsSync(source)) {
  const soiSource = path.join(root, '../../.soi_shapefiles/out/india-soi-topo.json');
  const fallback = path.join(publicDir, 'india-topo.json');
  if (fs.existsSync(soiSource)) {
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.copyFileSync(soiSource, source);
    console.log('[build-india-topo] Seeded source from .soi_shapefiles/out/india-soi-topo.json');
  } else if (fs.existsSync(fallback)) {
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.copyFileSync(fallback, source);
    console.log('[build-india-topo] Seeded source from client/public/india-topo.json');
  } else {
    console.error('[build-india-topo] Missing data/topo/india-topo-source.json');
    console.error('  Build SoI topo first, or run: npm run build:topo after placing india-topo-source.json');
    process.exit(1);
  }
}

function hasMapshaper() {
  return spawnSync('which', ['mapshaper'], { encoding: 'utf8' }).status === 0;
}

fs.mkdirSync(topoDir, { recursive: true });
fs.mkdirSync(districtDir, { recursive: true });

const nationOut = path.join(publicDir, 'india-topo.json');
if (!hasMapshaper()) {
  if (fs.existsSync(nationOut)) {
    console.log('[build-india-topo] mapshaper not on PATH; using committed client/public/topo assets');
    process.exit(0);
  }
  console.error('[build-india-topo] mapshaper is required to build topo assets (install mapshaper or commit client/public/topo)');
  process.exit(1);
}

const simplify = ['-simplify', 'dp', '0.008', 'keep-shapes'];

// Nation view: states + nation outline only (districts lazy-loaded per state).
runMapshaper([source, ...simplify, '-o', 'target=nation,states', nationOut], 'nation topo');
console.log(`[build-india-topo] ${nationOut} (${kb(nationOut)})`);

// Zonal topologies: states + districts for the selected region filter.
for (const [region, states] of Object.entries(REGION_TO_STATES)) {
  const slug = REGION_SLUG[region];
  const out = path.join(topoDir, `india-${slug}.json`);
  const expr = stateFilterExpr(states);
  runMapshaper(
    [
      source,
      ...simplify,
      '-filter', expr, 'target=states,districts',
      '-drop', 'target=nation',
      '-o', out,
    ],
    `region ${region}`,
  );
  console.log(`[build-india-topo] ${out} (${kb(out)})`);
}

// Per-state district layers for drill-down when viewing all of India.
const allStates = [...new Set(Object.values(REGION_TO_STATES).flat())];
for (const state of allStates) {
  const slug = normState(state);
  const out = path.join(districtDir, `${slug}.json`);
  const expr = `st_nm.toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9]/g,"") == ${JSON.stringify(slug)}`;
  runMapshaper(
    [source, ...simplify, '-filter', expr, 'target=districts', '-o', out],
    `districts ${state}`,
  );
}
console.log(`[build-india-topo] ${allStates.length} state district layers → ${districtDir}/`);
