// India zonal grouping (state → region) used by the scorecard's "Compare vs Region"
// benchmark. Follows the Ministry of Home Affairs zonal councils, with the
// North-East and South broken out as their own regions (the grouping users
// expect on a health map). Keys are normalised state names (see normState).

export type Region = 'North' | 'Central' | 'East' | 'West' | 'South' | 'North-East';

export const REGION_VALUES: Region[] = ['North', 'Central', 'East', 'West', 'South', 'North-East'];

const STATE_TO_REGION: Record<string, Region> = {};
const REGION_TO_STATES: Record<Region, string[]> = {
  North: [],
  Central: [],
  East: [],
  West: [],
  South: [],
  'North-East': [],
};

function assign(region: Region, states: string[]) {
  for (const s of states) {
    STATE_TO_REGION[normState(s)] = region;
    REGION_TO_STATES[region].push(s);
  }
}

/** Normalise a state name for region lookup ("&"→"and", strip non-alphanumerics). */
export function normState(s: string): string {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

assign('North', [
  'Jammu & Kashmir', 'Ladakh', 'Himachal Pradesh', 'Punjab', 'Haryana',
  'Delhi', 'Rajasthan', 'Chandigarh', 'Uttarakhand',
]);
assign('Central', ['Uttar Pradesh', 'Madhya Pradesh', 'Chhattisgarh']);
assign('East', ['Bihar', 'Jharkhand', 'Odisha', 'West Bengal']);
assign('West', [
  'Maharashtra', 'Gujarat', 'Goa',
  'Dadra & Nagar Haveli and Daman & Diu', 'Daman & Diu',
]);
assign('South', [
  'Karnataka', 'Telangana', 'Andhra Pradesh', 'Tamil Nadu', 'Kerala',
  'Puducherry', 'Lakshadweep', 'Andaman & Nicobar Islands',
]);
assign('North-East', [
  'Assam', 'Arunachal Pradesh', 'Nagaland', 'Manipur', 'Meghalaya',
  'Mizoram', 'Tripura', 'Sikkim',
]);

/** Region for a state name, or null if unmapped. */
export function regionOf(state: string): Region | null {
  return STATE_TO_REGION[normState(state)] ?? null;
}

/** Canonical state names that belong to a region (for SQL filters). */
export function statesInRegion(region: Region): string[] {
  return REGION_TO_STATES[region] ?? [];
}
