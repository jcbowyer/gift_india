import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, MapPin, Search } from 'lucide-react';
import { Input } from '@databricks/appkit-ui/react';
import {
  api,
  type FacilityRanking,
  type FacilitySearchResult,
  type RegionState,
} from '../lib/api';
import { normName, placeMatch } from '../lib/mapPalette';

interface MapFacilitySearchProps {
  capability: string;
  onSelect: (f: FacilityRanking) => void;
  onSelectState?: (state: string) => void;
  onSelectDistrict?: (state: string, district: string) => void;
}

type StateHit = { kind: 'state'; state: string };
type DistrictHit = { kind: 'district'; state: string; district: string };
type LocationHit = StateHit | DistrictHit;

let regionsCache: RegionState[] | null = null;
let regionsPromise: Promise<RegionState[]> | null = null;

function loadRegions(): Promise<RegionState[]> {
  if (regionsCache) return Promise.resolve(regionsCache);
  if (!regionsPromise) {
    regionsPromise = api
      .regions()
      .then((rows) => {
        regionsCache = rows;
        return rows;
      })
      .catch(() => []);
  }
  return regionsPromise;
}

function matchesQuery(...parts: string[]): (query: string) => boolean {
  return (query: string) => {
    const q = normName(query);
    if (!q) return false;
    const hay = normName(parts.join(' '));
    return hay.includes(q);
  };
}

function searchLocations(regions: RegionState[], query: string): LocationHit[] {
  const q = query.trim();
  if (!q) return [];

  const states: StateHit[] = [];
  const districts: DistrictHit[] = [];

  for (const row of regions) {
    if (matchesQuery(row.state)(q)) {
      states.push({ kind: 'state', state: row.state });
    }
    for (const d of row.districts) {
      if (matchesQuery(d.district, row.state)(q) || placeMatch(d.district, q)) {
        districts.push({ kind: 'district', state: row.state, district: d.district });
      }
    }
  }

  states.sort((a, b) => a.state.localeCompare(b.state));
  districts.sort((a, b) => a.district.localeCompare(b.district) || a.state.localeCompare(b.state));

  return [...states.slice(0, 6), ...districts.slice(0, 8)];
}

async function resolveRanking(
  capability: string,
  pick: FacilitySearchResult,
): Promise<FacilityRanking | null> {
  try {
    const detail = await api.facility(pick.facilityId);
    const cap = detail.capabilities.find((c) => c.key === capability);
    return {
      rank: 0,
      facilityId: detail.facility.facilityId,
      name: detail.facility.name,
      type: detail.facility.type,
      district: detail.facility.district,
      state: detail.facility.state,
      stateCode: detail.facility.stateCode,
      beds: detail.facility.beds,
      lat: detail.facility.lat,
      lon: detail.facility.lon,
      websiteUrl: detail.facility.websiteUrl,
      matchConfidence: detail.facility.matchConfidence,
      claimed: cap?.claimed ?? false,
      trustSignal: cap?.trustSignal ?? 'no_claim',
      trustScore: cap?.trustScore ?? 0,
      evidenceTier: cap?.evidenceTier ?? null,
      evidenceCount: cap?.evidenceCount ?? 0,
      supportingCount: cap?.supportingCount ?? 0,
      contradictingCount: cap?.contradictingCount ?? 0,
      bestSource: cap?.bestSource ?? '',
      summary: cap?.summary ?? 'No assessment for the selected capability.',
      overrideSignal: cap?.overrideSignal ?? null,
      overrideScore: cap?.overrideScore ?? null,
      overrideNote: cap?.overrideNote ?? null,
    };
  } catch {
    return null;
  }
}

export function MapFacilitySearch({
  capability,
  onSelect,
  onSelectState,
  onSelectDistrict,
}: MapFacilitySearchProps) {
  const [query, setQuery] = useState('');
  const [facilityResults, setFacilityResults] = useState<FacilitySearchResult[]>([]);
  const [regions, setRegions] = useState<RegionState[]>(regionsCache ?? []);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const locationResults = useMemo(
    () => searchLocations(regions, query),
    [regions, query],
  );

  const runFacilitySearch = useMemo(
    () => async (q: string) => {
      try {
        const res = await api.facilitySearch(q.trim() || undefined);
        setFacilityResults(res);
      } catch {
        setFacilityResults([]);
      }
    },
    [],
  );

  useEffect(() => {
    void loadRegions().then(setRegions);
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void runFacilitySearch(query), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, open, runFacilitySearch]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const hasResults = locationResults.length > 0 || facilityResults.length > 0;
  const showDropdown = open && (hasResults || query.trim().length > 0);

  const pickFacility = async (r: FacilitySearchResult) => {
    setQuery('');
    setOpen(false);
    const ranking = await resolveRanking(capability, r);
    if (ranking) onSelect(ranking);
  };

  const pickLocation = (hit: LocationHit) => {
    setQuery('');
    setOpen(false);
    if (hit.kind === 'state') onSelectState?.(hit.state);
    else onSelectDistrict?.(hit.state, hit.district);
  };

  return (
    <div ref={rootRef} className="relative w-full min-w-0">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        placeholder="Search locations or facilities…"
        className="h-8 pl-8 text-sm"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        aria-label="Search states, districts, or facilities"
        aria-expanded={showDropdown && hasResults}
        aria-controls="map-facility-search-results"
        role="combobox"
      />
      {showDropdown && (
        <div
          id="map-facility-search-results"
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border bg-popover shadow-md"
        >
          {locationResults.length > 0 && (
            <div className="border-b py-1">
              <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Locations
              </p>
              {locationResults.map((hit) => (
                <button
                  key={hit.kind === 'state' ? `s-${hit.state}` : `d-${hit.state}-${hit.district}`}
                  type="button"
                  role="option"
                  onClick={() => pickLocation(hit)}
                  className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-muted/60"
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="block truncate font-medium text-foreground">
                      {hit.kind === 'state' ? hit.state : hit.district}
                    </span>
                    {hit.kind === 'district' && (
                      <span className="block truncate text-xs text-muted-foreground">{hit.state}</span>
                    )}
                    {hit.kind === 'state' && (
                      <span className="block truncate text-xs text-muted-foreground">State</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
          {facilityResults.length > 0 && (
            <div className="py-1">
              {locationResults.length > 0 && (
                <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Facilities
                </p>
              )}
              {facilityResults.map((r) => (
                <button
                  key={r.facilityId}
                  type="button"
                  role="option"
                  onClick={() => void pickFacility(r)}
                  className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-muted/60"
                >
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{r.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.district}, {r.state} · {r.type}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {!hasResults && query.trim() && (
            <p className="px-2.5 py-3 text-sm text-muted-foreground">No locations or facilities found</p>
          )}
        </div>
      )}
    </div>
  );
}
