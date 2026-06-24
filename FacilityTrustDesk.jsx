import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import * as d3 from "d3";

// ▼▼▼ PASTE YOUR DATA BUNDLE HERE ▼▼▼
// From your original file, copy everything between `const BUNDLE = ` and the
// trailing `;` (the big {"data":{...},"states":{...},"districts":{...}} object)
// and replace the {} below. The data is unchanged — only the UI was edited.
const BUNDLE = {};
// ▲▲▲ END DATA BUNDLE ▲▲▲
const { data: DATA, states: STATES_FC, districts: DISTRICTS_FC } = BUNDLE;
const FACILITIES = DATA.facilities;
const CAPS = DATA.capabilities;
const SOURCES = DATA.sources;

const W = 720, H = 700; // fixed map canvas (viewBox), like ON's 975Ã610
const ISLAND_UT = new Set(["Andaman and Nicobar Islands", "Lakshadweep"]);
const MAINLAND_FC = { type: "FeatureCollection", features: STATES_FC.features.filter((f) => !ISLAND_UT.has(f.properties.st_nm)) };
function hashStr(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return h>>>0; }
function regionDelta(name, cap){ const h=hashStr(name+"|"+cap); return +(((h%2400)/100)-12).toFixed(1); } // index pts vs last quarter, [-12,12]
function trendInfo(delta){ const up=delta>0.5, down=delta<-0.5; const m=Math.abs(delta); return { arrow: up?"▲":down?"▼":"→", color: up?"#0E7C6B":down?"#B23A2E":"#9AA0A8", mag: m>=6?"Strong":m>=2?"Moderate":"Slight", up, down }; }

/* ------------------------------------------------------------------ */
/* meta                                                                */
/* ------------------------------------------------------------------ */
const SIGNAL = {
  strong:   { label: "Strong evidence",   short: "Strong",   color: "#0E7C6B", glyph: "✔" },
  partial:  { label: "Partial evidence",  short: "Partial",  color: "#C77C13", glyph: "◑" },
  weak:     { label: "Weak / suspicious", short: "Weak",     color: "#B23A2E", glyph: "!" },
  no_claim: { label: "No claim",          short: "No claim", color: "#9AA0A8", glyph: "—" },
};
const SIGNAL_ORDER = ["strong", "partial", "weak", "no_claim"];
const RANK = { strong: 0, partial: 1, weak: 2, no_claim: 3 };
const STATUS = {
  corroborated: { label: "Corroborated",       color: "#0E7C6B", glyph: "✔" },
  declared:     { label: "Self-declared only", color: "#C77C13", glyph: "○" },
  contradicted: { label: "Contradicted",       color: "#B23A2E", glyph: "✕" },
  missing:      { label: "Missing",            color: "#9AA0A8", glyph: "–" },
};

/* ------------------------------------------------------------------ */
/* intelligent gradients (from Open Navigator censusMapTransforms)      */
/* ------------------------------------------------------------------ */
function _lerp(a, b, u) { return Math.round(a + (b - a) * u); }
function rampFromStops(stops, t) {
  if (t == null || !Number.isFinite(t)) return "#DCE0E4";
  const x = Math.min(1, Math.max(0, t));
  let i = 0; while (i < stops.length - 2 && x > stops[i + 1].t) i += 1;
  const lo = stops[i], hi = stops[i + 1]; const u = (x - lo.t) / ((hi.t - lo.t) || 1e-9);
  return `rgb(${_lerp(lo.rgb[0], hi.rgb[0], u)},${_lerp(lo.rgb[1], hi.rgb[1], u)},${_lerp(lo.rgb[2], hi.rgb[2], u)})`;
}
const TRUST_STOPS = [{ t: 0, rgb: [178, 58, 46] }, { t: 0.42, rgb: [199, 124, 19] }, { t: 0.72, rgb: [63, 156, 140] }, { t: 1, rgb: [14, 124, 107] }];
const BLUE_STOPS = [{ t: 0, rgb: [180, 196, 222] }, { t: 0.3, rgb: [125, 211, 252] }, { t: 0.58, rgb: [56, 189, 248] }, { t: 0.82, rgb: [37, 99, 235] }, { t: 1, rgb: [23, 37, 84] }];
const RED_STOPS = [{ t: 0, rgb: [233, 213, 207] }, { t: 0.4, rgb: [224, 122, 95] }, { t: 0.72, rgb: [178, 58, 46] }, { t: 1, rgb: [122, 28, 22] }];
function quantileExtent(values, qLow = 0.04, qHigh = 0.96) {
  const nums = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  const n = nums.length; if (n < 2) return { min: 0, max: 1 };
  const lo = nums[Math.max(0, Math.floor(qLow * (n - 1)))], hi = nums[Math.min(n - 1, Math.ceil(qHigh * (n - 1)))];
  if (!(lo < hi)) { const mid = nums[Math.floor(n / 2)]; return { min: mid * 0.9 || 0, max: mid * 1.1 || 1 }; }
  return { min: lo, max: hi };
}
function metricToDisplayT(v, min, max, scale) {
  if (v == null || !Number.isFinite(v) || max <= min) return null;
  const c = Math.max(min, Math.min(max, v)); const u = (c - min) / (max - min);
  if (scale === "sqrt") return Math.sqrt(Math.max(0, u));
  if (scale === "log") { const lo = Math.log10(Math.max(min, 1)), hi = Math.log10(Math.max(max, 1)); return (Math.log10(Math.max(c, 1)) - lo) / ((hi - lo) || 1e-9); }
  return u;
}
function bubbleRadiusPx(v, min, max, scale, rMin = 5, rMax = 26) {
  const t = metricToDisplayT(v, min, max, scale); return t == null ? rMin : rMin + t * (rMax - rMin);
}
const METRICS = {
  evidence:   { label: "Evidence index", stops: TRUST_STOPS, lo: "weak", hi: "strong", fmt: (v) => Math.round(v) + "%", pick: (a) => (a.claimed ? a.index * 100 : null) },
  count:      { label: "Facilities", stops: BLUE_STOPS, lo: "few", hi: "many", fmt: (v) => Math.round(v), pick: (a) => (a.count || null) },
  suspicious: { label: "Suspicious %", stops: RED_STOPS, lo: "low", hi: "high", fmt: (v) => Math.round(v) + "%", pick: (a) => (a.claimed ? a.weakShare * 100 : null) },
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
function effSignal(f, cap, overrides) { const o = overrides[f.id + "|" + cap]; return o ? o.signal : f.caps[cap].signal; }
function aggregate(list, cap, overrides) {
  let count = list.length, claimed = 0, weak = 0, strong = 0, partial = 0, noclaim = 0, idx = 0;
  list.forEach((f) => {
    const s = effSignal(f, cap, overrides);
    if (s === "strong") strong++; else if (s === "partial") partial++; else if (s === "weak") weak++; else noclaim++;
    if (s !== "no_claim") { claimed++; idx += s === "strong" ? 1 : s === "partial" ? 0.55 : 0; }
  });
  return { count, claimed, strong, partial, weak, no_claim: noclaim, index: claimed ? idx / claimed : 0, weakShare: claimed ? weak / claimed : 0 };
}
function indexPosture(idx, claimed) {
  if (!claimed) return { word: "No claims", color: "#9AA0A8" };
  if (idx >= 0.78) return { word: "Strong posture", color: SIGNAL.strong.color };
  if (idx >= 0.48) return { word: "Mixed posture", color: SIGNAL.partial.color };
  return { word: "Weak posture", color: SIGNAL.weak.color };
}

function StyleTag() {
  return (<style>{`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
    .ftd{ --paper:#E9EBED; --surface:#FBFBFC; --raise:#FFFFFF; --ink:#191E29; --muted:#62707F; --faint:#9AA6B2; --line:#D7DCE1; --accent:#26345C; }
    .ftd, .ftd *{ box-sizing:border-box; }
    .ftd{ font-family:'IBM Plex Sans',system-ui,sans-serif; color:var(--ink); background:var(--paper); -webkit-font-smoothing:antialiased; }
    .serif{ font-family:'Fraunces','Georgia',serif; } .mono{ font-family:'IBM Plex Mono',ui-monospace,monospace; }
    .ftd ::-webkit-scrollbar{ width:9px;height:9px; } .ftd ::-webkit-scrollbar-thumb{ background:#C2CAD2;border-radius:6px; }
    .seal{ font-family:'Fraunces',serif; letter-spacing:.06em; text-transform:uppercase; border:2.5px solid currentColor; border-radius:3px; box-shadow:inset 0 0 0 2px var(--surface); padding:6px 12px 5px; display:inline-flex; gap:8px; align-items:center; position:relative; }
    .seal::after{ content:""; position:absolute; inset:3px; border:1px solid currentColor; opacity:.45; border-radius:2px; }
    .tap{ cursor:pointer; transition:background .12s,border-color .12s,transform .12s; }
    .tap:focus-visible,.focusable:focus-visible{ outline:2px solid var(--accent); outline-offset:2px; }
    .row:hover{ background:#F4F6F8; } .capbtn:hover{ background:#F1F3F5; }
    .geo{ transition:fill 1s cubic-bezier(.65,0,.35,1), fill-opacity .5s; vector-effect:non-scaling-stroke; }
    .bub,.pin{ vector-effect:non-scaling-stroke; } .bub{ transition:fill .8s; }
    .fadein{ animation:fi .35s ease both; } @keyframes fi{ from{opacity:0} to{opacity:1} }
    .barfill{ transition:width .4s cubic-bezier(.2,.7,.2,1); }
    .mapwrap{ cursor:grab; } .mapwrap:active{ cursor:grabbing; }
    @media (prefers-reduced-motion:reduce){ .fadein{animation:none} .barfill{transition:none} .geo{transition:none} }
  `}</style>);
}

function Badge({ signal, small }) {
  const s = SIGNAL[signal];
  return (<span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: s.color, border: `1px solid ${s.color}`, background: s.color + "12", borderRadius: 999, padding: small ? "1px 8px" : "2px 10px", fontSize: small ? 11 : 12, fontWeight: 600, whiteSpace: "nowrap" }}>
    <span style={{ fontWeight: 800 }}>{s.glyph}</span>{s.short}</span>);
}
function MixBar({ a }) {
  const total = a.count || 1;
  return (<div style={{ display: "flex", height: 7, borderRadius: 4, overflow: "hidden", background: "#E3E7EB", width: "100%" }}>
    {SIGNAL_ORDER.map((k) => <div key={k} style={{ width: (a[k] / total) * 100 + "%", background: SIGNAL[k].color }} />)}
  </div>);
}

