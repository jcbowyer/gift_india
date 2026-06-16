import type { StateRating } from './api';
import { normName, placeMatch } from './mapPalette';

/** Canonical Survey-of-India state / UT names used for map roll-ups. */
export const CANONICAL_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman & Nicobar Islands',
  'Chandigarh',
  'Dadra & Nagar Haveli and Daman & Diu',
  'Delhi',
  'Jammu & Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
] as const;

const CANONICAL_NORM = new Set(CANONICAL_STATES.map((s) => normName(s)));

/** Collapse API state labels onto canonical map states (mirrors server `stateCanonical`). */
export function resolveMapState(raw: string): string {
  const commaTail = raw.includes(',') ? raw.split(',').pop()?.trim() : null;
  if (commaTail) {
    const fromTail = resolveMapState(commaTail);
    if (CANONICAL_NORM.has(normName(fromTail))) return fromTail;
  }

  const n = normName(raw);
  const alias = STATE_ALIASES[n];
  if (alias) return alias;

  const exact = CANONICAL_STATES.find((s) => normName(s) === n);
  if (exact) return exact;

  const loose = CANONICAL_STATES.find((s) => placeMatch(s, raw));
  return loose ?? raw;
}

/** Merge per-facility state rows onto canonical states so map totals reconcile. */
export function rollupStateRatings(ratings: StateRating[]): StateRating[] {
  const buckets = new Map<string, StateRating & { _scoreSum: number }>();

  for (const r of ratings) {
    const state = resolveMapState(r.state);
    const cur = buckets.get(state);
    if (!cur) {
      buckets.set(state, {
        ...r,
        state,
        _scoreSum: r.avgScore !== null && r.claiming > 0 ? r.avgScore * r.claiming : 0,
      });
      continue;
    }
    cur.facilities += r.facilities;
    cur.claiming += r.claiming;
    cur.strong += r.strong;
    cur.partial += r.partial;
    cur.weak += r.weak;
    cur.noClaim = (cur.noClaim ?? 0) + (r.noClaim ?? 0);
    if (r.avgScore !== null && r.claiming > 0) cur._scoreSum += r.avgScore * r.claiming;
    if (!cur.stateCode && r.stateCode) cur.stateCode = r.stateCode;
  }

  return [...buckets.values()].map(({ _scoreSum, ...r }) => ({
    ...r,
    avgScore: r.claiming > 0 ? _scoreSum / r.claiming : null,
  }));
}

// Keep in sync with server `stateCanonical.ts` aliases.
const STATE_ALIASES: Record<string, string> = {
  jammuandkashmir: 'Jammu & Kashmir',
  tamilnadu: 'Tamil Nadu',
  orissa: 'Odisha',
  pondicherry: 'Puducherry',
  up: 'Uttar Pradesh',
  punjabregion: 'Punjab',
  mumbai: 'Maharashtra',
  navimumbai: 'Maharashtra',
  thane: 'Maharashtra',
  pune: 'Maharashtra',
  dhule: 'Maharashtra',
  sangli: 'Maharashtra',
  chennai: 'Tamil Nadu',
  erode: 'Tamil Nadu',
  hyderabad: 'Telangana',
  indore: 'Madhya Pradesh',
  ghaziabad: 'Uttar Pradesh',
  kushinagar: 'Uttar Pradesh',
  malappuram: 'Kerala',
  kollam: 'Kerala',
  ernakulam: 'Kerala',
  thiruvananthapuram: 'Kerala',
  idukki: 'Kerala',
  thrissur: 'Kerala',
  kottayam: 'Kerala',
  mohali: 'Punjab',
  ahmedabad: 'Gujarat',
  mehsana: 'Gujarat',
  gandhidham: 'Gujarat',
  kachchh: 'Gujarat',
  kutch: 'Gujarat',
  palghar: 'Maharashtra',
  miraroad: 'Maharashtra',
  newdelhi: 'Delhi',
  nctdelhi: 'Delhi',
  chattisgarh: 'Chhattisgarh',
  uttranchal: 'Uttarakhand',
  uttarpradesh: 'Uttar Pradesh',
  madhyapradesh: 'Madhya Pradesh',
  telengana: 'Telangana',
  westtripura: 'Tripura',
  gj: 'Gujarat',
  mp: 'Madhya Pradesh',
  dl: 'Delhi',
  ts: 'Telangana',
  ut: 'Uttar Pradesh',
  birbhum: 'West Bengal',
  paschimmedinipur: 'West Bengal',
  westmedinipur: 'West Bengal',
  south24parganas: 'West Bengal',
  kanchipuram: 'Tamil Nadu',
  tenkasi: 'Tamil Nadu',
  amravati: 'Maharashtra',
  buldhana: 'Maharashtra',
  barmer: 'Rajasthan',
  haridwar: 'Uttarakhand',
  almora: 'Uttarakhand',
  kamrup: 'Assam',
  dadraandnagarhavelianddamananddiu: 'Dadra & Nagar Haveli and Daman & Diu',
};
