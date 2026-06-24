import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Input } from '@databricks/appkit-ui/react';
import { normName } from '../lib/mapPalette';

export interface GeoFilterOption {
  value: string;
  label: string;
  hint?: string;
}

interface GeoFilterListProps {
  value: string | null;
  onChange: (value: string | null) => void;
  options: GeoFilterOption[];
  allLabel: string;
  searchPlaceholder: string;
  disabled?: boolean;
}

function matchesQuery(text: string, query: string): boolean {
  const q = normName(query);
  if (!q) return true;
  return normName(text).includes(q);
}

export function GeoFilterList({
  value,
  onChange,
  options,
  allLabel,
  searchPlaceholder,
  disabled,
}: GeoFilterListProps) {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const sorted = options.slice().sort((a, b) => a.label.localeCompare(b.label));
    if (!filter.trim()) return sorted;
    return sorted.filter(
      (o) => matchesQuery(o.label, filter) || (o.hint ? matchesQuery(o.hint, filter) : false),
    );
  }, [options, filter]);

  if (disabled) {
    return (
      <p className="rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
        Select a state first
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={searchPlaceholder}
        className="h-8 text-sm"
        aria-label={searchPlaceholder}
      />
      <div
        className="max-h-44 overflow-auto rounded-md border"
        role="listbox"
        aria-label={searchPlaceholder}
      >
        <button
          type="button"
          role="option"
          aria-selected={value === null}
          onClick={() => onChange(null)}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-muted/60"
        >
          <Check className={`h-3.5 w-3.5 shrink-0 ${value === null ? 'opacity-100' : 'opacity-0'}`} />
          <span>{allLabel}</span>
        </button>
        {filtered.map((o) => {
          const selected = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onChange(o.value)}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-muted/60"
            >
              <Check className={`h-3.5 w-3.5 shrink-0 ${selected ? 'opacity-100' : 'opacity-0'}`} />
              <span className="min-w-0 flex-1 truncate">
                <span className="block truncate">{o.label}</span>
                {o.hint && (
                  <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>
                )}
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="px-2.5 py-2 text-xs text-muted-foreground">No matches</p>
        )}
      </div>
    </div>
  );
}