/* ------------------------------------------------------------------ */
/* D3-zoom drilldown map                                               */
/* ------------------------------------------------------------------ */
function MapPanel({ cap, overrides, region, district, setRegion, setDistrict,
                   facilitiesByState, facilitiesByDistrict, selectedId, setSelectedId,
                   hoverKey, setHoverKey }) {
  const svgRef = useRef(null), gRef = useRef(null), zoomRef = useRef(null);
  const [zoomK, setZoomK] = useState(1);
  const [layer, setLayer] = useState("shade");
  const [metric, setMetric] = useState("evidence");
  const [scale, setScale] = useState("linear");
  const [pins, setPins] = useState(true);
  const [flyout, setFlyout] = useState(null);
  const [spider, setSpider] = useState(null);

  const projection = useMemo(() => d3.geoMercator().fitExtent([[16, 16], [W - 16, H - 16]], MAINLAND_FC), []);
  const path = useMemo(() => d3.geoPath(projection), [projection]);

  // install d3-zoom (Bostock zoom-to-bbox, van Wijk interpolation)
  useEffect(() => {
    const svg = d3.select(svgRef.current), g = d3.select(gRef.current);
    const z = d3.zoom().scaleExtent([1, 320]).clickDistance(8)
      .on("zoom", (e) => { g.attr("transform", e.transform.toString()); const k = e.transform.k; setZoomK((p) => (Math.abs(p - k) > 1e-3 ? k : p)); });
    zoomRef.current = z; svg.call(z).on("dblclick.zoom", null);
    return () => svg.on(".zoom", null);
  }, []);

  // drive zoom from drill state
  useEffect(() => {
    const svg = d3.select(svgRef.current), z = zoomRef.current; if (!z) return;
    setSpider(null);
    let target = null;
    if (district && region) target = DISTRICTS_FC.features.find((f) => f.properties.st_nm === region && f.properties.district === district);
    else if (region) target = STATES_FC.features.find((f) => f.properties.st_nm === region);
    if (!target) { svg.transition().duration(750).call(z.transform, d3.zoomIdentity); return; }
    const [[x0, y0], [x1, y1]] = path.bounds(target);
    const pad = district ? 0.8 : 0.9;
    const k = Math.min(260, pad / Math.max((x1 - x0) / W, (y1 - y0) / H));
    const tx = W / 2 - k * ((x0 + x1) / 2), ty = H / 2 - k * ((y0 + y1) / 2);
    svg.transition().duration(district ? 850 : 900).call(z.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }, [region, district, path]);

  // facility screen points
  const facPts = useMemo(() => {
    const m = {}; FACILITIES.forEach((f) => { const p = projection([f.lon, f.lat]); if (p) m[f.id] = p; }); return m;
  }, [projection]);

  // styling for the active shading level
  const M = METRICS[metric];
  const style = useMemo(() => {
    // which features carry the metric: districts of region (drilled) or states (nation)
    const lvlFeatures = region ? DISTRICTS_FC.features.filter((f) => f.properties.st_nm === region) : STATES_FC.features;
    const facsOf = (f) => region ? (facilitiesByDistrict[f.properties.st_nm + "|" + f.properties.district] || []) : (facilitiesByState[f.properties.st_nm] || []);
    const aggs = lvlFeatures.map((f) => aggregate(facsOf(f), cap, overrides));
    const vals = aggs.map((a) => M.pick(a));
    const ext = quantileExtent(vals);
    const fillByKey = {};
    lvlFeatures.forEach((f, i) => {
      const key = (f.properties.st_nm || "") + "|" + (f.properties.district || "");
      const v = vals[i];
      fillByKey[key] = (layer === "shade") ? (v == null ? "#DCE0E4" : rampFromStops(M.stops, metricToDisplayT(v, ext.min, ext.max, scale))) : (region ? "#EEF1F4" : "#E7EBEF");
    });
    // bubbles
    let bubbles = [];
    if (layer === "bubbles") {
      const counts = aggs.map((a) => a.count).filter((n) => n > 0);
      const cext = quantileExtent(counts, 0, 1);
      lvlFeatures.forEach((f, i) => {
        const a = aggs[i]; if (!a.count) return; const c = projection(d3.geoCentroid(f)); if (!c) return;
        const v = vals[i];
        bubbles.push({ x: c[0], y: c[1], r: bubbleRadiusPx(a.count, cext.min, cext.max, "sqrt", 6, 30), color: v == null ? "#C2CAD2" : rampFromStops(M.stops, metricToDisplayT(v, ext.min, ext.max, scale)), count: a.count, feat: f, a });
      });
    }
    return { lvlFeatures, fillByKey, ext, bubbles };
  }, [region, cap, overrides, layer, metric, scale, facilitiesByState, facilitiesByDistrict, projection]);

  // pins for current scope
  const scopePins = useMemo(() => {
    let list = FACILITIES;
    if (district) list = facilitiesByDistrict[region + "|" + district] || [];
    else if (region) list = facilitiesByState[region] || [];
    return list;
  }, [region, district, facilitiesByState, facilitiesByDistrict]);

  // client-side clustering (splits as d3.zoom zooms in) â numbered cluster pins
  const CLUSTER_PX = 46;
  const clusters = useMemo(() => {
    const cell = CLUSTER_PX / zoomK; const buckets = new Map();
    scopePins.forEach((f) => {
      if (f.id === selectedId) return; if (spider && spider.ids.indexOf(f.id) !== -1) return; const pt = facPts[f.id]; if (!pt) return;
      const key = Math.floor(pt[0] / cell) + ":" + Math.floor(pt[1] / cell);
      let b = buckets.get(key); if (!b) { b = { xs: 0, ys: 0, items: [] }; buckets.set(key, b); }
      b.xs += pt[0]; b.ys += pt[1]; b.items.push(f);
    });
    const out = [];
    buckets.forEach((b) => {
      const n = b.items.length;
      if (n === 1) { const f = b.items[0]; out.push({ type: "pin", f, x: facPts[f.id][0], y: facPts[f.id][1] }); }
      else { const a = aggregate(b.items, cap, overrides); out.push({ type: "cluster", x: b.xs / n, y: b.ys / n, count: n, index: a.claimed ? a.index : null, weak: a.weak, ids: b.items.map((f) => f.id) }); }
    });
    return out;
  }, [scopePins, facPts, zoomK, selectedId, cap, overrides, spider]);

  function zoomToPoint(cx, cy, factor) {
    const svg = d3.select(svgRef.current), z = zoomRef.current; if (!z) return;
    const cur = d3.zoomTransform(svgRef.current); const k = Math.min(320, cur.k * factor);
    svg.transition().duration(550).call(z.transform, d3.zoomIdentity.translate(W / 2 - k * cx, H / 2 - k * cy).scale(k));
  }

  const pinR = Math.max(1.6, 4 / zoomK), bubScale = 1 / zoomK;

  function regionHover(name, level, facs) { setHoverKey({ name, level, a: aggregate(facs, cap, overrides) }); }

  return (
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>
      {/* breadcrumb + controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        <button className="tap focusable" onClick={() => { setRegion(null); setDistrict(null); }} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", color: region ? "var(--accent)" : "var(--ink)", fontWeight: 600, fontSize: 13 }}>India</button>
        {region && <><span style={{ color: "var(--faint)" }}>›</span>
          <button className="tap focusable" onClick={() => setDistrict(null)} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", color: district ? "var(--accent)" : "var(--ink)", fontWeight: 600, fontSize: 13 }}>{region}</button></>}
        {district && <><span style={{ color: "var(--faint)" }}>›</span><span className="serif" style={{ fontWeight: 600, fontSize: 14 }}>{district}</span></>}
        <div className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
          {({ shade: "Shade", bubbles: "Bubbles" })[layer]} · {METRICS[metric].label} · {({ linear: "Lin", sqrt: "√", log: "Log" })[scale]}{pins ? " · pins" : ""}
        </div>
      </div>

      <div className="mapwrap" style={{ position: "relative", flex: 1, minHeight: 380, background: "#EAEEF2" }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%", display: "block" }}
             onMouseLeave={() => setHoverKey(null)}>
          <g ref={gRef}>
            {/* base states (always) */}
            {STATES_FC.features.map((f, i) => {
              const nm = f.properties.st_nm;
              const isReg = region === nm;
              const fill = region ? (isReg ? "#F4F6F8" : "#E2E6EA") : style.fillByKey[nm + "|"] || "#DCE0E4";
              const has = (facilitiesByState[nm] || []).length;
              return <path key={"s" + i} className="geo" d={path(f)} fill={fill} fillOpacity={region && !isReg ? 0.6 : 0.85}
                stroke={isReg ? "var(--ink)" : "#ffffff"} strokeWidth={isReg ? 1.4 : 0.7}
                style={{ cursor: !region && has ? "pointer" : "default", pointerEvents: region ? "none" : "auto" }}
                onMouseMove={() => !region && regionHover(nm, "State", facilitiesByState[nm] || [])}
                onClick={() => { if (!region && has) { setRegion(nm); setDistrict(null); setSelectedId(null); } }} />;
            })}
            {/* districts of drilled state */}
            {region && style.lvlFeatures.map((f, i) => {
              const key = region + "|" + f.properties.district;
              const isSel = district === f.properties.district;
              return <path key={"d" + i} className="geo" d={path(f)} fill={style.fillByKey[key] || "#EEF1F4"} fillOpacity={layer === "shade" ? 0.85 : 0.5}
                stroke={isSel ? "var(--ink)" : "#AEB7C1"} strokeWidth={isSel ? 1.3 : 0.55}
                style={{ cursor: "pointer", pointerEvents: "auto" }}
                onMouseMove={() => regionHover(f.properties.district, "District", facilitiesByDistrict[key] || [])}
                onClick={() => { setDistrict((d) => d === f.properties.district ? null : f.properties.district); setSelectedId(null); }} />;
            })}
            {/* bubbles */}
            {style.bubbles.map((b, i) => (
              <g key={"b" + i} transform={`translate(${b.x},${b.y}) scale(${bubScale})`} style={{ cursor: !region ? "pointer" : "default" }}
                 onMouseMove={() => regionHover(b.feat.properties.district || b.feat.properties.st_nm, region ? "District" : "State", region ? (facilitiesByDistrict[b.feat.properties.st_nm + "|" + b.feat.properties.district] || []) : (facilitiesByState[b.feat.properties.st_nm] || []))}
                 onClick={() => { if (!region) { setRegion(b.feat.properties.st_nm); setDistrict(null); } else { setDistrict(b.feat.properties.district); } setSelectedId(null); }}>
                <circle className="bub" r={b.r} fill={b.color} fillOpacity={0.86} stroke="#fff" strokeWidth={1.5} />
                <text textAnchor="middle" dy="0.34em" fontSize={Math.min(b.r * 0.9, 13)} fontWeight="700" fill="#fff" style={{ pointerEvents: "none", fontFamily: "'IBM Plex Sans',sans-serif" }}>{b.count}</text>
              </g>
            ))}
            {/* region name labels */}
            {!region ? STATES_FC.features.map((f, i) => {
              if (!(facilitiesByState[f.properties.st_nm] || []).length) return null;
              const c = projection(d3.geoCentroid(f)); if (!c) return null;
              return <g key={"rl" + i} transform={`translate(${c[0]},${c[1]}) scale(${1 / zoomK})`} style={{ pointerEvents: "none" }}>
                <text textAnchor="middle" dy="0.32em" fontSize={10.5} fontWeight={600} style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3, strokeLinejoin: "round", fill: "#27313F", fontFamily: "'IBM Plex Sans',sans-serif" }}>{f.properties.st_nm}</text>
              </g>;
            }) : style.lvlFeatures.map((f, i) => {
              if (!(facilitiesByDistrict[region + "|" + f.properties.district] || []).length) return null;
              const c = projection(d3.geoCentroid(f)); if (!c) return null;
              return <g key={"rl" + i} transform={`translate(${c[0]},${c[1] - 16 / zoomK}) scale(${1 / zoomK})`} style={{ pointerEvents: "none" }}>
                <text textAnchor="middle" dy="0.32em" fontSize={10} fontWeight={700} style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3, strokeLinejoin: "round", fill: "#3A4655", fontFamily: "'IBM Plex Sans',sans-serif", textTransform: "uppercase", letterSpacing: ".03em" }}>{f.properties.district}</text>
              </g>;
            })}
            {/* facility pins â numbered clusters that split on zoom */}
            {pins && clusters.map((c, i) => c.type === "pin" ? (() => {
              const sig = effSignal(c.f, cap, overrides);
              return <g key={"pin" + c.f.id} transform={`translate(${c.x},${c.y}) scale(${1 / zoomK})`} style={{ cursor: "pointer" }} onClick={() => setSelectedId(c.f.id)}>
                <circle r={9} fill={SIGNAL[sig].color} opacity={0.16} />
                <circle r={6} fill={SIGNAL[sig].color} stroke="#fff" strokeWidth={2}><title>{c.f.name} — {SIGNAL[sig].label}</title></circle>
                {region && <text x={10} dy="0.32em" fontSize={11} fontWeight={600} style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3.2, strokeLinejoin: "round", fill: "#27313F", fontFamily: "'IBM Plex Sans',sans-serif", pointerEvents: "none" }}>{c.f.name.split(",")[0]}</text>}
              </g>;
            })() : (
              <g key={"cl" + i} transform={`translate(${c.x},${c.y}) scale(${1 / zoomK})`} style={{ cursor: "pointer" }} onClick={() => (c.count <= 6 ? setSpider({ cx: c.x, cy: c.y, ids: c.ids }) : zoomToPoint(c.x, c.y, 2.4))}>
                <circle r={(c.count < 8 ? 15 : c.count < 22 ? 19 : 23) + 3} fill="#0b1220" opacity={0.13} />
                <circle r={c.count < 8 ? 15 : c.count < 22 ? 19 : 23} fill={c.index == null ? "#9AA0A8" : rampFromStops(TRUST_STOPS, c.index)} stroke={c.weak > 0 ? "#B23A2E" : "#fff"} strokeWidth={c.weak > 0 ? 3.5 : 2.5} />
                <text textAnchor="middle" dy="0.34em" fontSize={13} fontWeight="700" fill="#fff" style={{ pointerEvents: "none", fontFamily: "'IBM Plex Sans',sans-serif" }}>{c.count}</text>
              </g>
            ))}
            {pins && selectedId && facPts[selectedId] && scopePins.some((f) => f.id === selectedId) && (() => {
              const f = FACILITIES.find((x) => x.id === selectedId); const sig = effSignal(f, cap, overrides); const pp = facPts[selectedId];
              return <g key="sel" transform={`translate(${pp[0]},${pp[1]}) scale(${1 / zoomK})`} style={{ cursor: "pointer" }} onClick={() => setSelectedId(null)}>
                <circle r={8} fill={SIGNAL[sig].color} stroke="#191E29" strokeWidth={2.5} /><circle r={3} fill="#fff" /></g>;
            })()}
            {pins && spider && (() => {
              const ids = spider.ids; const n = ids.length; const R = 24 + n * 3.2;
              return <g key="spider">
                {ids.map((id, i) => { const ang = (i / n) * 2 * Math.PI - Math.PI / 2; return <line key={"lg" + id} x1={spider.cx} y1={spider.cy} x2={spider.cx + (R * Math.cos(ang)) / zoomK} y2={spider.cy + (R * Math.sin(ang)) / zoomK} stroke="#8A95A1" strokeWidth={1} />; })}
                {ids.map((id, i) => {
                  const f = FACILITIES.find((x) => x.id === id); const sig = effSignal(f, cap, overrides);
                  const ang = (i / n) * 2 * Math.PI - Math.PI / 2;
                  return <g key={"sp" + id} transform={`translate(${spider.cx + (R * Math.cos(ang)) / zoomK},${spider.cy + (R * Math.sin(ang)) / zoomK}) scale(${1 / zoomK})`} style={{ cursor: "pointer" }} onClick={() => { setSelectedId(id); setSpider(null); }}>
                    <circle r={6.5} fill={SIGNAL[sig].color} stroke="#fff" strokeWidth={1.8}><title>{f.name} — {SIGNAL[sig].label}</title></circle>
                    <text x={9} dy="0.32em" fontSize={10.5} fontWeight={600} style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3, strokeLinejoin: "round", fill: "#27313F", fontFamily: "'IBM Plex Sans',sans-serif", pointerEvents: "none" }}>{f.name.split(",")[0]}</text>
                  </g>;
                })}
                <g transform={`translate(${spider.cx},${spider.cy}) scale(${1 / zoomK})`} style={{ cursor: "pointer" }} onClick={() => setSpider(null)}>
                  <circle r={9} fill="#191E29" /><text textAnchor="middle" dy="0.3em" fontSize={12} fontWeight="700" fill="#fff" style={{ pointerEvents: "none" }}>×</text>
                </g>
              </g>;
            })()}
          </g>
        </svg>

        {/* filters flyout rail (Open Navigator style) â compact, subtle, frosted */}
        {flyout && <div onClick={() => setFlyout(null)} style={{ position: "absolute", inset: 0, zIndex: 6 }} />}
        <div style={{ position: "absolute", left: 10, top: 10, zIndex: 8, display: "flex", flexDirection: "column", gap: 3, background: "rgba(251,251,252,.72)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", border: "1px solid var(--line)", borderRadius: 10, padding: 4, boxShadow: "0 2px 8px rgba(20,30,45,.07)" }}>
          {[["home", "⌂", "Home"], ["view", "▦", "Layer"], ["color", "◑", "Scale"], ["numbers", "№", "Metric"], ["pins", "●", "Pins"]].map(([id, ic, lbl]) => {
            const active = (id === "pins" && pins) || flyout === id;
            const canHome = id === "home" && (region || district);
            return (
              <button key={id} className="tap focusable" title={lbl} aria-label={lbl}
                onClick={() => { if (id === "home") { setRegion(null); setDistrict(null); setFlyout(null); } else if (id === "pins") { setPins((p) => !p); } else { setFlyout((f) => (f === id ? null : id)); } }}
                style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${active ? "var(--accent)" : "transparent"}`, background: active ? "var(--accent)" : "transparent", color: active ? "#fff" : (id === "home" && !canHome ? "var(--faint)" : "var(--muted)"), cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 14, lineHeight: 1 }}>{ic}</span>
              </button>
            );
          })}
        </div>
        {flyout && (
          <div className="fadein" style={{ position: "absolute", left: 50, top: 10, zIndex: 9, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 11, padding: "12px 13px", boxShadow: "0 10px 30px rgba(20,30,45,.16)", minWidth: 178 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>
              {flyout === "view" ? "Map layer" : flyout === "color" ? "Color scale" : "Metric"}
            </div>
            {flyout === "view" && <FlyoutOpts opts={[["shade", "Filled shading"], ["bubbles", "Proportional bubbles"]]} val={layer} set={setLayer} />}
            {flyout === "color" && <FlyoutOpts opts={[["linear", "Linear"], ["sqrt", "Square root"], ["log", "Logarithmic"]]} val={scale} set={setScale} />}
            {flyout === "numbers" && <FlyoutOpts opts={[["evidence", "Evidence index"], ["count", "Facility count"], ["suspicious", "Suspicious share"]]} val={metric} set={setMetric} />}
          </div>
        )}

        {/* zoom controls */}
        <div style={{ position: "absolute", right: 12, top: 12, display: "flex", flexDirection: "column", gap: 4, zIndex: 5 }}>
          {[["+", 1.6], ["−", 1 / 1.6]].map(([lbl, f]) => (
            <button key={lbl} className="tap focusable" onClick={() => d3.select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, f)}
              style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 17, fontWeight: 600, cursor: "pointer", color: "var(--ink)" }}>{lbl}</button>
          ))}
          {(region || district) && <button className="tap focusable mono" onClick={() => { setRegion(null); setDistrict(null); }}
            style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 13, cursor: "pointer", color: "var(--muted)" }}>↺</button>}
        </div>

        {/* gradient legend */}
        <div style={{ position: "absolute", left: 12, bottom: 12, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 11px", fontSize: 11.5, boxShadow: "0 4px 14px rgba(20,30,45,.10)", zIndex: 5, minWidth: 170 }}>
          <div style={{ color: "var(--muted)", marginBottom: 6, fontWeight: 600 }}>{M.label} · {region ? "district" : "state"}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10.5, color: "var(--faint)" }}>{M.lo}</span>
            <span style={{ flex: 1, height: 9, borderRadius: 5, background: `linear-gradient(90deg,${M.stops.map((s) => `rgb(${s.rgb[0]},${s.rgb[1]},${s.rgb[2]}) ${Math.round(s.t * 100)}%`).join(",")})` }} />
            <span style={{ fontSize: 10.5, color: "var(--faint)" }}>{M.hi}</span>
          </div>
          <div className="mono" style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 10, color: "var(--faint)" }}><span>{M.fmt(style.ext.min)}</span><span>{M.fmt(style.ext.max)}</span></div>
          {pins && <div style={{ marginTop: 7, paddingTop: 7, borderTop: "1px dashed var(--line)", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SIGNAL_ORDER.map((k) => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5 }}><span style={{ width: 8, height: 8, borderRadius: 8, background: SIGNAL[k].color }} />{SIGNAL[k].short}</span>)}
          </div>}
        </div>
      </div>
    </div>
  );
}
function Seg({ opts, val, set }) {
  return (<div style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 7, overflow: "hidden", background: "var(--surface)" }}>
    {opts.map(([k, lbl]) => <button key={k} className="tap focusable" onClick={() => set(k)} style={{ border: "none", padding: "3px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer", background: val === k ? "var(--accent)" : "transparent", color: val === k ? "#fff" : "var(--muted)" }}>{lbl}</button>)}
  </div>);
}
function FlyoutOpts({ opts, val, set }) {
  return (<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
    {opts.map(([k, lbl]) => { const on = val === k; return (
      <button key={k} className="tap focusable" onClick={() => set(k)} style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "var(--accent)" : "var(--surface)", color: on ? "#fff" : "var(--ink)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, fontWeight: on ? 600 : 500, cursor: "pointer", textAlign: "left" }}>
        <span style={{ width: 9, height: 9, borderRadius: 9, border: `2px solid ${on ? "#fff" : "var(--faint)"}`, background: on ? "#fff" : "transparent" }} />{lbl}</button>); })}
  </div>);
}

/* ------------------------------------------------------------------ */
/* evidence ledger                                                     */
/* ------------------------------------------------------------------ */
function Citation({ c }) {
  const src = SOURCES[c.source] || { label: c.source, weight: "independent" };
  const independent = src.weight !== "self";
  return (<div style={{ display: "flex", gap: 9, padding: "7px 0", borderTop: "1px dashed var(--line)" }}>
    <span style={{ marginTop: 2, fontSize: 10, fontWeight: 700, color: independent ? "#0E7C6B" : "#C77C13", border: `1px solid ${independent ? "#0E7C6B" : "#C77C13"}`, borderRadius: 4, padding: "1px 5px", height: "fit-content", whiteSpace: "nowrap" }}>{independent ? "independent" : "self"}</span>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{src.label}</div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>{c.text}</div>
      <div className="mono" style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 2 }}>seen {c.date}</div>
    </div></div>);
}
function LedgerRow({ item }) {
  const [open, setOpen] = useState(false); const st = STATUS[item.status]; const hasC = item.citations && item.citations.length;
  return (<div style={{ borderTop: "1px solid var(--line)" }}>
    <button className="tap focusable" onClick={() => hasC && setOpen((o) => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 2px", background: "none", border: "none", textAlign: "left", cursor: hasC ? "pointer" : "default" }}>
      <span style={{ width: 20, height: 20, borderRadius: 6, display: "grid", placeItems: "center", background: st.color + "1A", color: st.color, fontWeight: 800, fontSize: 12, flexShrink: 0 }}>{st.glyph}</span>
      <span style={{ flex: 1, fontSize: 13.5 }}>{item.label}{item.critical && <span style={{ marginLeft: 7, fontSize: 10, fontWeight: 700, color: "var(--muted)", border: "1px solid var(--line)", borderRadius: 4, padding: "0 5px" }}>required</span>}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: st.color, whiteSpace: "nowrap" }}>{st.label}</span>
      {hasC ? <span style={{ color: "var(--faint)", fontSize: 11, width: 14 }}>{open ? "▾" : "›"}</span> : <span style={{ width: 14 }} />}
    </button>
    {open && hasC && <div style={{ paddingLeft: 30, paddingBottom: 8 }}>{item.citations.map((c, i) => <Citation key={i} c={c} />)}</div>}
  </div>);
}
function OverridePanel({ fac, cap, sysSignal, override, onRecord, onRevert }) {
  const [choice, setChoice] = useState(override ? override.signal : sysSignal); const [note, setNote] = useState("");
  useEffect(() => { setChoice(override ? override.signal : sysSignal); setNote(""); }, [fac.id, cap]);
  const can = note.trim().length > 0 && (choice !== sysSignal || (override && choice !== override.signal));
  return (<div style={{ marginTop: 14, padding: 13, border: "1px solid var(--line)", borderRadius: 10, background: "#F7F8FA" }}>
    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>Planner override</div>
    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>System assessed <b style={{ color: SIGNAL[sysSignal].color }}>{SIGNAL[sysSignal].short}</b>. Set your verdict and record why — it is logged and updates the map.</div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
      {SIGNAL_ORDER.map((k) => { const on = choice === k; return <button key={k} className="tap focusable" onClick={() => setChoice(k)} style={{ border: `1.5px solid ${on ? SIGNAL[k].color : "var(--line)"}`, background: on ? SIGNAL[k].color + "14" : "var(--surface)", color: on ? SIGNAL[k].color : "var(--muted)", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{SIGNAL[k].glyph} {SIGNAL[k].short}</button>; })}
    </div>
    <textarea className="focusable" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Reason for override (required) — e.g. site visit confirmed ventilators despite missing procurement record."
      style={{ width: "100%", resize: "vertical", borderRadius: 8, border: "1px solid var(--line)", padding: "8px 10px", fontSize: 12.5, background: "var(--surface)", color: "var(--ink)", fontFamily: "'IBM Plex Sans',sans-serif" }} />
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 9 }}>
      <button className="tap focusable" disabled={!can} onClick={() => { onRecord(choice, note.trim()); setNote(""); }} style={{ border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, background: can ? "var(--accent)" : "#C3C9D1", color: "#fff", cursor: can ? "pointer" : "not-allowed" }}>Record override</button>
      {override && <button className="tap focusable" onClick={onRevert} style={{ border: "1px solid var(--line)", background: "var(--surface)", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, color: "var(--muted)", cursor: "pointer" }}>Revert to system</button>}
    </div></div>);
}
function Dossier({ fac, cap, overrides, recordOverride, revertOverride }) {
  const ev = fac.caps[cap]; const ovKey = fac.id + "|" + cap; const override = overrides[ovKey];
  const sysSignal = ev.signal; const shown = override ? override.signal : sysSignal;
  const tally = useMemo(() => { const t = { corroborated: 0, declared: 0, contradicted: 0, missing: 0 }; ev.items.forEach((i) => t[i.status]++); return t; }, [ev]);
  if (sysSignal === "no_claim") return <div style={{ padding: "14px 0", color: "var(--muted)", fontSize: 13.5 }}>This facility makes <b>no claim</b> to {cap} — nothing to evaluate. It is not advertised, empanelled, or registered for this service.</div>;
  return (<div className="fadein" style={{ paddingTop: 4 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
      <span className="seal" style={{ color: SIGNAL[shown].color, fontSize: 13.5, fontWeight: 600 }}>{SIGNAL[shown].glyph} {SIGNAL[shown].label}</span>
      {override && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>overridden · system said <b style={{ color: SIGNAL[sysSignal].color }}>{SIGNAL[sysSignal].short}</b></span>}
      <div style={{ marginLeft: "auto", minWidth: 150 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}><span>Evidence coverage</span><span className="mono" style={{ fontWeight: 600 }}>{ev.coverage}%</span></div>
        <div style={{ height: 7, borderRadius: 4, background: "#E3E7EB", overflow: "hidden" }}><div className="barfill" style={{ width: ev.coverage + "%", height: "100%", background: SIGNAL[sysSignal].color }} /></div>
      </div>
    </div>
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 6 }}>
      {[["corroborated", tally.corroborated], ["declared", tally.declared], ["contradicted", tally.contradicted], ["missing", tally.missing]].map(([k, n]) => <span key={k} style={{ fontSize: 11.5, color: STATUS[k].color, border: `1px solid ${STATUS[k].color}55`, background: STATUS[k].color + "10", borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>{n} {STATUS[k].label.toLowerCase()}</span>)}
    </div>
    {ev.contradictions > 0 && <div style={{ fontSize: 12.5, color: "#B23A2E", background: "#B23A2E10", border: "1px solid #B23A2E40", borderRadius: 8, padding: "8px 11px", margin: "8px 0" }}>⚠ {ev.contradictions} required item{ev.contradictions > 1 ? "s" : ""} contradicted by independent records — the claim is not supported by the evidence trail.</div>}
    <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>Evidence ledger</div>
    <div>{ev.items.map((i) => <LedgerRow key={i.key} item={i} />)}</div>
    <OverridePanel fac={fac} cap={cap} sysSignal={sysSignal} override={override} onRecord={(s, n) => recordOverride(fac, cap, s, n)} onRevert={() => revertOverride(fac, cap)} />
  </div>);
}
function FacilityRow({ fac, cap, expanded, onToggle, overrides, recordOverride, revertOverride }) {
  const sig = effSignal(fac, cap, overrides); const ev = fac.caps[cap]; const override = overrides[fac.id + "|" + cap];
  return (<div className="fadein" style={{ border: "1px solid var(--line)", borderRadius: 12, marginBottom: 8, background: expanded ? "var(--raise)" : "var(--surface)", overflow: "hidden", boxShadow: expanded ? "0 8px 26px rgba(20,30,45,.10)" : "none" }}>
    <button className="row tap focusable" onClick={onToggle} style={{ width: "100%", display: "flex", gap: 12, alignItems: "center", padding: "11px 13px", background: "none", border: "none", textAlign: "left", cursor: "pointer" }}>
      <span style={{ width: 11, height: 11, borderRadius: 11, background: SIGNAL[sig].color, flexShrink: 0, boxShadow: `0 0 0 3px ${SIGNAL[sig].color}22` }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fac.name}</div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 1 }}>{fac.tier} · {fac.district} · <span className="mono">{fac.beds} beds</span></div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}><Badge signal={sig} small />{sig !== "no_claim" && <div className="mono" style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 3 }}>{ev.coverage}% cov</div>}</div>
      {override && <span title="Overridden" style={{ color: "var(--accent)", fontSize: 13 }}>✎</span>}
      <span style={{ color: "var(--faint)", fontSize: 12, width: 12 }}>{expanded ? "▾" : "›"}</span>
    </button>
    {expanded && <div style={{ padding: "0 14px 14px" }}><Dossier fac={fac} cap={cap} overrides={overrides} recordOverride={recordOverride} revertOverride={revertOverride} /></div>}
  </div>);
}

/* ------------------------------------------------------------------ */
/* right scorecard panel                                               */
/* ------------------------------------------------------------------ */
function Scorecard({ name, level, a, delta, bench }) {
  const idxPct = Math.round(a.index * 100); const post = indexPosture(a.index, a.claimed);
  const t = a.claimed ? a.index : null;
  return (<div style={{ border: "1px solid var(--line)", borderRadius: 14, background: "var(--surface)", padding: 16 }}>
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
      <div><div className="mono" style={{ fontSize: 10.5, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".06em" }}>{level}</div>
        <div className="serif" style={{ fontSize: 21, fontWeight: 600, lineHeight: 1.1 }}>{name}</div></div>
      <div style={{ textAlign: "right" }}>
        <div className="serif" style={{ fontSize: 40, fontWeight: 900, lineHeight: 1, color: post.color }}>{a.claimed ? idxPct : "—"}</div>
        <div style={{ fontSize: 10.5, color: "var(--faint)" }}>evidence index</div>
      </div>
    </div>
    {/* gradient with marker */}
    <div style={{ marginTop: 12, position: "relative", height: 10, borderRadius: 6, background: `linear-gradient(90deg,${TRUST_STOPS.map((s) => `rgb(${s.rgb[0]},${s.rgb[1]},${s.rgb[2]}) ${Math.round(s.t * 100)}%`).join(",")})` }}>
      {t != null && <div style={{ position: "absolute", left: `calc(${Math.round(t * 100)}% - 6px)`, top: -3, width: 12, height: 16, borderRadius: 3, background: "var(--surface)", border: "2px solid var(--ink)" }} />}
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: post.color }}>{post.word}</span>
      <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>{a.count} facilities · {a.claimed} claim</span>
    </div>
    {a.claimed > 0 && (() => { const ti = trendInfo(delta); return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12 }}>
        <span style={{ color: ti.color, fontWeight: 700 }}>{ti.arrow} {delta > 0 ? "+" : ""}{delta} pts</span>
        <span style={{ color: "var(--muted)" }}>{ti.mag.toLowerCase()} {ti.up ? "improvement" : ti.down ? "decline" : "change"} vs last quarter</span>
      </div>); })()}
    {bench && a.claimed > 0 && (() => { const d = Math.round((a.index - bench.idx) * 100); const col = d > 0 ? "#0E7C6B" : d < 0 ? "#B23A2E" : "#9AA0A8"; return (
      <div style={{ marginTop: 5, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontWeight: 700, color: col }}>{d > 0 ? "▲ +" : d < 0 ? "▼ " : "• "}{d === 0 ? "level" : d + " pts"}</span>
        <span style={{ color: "var(--muted)" }}>vs {bench.label} ({Math.round(bench.idx * 100)}%)</span>
      </div>); })()}
    <div style={{ marginTop: 12 }}><MixBar a={a} /></div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
      {SIGNAL_ORDER.map((k) => <div key={k} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--muted)" }}>
        <span style={{ width: 8, height: 8, borderRadius: 8, background: SIGNAL[k].color }} /><b style={{ color: "var(--ink)" }}>{a[k]}</b> {SIGNAL[k].short}</div>)}
    </div>
    {a.weak > 0 && <div style={{ marginTop: 11, fontSize: 12.5, color: "#B23A2E", background: "#B23A2E10", border: "1px solid #B23A2E33", borderRadius: 8, padding: "7px 10px" }}>
      {a.weak} facilit{a.weak > 1 ? "ies" : "y"} ({Math.round(a.weakShare * 100)}% of claims) show weak or contradicted evidence — inspect before relying on the claim.</div>}
  </div>);
}

function Methodology() {
  const [open, setOpen] = useState(false);
  return (<div style={{ border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface)" }}>
    <button className="tap focusable" onClick={() => setOpen((o) => !o)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "none", border: "none", cursor: "pointer" }}>
      <span style={{ fontWeight: 600, fontSize: 12.5 }}>How the verdict is scored</span><span style={{ color: "var(--faint)" }}>{open ? "▾" : "›"}</span></button>
    {open && <div style={{ padding: "0 12px 12px", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
      Each capability has required and supporting items, checked against independent registries (CEA, NABH/NABL, PM-JAY, HMIS, NMC, procurement & licences) and the facility's own declaration. Items resolve to <b style={{ color: STATUS.corroborated.color }}>corroborated</b>, <b style={{ color: STATUS.declared.color }}>self-declared</b>, <b style={{ color: STATUS.contradicted.color }}>contradicted</b>, or <b style={{ color: STATUS.missing.color }}>missing</b>.
      <ul style={{ margin: "8px 0 0", paddingLeft: 16 }}>
        <li><b style={{ color: SIGNAL.strong.color }}>Strong</b> — all required corroborated, ≥78% coverage, no contradictions.</li>
        <li><b style={{ color: SIGNAL.partial.color }}>Partial</b> — mostly declared, ≥48% coverage, ≤1 required gap.</li>
        <li><b style={{ color: SIGNAL.weak.color }}>Weak / suspicious</b> — any contradiction, or thin coverage.</li>
        <li><b style={{ color: SIGNAL.no_claim.color }}>No claim</b> — service not claimed.</li>
      </ul></div>}
  </div>);
}

function RankRow({ rank, e, onPick }) {
  const ti = trendInfo(e.delta); const pct = Math.round(e.a.index * 100); const post = indexPosture(e.a.index, e.a.claimed);
  return (<button className="row tap focusable" onClick={() => onPick(e)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px", background: "none", border: "none", borderBottom: "1px solid var(--line)", cursor: "pointer", textAlign: "left" }}>
    <span className="mono" style={{ width: 20, textAlign: "right", fontSize: 12, color: "var(--faint)", fontWeight: 600 }}>{rank}</span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.name}</div>
      <div style={{ height: 5, borderRadius: 3, background: "#E3E7EB", overflow: "hidden", marginTop: 3 }}><div style={{ width: pct + "%", height: "100%", background: post.color }} /></div>
    </div>
    <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: post.color, width: 32, textAlign: "right" }}>{e.a.claimed ? pct : "—"}</span>
    <span style={{ fontSize: 11.5, fontWeight: 700, color: ti.color, width: 46, textAlign: "right" }}>{ti.arrow}{e.delta > 0 ? "+" : ""}{e.delta}</span>
    <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)", width: 16, textAlign: "right" }}>{e.a.count}</span>
  </button>);
}
function Rankings({ entries, scopeLabel, onPick }) {
  const ranked = entries.filter((e) => e.a.count > 0).slice().sort((a, b) => (b.a.index - a.a.index) || (b.a.count - a.a.count));
  const claimed = ranked.filter((e) => e.a.claimed > 0);
  const improver = claimed.slice().sort((a, b) => b.delta - a.delta)[0];
  const decliner = claimed.slice().sort((a, b) => a.delta - b.delta)[0];
  return (<div>
    {(improver || decliner) && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
      {[["Trending up", improver, "#0E7C6B"], ["Trending down", decliner, "#B23A2E"]].map(([lbl, e, col]) => e ? (
        <div key={lbl} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "8px 10px", background: "var(--surface)" }}>
          <div style={{ fontSize: 10, color: "var(--faint)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>{lbl}</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.name}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: col }}>{trendInfo(e.delta).arrow} {e.delta > 0 ? "+" : ""}{e.delta} pts</div>
        </div>) : <div key={lbl} />)}
    </div>}
    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", margin: "2px 0 6px" }}>{scopeLabel} · evidence index ranking</div>
    {ranked.length === 0 ? <div style={{ fontSize: 12.5, color: "var(--muted)" }}>No regions with facilities here.</div>
      : ranked.map((e, i) => <RankRow key={e.name} rank={i + 1} e={e} onPick={onPick} />)}
  </div>);
}

/* ------------------------------------------------------------------ */
/* app                                                                 */
/* ------------------------------------------------------------------ */
export default function App() {
  const [cap, setCap] = useState("ICU");
  const [region, setRegion] = useState(null);
  const [district, setDistrict] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [auditLog, setAuditLog] = useState([]);
  const [hoverKey, setHoverKey] = useState(null);
  const listRef = useRef(null);

  const facilitiesByState = useMemo(() => { const m = {}; FACILITIES.forEach((f) => (m[f.state] = m[f.state] || []).push(f)); return m; }, []);

  // point-in-polygon district assignment (shared by map + list)
  const facilitiesByDistrict = useMemo(() => {
    const byState = {}; DISTRICTS_FC.features.forEach((f) => (byState[f.properties.st_nm] = byState[f.properties.st_nm] || []).push(f));
    const out = {};
    FACILITIES.forEach((f) => {
      const cands = byState[f.state] || []; let hit = null;
      for (const d of cands) if (d3.geoContains(d, [f.lon, f.lat])) { hit = d; break; }
      if (!hit && cands.length) { let bd = Infinity; cands.forEach((d) => { const c = d3.geoCentroid(d); const dd = (c[0] - f.lon) ** 2 + (c[1] - f.lat) ** 2; if (dd < bd) { bd = dd; hit = d; } }); }
      if (hit) { const k = f.state + "|" + hit.properties.district; (out[k] = out[k] || []).push(f); }
    });
    return out;
  }, []);

  const capMix = useMemo(() => { const o = {}; CAPS.forEach((c) => { o[c] = aggregate(FACILITIES, c, overrides); }); return o; }, [overrides]);

  const scopeList = useMemo(() => {
    if (district) return facilitiesByDistrict[region + "|" + district] || [];
    if (region) return facilitiesByState[region] || [];
    return FACILITIES;
  }, [region, district, facilitiesByState, facilitiesByDistrict]);

  const ranked = useMemo(() => scopeList.slice().sort((a, b) => {
    const ra = RANK[effSignal(a, cap, overrides)], rb = RANK[effSignal(b, cap, overrides)];
    return ra !== rb ? ra - rb : (b.caps[cap].coverage || 0) - (a.caps[cap].coverage || 0);
  }), [scopeList, cap, overrides]);
  const [tab, setTab] = useState("rankings");
  const rankEntries = useMemo(() => {
    if (region) {
      return Object.keys(facilitiesByDistrict).filter((k) => k.startsWith(region + "|"))
        .map((k) => { const dn = k.split("|")[1]; return { name: dn, level: "district", a: aggregate(facilitiesByDistrict[k], cap, overrides), delta: regionDelta(dn, cap) }; });
    }
    return Object.keys(facilitiesByState).map((st) => ({ name: st, level: "state", a: aggregate(facilitiesByState[st], cap, overrides), delta: regionDelta(st, cap) }));
  }, [region, cap, overrides, facilitiesByState, facilitiesByDistrict]);
  const onPick = useCallback((e) => { if (e.level === "state") { setRegion(e.name); setDistrict(null); } else { setDistrict(e.name); } setSelectedId(null); }, []);
  useEffect(() => { setTab(district ? "facilities" : "rankings"); }, [region, district]);

  // active scorecard = hovered region, else drilled scope
  const scoreView = useMemo(() => {
    if (hoverKey) return { name: hoverKey.name, level: hoverKey.level, a: hoverKey.a };
    if (district) return { name: district, level: "District", a: aggregate(scopeList, cap, overrides) };
    if (region) return { name: region, level: "State", a: aggregate(scopeList, cap, overrides) };
    return { name: "All India", level: "Nation", a: aggregate(FACILITIES, cap, overrides) };
  }, [hoverKey, district, region, scopeList, cap, overrides]);

  const benchmark = useMemo(() => {
    if (scoreView.level === "District") return { idx: aggregate(facilitiesByState[region] || [], cap, overrides).index, label: (region || "state") + " avg" };
    if (scoreView.level === "State") return { idx: aggregate(FACILITIES, cap, overrides).index, label: "national avg" };
    return null;
  }, [scoreView.level, region, cap, overrides, facilitiesByState]);

  const recordOverride = useCallback((fac, capability, signal, note) => {
    const key = fac.id + "|" + capability; const at = new Date().toISOString().slice(0, 16).replace("T", " ");
    setOverrides((o) => ({ ...o, [key]: { signal, note, at } }));
    setAuditLog((l) => [...l, { facId: fac.id, facName: fac.name, state: fac.state, cap: capability, signal, at }]);
  }, []);
  const revertOverride = useCallback((fac, capability) => { const key = fac.id + "|" + capability; setOverrides((o) => { const n = { ...o }; delete n[key]; return n; }); }, []);

  useEffect(() => { if (!selectedId) return; const el = document.getElementById("fac-" + selectedId); if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [selectedId, ranked]);

  return (
    <div className="ftd" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <StyleTag />
      {/* header */}
      <header style={{ borderBottom: "1px solid var(--line)", background: "var(--surface)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 18px", flexWrap: "wrap" }}>
          <div style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 8, background: "var(--accent)", color: "#fff", fontFamily: "'Fraunces',serif", fontWeight: 900, fontSize: 18 }}>त</div>
          <div><div className="serif" style={{ fontWeight: 900, fontSize: 18, lineHeight: 1 }}>Facility Trust Desk</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 1 }}>Can this facility actually do what it claims? · India</div></div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 5, flexWrap: "wrap" }}>
            {CAPS.map((c) => { const on = c === cap; return (
              <button key={c} className="capbtn tap focusable" onClick={() => { setCap(c); setSelectedId(null); }}
                style={{ border: `1.5px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "var(--accent)" : "var(--surface)", color: on ? "#fff" : "var(--muted)", borderRadius: 999, padding: "5px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{c}</button>); })}
          </div>
        </div>
      </header>

      {/* body: map + score panel */}
      <div className="bodygrid" style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(520px,2.6fr) minmax(312px,360px)" }}>
        <section style={{ borderRight: "1px solid var(--line)", background: "var(--surface)", minHeight: 0 }}>
          <MapPanel cap={cap} overrides={overrides} region={region} district={district}
            setRegion={setRegion} setDistrict={setDistrict} facilitiesByState={facilitiesByState}
            facilitiesByDistrict={facilitiesByDistrict} selectedId={selectedId} setSelectedId={setSelectedId}
            hoverKey={hoverKey} setHoverKey={setHoverKey} />
        </section>

        <section ref={listRef} style={{ overflow: "auto", padding: "12px 12px 24px", background: "var(--paper)", minHeight: 0 }}>
          <Scorecard name={scoreView.name} level={scoreView.level} a={scoreView.a} delta={regionDelta(scoreView.name, cap)} bench={benchmark} />

          {/* tabs */}
          <div style={{ display: "flex", gap: 6, margin: "16px 0 10px", borderBottom: "1px solid var(--line)" }}>
            {[["rankings", "Rankings & trends"], ["facilities", `Facilities (${ranked.length})`]].map(([k, lbl]) => (
              <button key={k} className="tap focusable" onClick={() => setTab(k)} style={{ border: "none", background: "none", padding: "6px 4px 9px", marginBottom: -1, cursor: "pointer", fontSize: 13, fontWeight: 600, color: tab === k ? "var(--ink)" : "var(--faint)", borderBottom: `2px solid ${tab === k ? "var(--accent)" : "transparent"}` }}>{lbl}</button>
            ))}
          </div>
          {tab === "rankings"
            ? <Rankings entries={rankEntries} scopeLabel={region ? region + " districts" : "States"} onPick={onPick} />
            : (ranked.length === 0 ? <div style={{ fontSize: 13, color: "var(--muted)", padding: "12px 2px" }}>No facilities in this area. Zoom out or pick another region on the map.</div>
              : ranked.map((f) => <div id={"fac-" + f.id} key={f.id}>
                <FacilityRow fac={f} cap={cap} expanded={selectedId === f.id} onToggle={() => setSelectedId((id) => id === f.id ? null : f.id)} overrides={overrides} recordOverride={recordOverride} revertOverride={revertOverride} /></div>))}

          {auditLog.length > 0 && <div style={{ marginTop: 14, border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface)", padding: "10px 12px" }}>
            <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 8 }}>Planner overrides ({auditLog.length})</div>
            {auditLog.slice().reverse().map((aa, i) => <button key={i} className="tap focusable" onClick={() => { setCap(aa.cap); setRegion(aa.state); setDistrict(null); setSelectedId(aa.facId); }}
              style={{ display: "block", textAlign: "left", border: "none", background: "none", cursor: "pointer", padding: "2px 0", width: "100%" }}>
              <span style={{ fontSize: 11.5 }}><b>{aa.facName.split(",")[0]}</b> · {aa.cap} <span style={{ color: SIGNAL[aa.signal].color, fontWeight: 600 }}>→ {SIGNAL[aa.signal].short}</span></span>
              <span className="mono" style={{ fontSize: 10, color: "var(--faint)", display: "block" }}>{aa.at}</span></button>)}
          </div>}

          <div style={{ marginTop: 14 }}><Methodology /></div>
          <div style={{ marginTop: 12, fontSize: 10.5, color: "var(--faint)", lineHeight: 1.5 }}>Demo dataset — facilities & citations are synthesised to model real Indian registries. Verdicts are evidence-derived, not endorsements.</div>
        </section>
      </div>

      <style>{`@media (max-width:920px){ .bodygrid{ grid-template-columns:1fr !important; grid-auto-rows:minmax(0,auto); } .bodygrid > section:first-child{ height:460px; border-right:none; border-bottom:1px solid var(--line);} }`}</style>
    </div>
  );
}
