import { useEffect, useState, type RefObject } from 'react';
import type { ViewportInset } from '../components/DrilldownMap';

const PAD = 8;

/** Measure map overlays and derive fit/zoom padding (symmetric on narrow screens). */
export function useMapViewportInset(
  mapRef: RefObject<HTMLElement | null>,
  railRef: RefObject<HTMLElement | null>,
  legendRef: RefObject<HTMLElement | null>,
  /** Re-measure when legend content changes (e.g. drill level, capability tab). */
  revision: string | number = 0,
): ViewportInset {
  const [inset, setInset] = useState<ViewportInset>({ top: PAD, right: PAD, bottom: 72, left: PAD });

  useEffect(() => {
    const mapEl = mapRef.current;
    if (!mapEl) return;

    const measure = () => {
      const map = mapEl.getBoundingClientRect();
      const w = map.width;
      const h = map.height;
      if (w < 2 || h < 2) return;

      const narrow = w < 640;
      const rail = railRef.current?.getBoundingClientRect();
      const legend = legendRef.current?.getBoundingClientRect();

      let top = PAD;
      let right = PAD;
      let bottom = PAD;
      let left = PAD;

      if (legend) {
        const legendOverlap = map.bottom - legend.top;
        if (legendOverlap > 0) bottom = Math.max(bottom, legendOverlap + PAD);
      }

      // Left inset: narrow tool rail only (legend sits above bottom-left and is handled via bottom).
      if (rail) {
        const railOverlap = rail.right - map.left;
        if (railOverlap > 0) left = Math.max(left, railOverlap + PAD);
      }

      bottom = Math.min(bottom, h * (narrow ? 0.2 : 0.3));
      left = Math.min(left, w * (narrow ? 0.08 : 0.16));
      right = narrow ? left : right;

      setInset({ top, right, bottom, left });
    };

    const ro = new ResizeObserver(measure);
    ro.observe(mapEl);
    const railEl = railRef.current;
    const legendEl = legendRef.current;
    if (railEl) ro.observe(railEl);
    if (legendEl) ro.observe(legendEl);
    measure();

    window.addEventListener('orientationchange', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', measure);
    };
  }, [mapRef, railRef, legendRef, revision]);

  return inset;
}
