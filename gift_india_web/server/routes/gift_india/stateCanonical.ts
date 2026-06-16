import { normState } from './regions';

/** ISO-style codes → canonical Survey-of-India state / UT names (from state_codes seed). */
export const INDIA_STATE_CODES: [string, string][] = [
  ['AP', 'Andhra Pradesh'],
  ['AR', 'Arunachal Pradesh'],
  ['AS', 'Assam'],
  ['BR', 'Bihar'],
  ['CG', 'Chhattisgarh'],
  ['GA', 'Goa'],
  ['GJ', 'Gujarat'],
  ['HR', 'Haryana'],
  ['HP', 'Himachal Pradesh'],
  ['JH', 'Jharkhand'],
  ['KA', 'Karnataka'],
  ['KL', 'Kerala'],
  ['MP', 'Madhya Pradesh'],
  ['MH', 'Maharashtra'],
  ['MN', 'Manipur'],
  ['ML', 'Meghalaya'],
  ['MZ', 'Mizoram'],
  ['NL', 'Nagaland'],
  ['OD', 'Odisha'],
  ['PB', 'Punjab'],
  ['RJ', 'Rajasthan'],
  ['SK', 'Sikkim'],
  ['TN', 'Tamil Nadu'],
  ['TG', 'Telangana'],
  ['TR', 'Tripura'],
  ['UP', 'Uttar Pradesh'],
  ['UK', 'Uttarakhand'],
  ['WB', 'West Bengal'],
  ['AN', 'Andaman & Nicobar Islands'],
  ['CH', 'Chandigarh'],
  ['DN', 'Dadra & Nagar Haveli and Daman & Diu'],
  ['DL', 'Delhi'],
  ['JK', 'Jammu & Kashmir'],
  ['LA', 'Ladakh'],
  ['LD', 'Lakshadweep'],
  ['PY', 'Puducherry'],
];

/** Normalised spellings / city labels in scraped data → canonical state. */
const STATE_ALIASES: Record<string, string> = {
  jammuandkashmir: 'Jammu & Kashmir',
  tamilnadu: 'Tamil Nadu',
  orissa: 'Odisha',
  pondicherry: 'Puducherry',
  up: 'Uttar Pradesh',
  punjabregion: 'Punjab',
  // Cities and districts that appear as "state" in address fields
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
  satara: 'Maharashtra',
  buldhana: 'Maharashtra',
  barmer: 'Rajasthan',
  haridwar: 'Uttarakhand',
  almora: 'Uttarakhand',
  kamrup: 'Assam',
  dadraandnagarhavelianddamananddiu: 'Dadra & Nagar Haveli and Daman & Diu',
};

function sqlQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** SQL CTEs that resolve a facility row to a map-facing canonical state name. */
export function mapStateCtes(facilityAlias = 'f', geoAlias = 'g'): string {
  const codeRows = INDIA_STATE_CODES.map(([c, s]) => `(${sqlQuote(c)}, ${sqlQuote(s)})`).join(',\n    ');
  const aliasRows = Object.entries(STATE_ALIASES)
    .map(([raw, state]) => `(${sqlQuote(raw)}, ${sqlQuote(state)})`)
    .join(',\n    ');
  return `
  state_codes(state_code, state) AS (
    VALUES
    ${codeRows}
  ),
  state_aliases(raw_norm, state) AS (
    VALUES
    ${aliasRows}
  ),
  facility_map_state AS (
    SELECT ${facilityAlias}.*,
           COALESCE(sc_geo.state, sc.state, sa.state, ${facilityAlias}.state) AS map_state,
           COALESCE(sc_geo.state_code, sc.state_code, ${facilityAlias}.state_code) AS map_state_code
    FROM gold.facilities ${facilityAlias}
    LEFT JOIN gold.geography ${geoAlias}
      ON lower(trim(${geoAlias}.district)) = lower(trim(${facilityAlias}.district))
     AND lower(trim(${geoAlias}.state)) = lower(trim(${facilityAlias}.state))
    LEFT JOIN state_codes sc_geo
      ON ${geoAlias}.district IS NOT NULL
     AND sc_geo.state = ${geoAlias}.state
    LEFT JOIN state_codes sc
      ON sc.state_code = ${facilityAlias}.state_code
    LEFT JOIN state_aliases sa
      ON sa.raw_norm = regexp_replace(replace(lower(${facilityAlias}.state), '&', 'and'), '[^a-z0-9]', '', 'g')
  )`;
}

/** Resolve a raw state label to its canonical map state (for tests / client parity). */
export function canonicalState(raw: string, stateCode?: string | null): string {
  if (stateCode) {
    const hit = INDIA_STATE_CODES.find(([c]) => c === stateCode);
    if (hit) return hit[1];
  }
  const alias = STATE_ALIASES[normState(raw)];
  if (alias) return alias;
  const exact = INDIA_STATE_CODES.find(([, s]) => normState(s) === normState(raw));
  return exact ? exact[1] : raw;
}
