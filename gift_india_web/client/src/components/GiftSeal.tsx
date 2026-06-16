import { useId } from 'react';

/**
 * The "GIFT Gauge" brand mark — a gold gift box above a speedometer gauge,
 * cradled in an open navy ring. The gift = the governed facility data; the
 * gauge = the trust score we read off it ("Great care, brought to light").
 * Deliberately in-house (NOT the JCI Gold Seal, a JCI trademark): trust signals
 * here are computed in gold.* from facility records, not awarded by anyone.
 */

// Brand palette (matches the logo artwork).
const NAVY = '#1f3a5e';
const BROWN = '#492f1a';

/** Sample a circular arc into an SVG polyline so stroke direction is exact. */
function arcPath(r: number, startDeg: number, endDeg: number, cx = 50, cy = 50, segs = 64): string {
  let d = '';
  for (let i = 0; i <= segs; i++) {
    const a = ((startDeg + (endDeg - startDeg) * (i / segs)) * Math.PI) / 180;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    d += (i === 0 ? 'M' : 'L') + `${x.toFixed(2)},${y.toFixed(2)}`;
  }
  return d;
}

// Open navy ring: drawn over the top (125° → 415°), leaving a gap at the bottom
// for the gauge to sit in. Centre is lifted slightly so the box reads centred.
const RING = arcPath(42, 125, 415, 50, 47);

// Gauge geometry — an upper semicircle dial with its hub near the ring's gap.
const GX = 50;
const GY = 80;
const GR = 21;
const gPt = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: GX + r * Math.cos(a), y: GY + r * Math.sin(a) };
};
// Needle points up-and-right (≈ -52°).
const NEEDLE = gPt(308, GR - 5);
// Tick dots evenly spaced across the top arc (180° = left … 360° = right).
const TICKS = Array.from({ length: 7 }, (_, i) => gPt(202 + (336 - 202) * (i / 6), GR - 5.5));

export function GiftSeal({
  size = 72,
  showText = true,
  className = '',
  title = 'GIFT Gauge',
}: {
  size?: number;
  /** Show the finer gauge detail (tick marks). Off = cleaner small-size mark. */
  showText?: boolean;
  className?: string;
  title?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const gold = `gold-${uid}`;
  const lid = `lid-${uid}`;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d9a945" />
          <stop offset="55%" stopColor="#c08f30" />
          <stop offset="100%" stopColor="#a9781f" />
        </linearGradient>
        <linearGradient id={lid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e0b252" />
          <stop offset="100%" stopColor="#bf8c2e" />
        </linearGradient>
      </defs>

      {/* open navy ring */}
      <path d={RING} fill="none" stroke={NAVY} strokeWidth="6.6" strokeLinecap="round" />

      {/* gift box: bow → lid → body (body bottom is overlapped by the gauge) */}
      <g>
        {/* bow: two open loops + knot */}
        <path
          d="M50,37 C 43,34 32,31 31,24.5 C 30.4,19.5 37,18.5 42,23 C 46.5,27 49.5,33 50,37 Z"
          fill="none"
          stroke={BROWN}
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <path
          d="M50,37 C 57,34 68,31 69,24.5 C 69.6,19.5 63,18.5 58,23 C 53.5,27 50.5,33 50,37 Z"
          fill="none"
          stroke={BROWN}
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <rect x="47" y="34.5" width="6" height="6" rx="2" fill={BROWN} />

        {/* lid */}
        <rect x="26.5" y="39.5" width="47" height="9.5" rx="1.6" fill={`url(#${lid})`} />
        {/* body */}
        <rect x="30.5" y="49" width="39" height="24" rx="1.4" fill={`url(#${gold})`} />
      </g>

      {/* speedometer gauge, bridging the ring's bottom gap */}
      <g>
        {/* dial face */}
        <path
          d={`M${GX - GR},${GY} A${GR},${GR} 0 0 1 ${GX + GR},${GY} Z`}
          fill="#fbfaf7"
        />
        {/* split rim: gold left half, navy right half */}
        <path
          d={`M${GX - GR},${GY} A${GR},${GR} 0 0 1 ${GX},${GY - GR}`}
          fill="none"
          stroke={`url(#${gold})`}
          strokeWidth="4.4"
          strokeLinecap="round"
        />
        <path
          d={`M${GX},${GY - GR} A${GR},${GR} 0 0 1 ${GX + GR},${GY}`}
          fill="none"
          stroke={NAVY}
          strokeWidth="4.4"
          strokeLinecap="round"
        />

        {/* tick marks (finer detail) */}
        {showText &&
          TICKS.map((t, i) => (
            <circle key={i} cx={t.x.toFixed(2)} cy={t.y.toFixed(2)} r="1.15" fill={NAVY} />
          ))}

        {/* needle */}
        <line
          x1={GX}
          y1={GY}
          x2={NEEDLE.x.toFixed(2)}
          y2={NEEDLE.y.toFixed(2)}
          stroke={NAVY}
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        {/* hub: navy ring, white centre */}
        <circle cx={GX} cy={GY} r="3.4" fill={NAVY} />
        <circle cx={GX} cy={GY} r="1.4" fill="#fbfaf7" />
      </g>
    </svg>
  );
}
