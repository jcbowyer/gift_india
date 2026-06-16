import { describe, it, expect } from 'vitest';
import {
  INDIA_STATES,
  INDIA_UNION_TERRITORIES,
  INDIA_ADMIN_REGIONS,
  ANALYZED_DISTRICTS,
  ANALYZED_DISTRICT_COUNT,
  ANALYZED_STATE_COUNT,
  clampStatesCovered,
  navigatorLinkFor,
} from './coverage';
import { placeMatch } from './mapPalette';

describe('India coverage facts', () => {
  it('reflects India: 28 states + 8 union territories = 36 regions', () => {
    expect(INDIA_STATES).toBe(28);
    expect(INDIA_UNION_TERRITORIES).toBe(8);
    expect(INDIA_ADMIN_REGIONS).toBe(36);
    expect(INDIA_STATES + INDIA_UNION_TERRITORIES).toBe(INDIA_ADMIN_REGIONS);
  });

  it('lists exactly the five deeply-analyzed districts', () => {
    expect(ANALYZED_DISTRICT_COUNT).toBe(5);
    expect(ANALYZED_DISTRICTS).toHaveLength(5);
    expect(ANALYZED_DISTRICTS.map((d) => d.district)).toEqual([
      'Mumbai City / Suburban',
      'New Delhi / Central Delhi',
      'Bengaluru Urban',
      'Lucknow',
      'Jaisalmer',
    ]);
  });

  it('gives every analyzed district a state and a non-empty blurb', () => {
    for (const d of ANALYZED_DISTRICTS) {
      expect(d.state.trim().length).toBeGreaterThan(0);
      expect(d.blurb.trim().length).toBeGreaterThan(0);
    }
  });

  it('spans five distinct states / union territories', () => {
    expect(ANALYZED_STATE_COUNT).toBe(5);
  });
});

describe('navigatorLinkFor', () => {
  it('builds a /navigator deep-link carrying the state + district', () => {
    const link = navigatorLinkFor({ state: 'Maharashtra', district: 'Mumbai City / Suburban' });
    const url = new URL(link, 'http://x');
    expect(url.pathname).toBe('/navigator');
    expect(url.searchParams.get('state')).toBe('Maharashtra');
    expect(url.searchParams.get('district')).toBe('Mumbai City / Suburban');
  });

  it('encodes labels with slashes/spaces so they round-trip', () => {
    const link = navigatorLinkFor({ state: 'Delhi NCT', district: 'New Delhi / Central Delhi' });
    expect(link).not.toContain(' '); // spaces are percent-encoded
    const url = new URL(link, 'http://x');
    expect(url.searchParams.get('district')).toBe('New Delhi / Central Delhi');
  });

  it('every analyzed district resolves to a real data name via placeMatch', () => {
    // The map resolves the descriptive label against the data's canonical names;
    // these are the actual state/district strings present in gold.facilities.
    const dataStates = ['Maharashtra', 'Delhi', 'Karnataka', 'Uttar Pradesh', 'Rajasthan'];
    const dataDistricts = ['Mumbai', 'New Delhi', 'Bengaluru', 'Lucknow', 'Jaisalmer'];
    for (const d of ANALYZED_DISTRICTS) {
      expect(dataStates.some((s) => placeMatch(s, d.state))).toBe(true);
      expect(dataDistricts.some((dd) => placeMatch(dd, d.district))).toBe(true);
    }
  });
});

describe('clampStatesCovered', () => {
  it('never claims more regions than India has', () => {
    // gold.facilities currently reports 233 distinct "states" (dirty data).
    expect(clampStatesCovered(233)).toBe(INDIA_ADMIN_REGIONS);
    expect(clampStatesCovered(36)).toBe(36);
  });

  it('passes through honest, in-range counts', () => {
    expect(clampStatesCovered(5)).toBe(5);
    expect(clampStatesCovered(0)).toBe(0);
  });

  it('truncates fractional counts', () => {
    expect(clampStatesCovered(5.9)).toBe(5);
  });

  it('guards against negative / non-finite input', () => {
    expect(clampStatesCovered(-1)).toBe(0);
    expect(clampStatesCovered(Number.NaN)).toBe(0);
    expect(clampStatesCovered(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
