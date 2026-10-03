// The user's own drawing on the forecast chart — trend lines and buy/sell points — the pure half.
//
// A trader draws where they think the price is going; the page then says how that compares with
// the forecast: how likely the price is to end above their line, or to be at or under their buy
// point on that day. Drawings stay on the device (localStorage), per asset, in real time and price
// so they survive switching the horizon.
import type { ConeT } from './forecast-meta';

export const DRAW_KEY = 'imb.fc.draw.v1';

export type Pt = [number, number]; // [ms, price]
export interface Trend {
  id: string;
  a: Pt;
  b: Pt;
}
export interface Mark {
  id: string;
  kind: 'buy' | 'sell';
  at: Pt;
}
export interface Drawing {
  trends: Trend[];
  marks: Mark[];
}
export type Drawings = Record<string, Drawing>;

export const emptyDrawing = (): Drawing => ({ trends: [], marks: [] });
const MAX_TRENDS = 8;
const MAX_MARKS = 16;

const pt = (x: unknown): Pt | null => (Array.isArray(x) && x.length === 2 && x.every((v) => typeof v === 'number' && Number.isFinite(v)) && x[1] > 0 ? [x[0], x[1]] : null);

export function normalizeDrawings(raw: unknown): Drawings {
  const out: Drawings = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const d = v as Partial<Drawing>;
    const trends = (Array.isArray(d.trends) ? d.trends : [])
      .map((t) => ({ id: String(t?.id ?? ''), a: pt(t?.a), b: pt(t?.b) }))
      .filter((t): t is Trend => !!t.id && !!t.a && !!t.b && t.a[0] !== t.b[0])
      .slice(-MAX_TRENDS);
    const marks = (Array.isArray(d.marks) ? d.marks : [])
      .map((m) => ({ id: String(m?.id ?? ''), kind: m?.kind, at: pt(m?.at) }))
      .filter((m): m is Mark => !!m.id && (m.kind === 'buy' || m.kind === 'sell') && !!m.at)
      .slice(-MAX_MARKS);
    if (trends.length || marks.length) out[k] = { trends, marks };
  }
  return out;
}

export function addTrend(d: Drawing, a: Pt, b: Pt, id: string): Drawing {
  if (a[0] === b[0]) return d;
  const [p, q] = a[0] < b[0] ? [a, b] : [b, a];
  return { ...d, trends: [...d.trends, { id, a: p, b: q }].slice(-MAX_TRENDS) };
}
export function addMark(d: Drawing, kind: Mark['kind'], at: Pt, id: string): Drawing {
  return { ...d, marks: [...d.marks, { id, kind, at }].slice(-MAX_MARKS) };
}
export function removeItem(d: Drawing, id: string): Drawing {
  return { trends: d.trends.filter((t) => t.id !== id), marks: d.marks.filter((m) => m.id !== id) };
}

/** The price on a trend line at time t — straight in log price, so a steady percentage trend draws straight. */
export function trendAt(tr: Trend, t: number): number {
  const [ta, pa] = tr.a;
  const [tb, pb] = tr.b;
  const f = (t - ta) / (tb - ta);
  return Math.exp(Math.log(pa) + f * (Math.log(pb) - Math.log(pa)));
}

const QS = [0.05, 0.25, 0.5, 0.75, 0.95];

/**
 * P(price on that day ≤ p) from the cone's five percentiles, piecewise linear in log price.
 * Outside the 90% band the cone says nothing finer than «under 5%» / «over 95%», so it is clamped
 * there (2.5% / 97.5%) rather than extrapolated.
 */
export function probBelow(c: ConeT, p: number): number {
  const q = [c.p5, c.p25, c.p50, c.p75, c.p95].map(Math.log);
  const x = Math.log(p);
  if (x < q[0]) return 0.025;
  if (x > q[4]) return 0.975;
  for (let k = 0; k < 4; k++)
    if (x <= q[k + 1]) {
      const f = q[k + 1] > q[k] ? (x - q[k]) / (q[k + 1] - q[k]) : 0.5;
      return QS[k] + f * (QS[k + 1] - QS[k]);
    }
  return 0.975;
}

/** the cone on day t, interpolated between its points (null outside it) */
export function coneAt(cone: ConeT[], t: number): ConeT | null {
  if (!cone.length || t < cone[0].t || t > cone[cone.length - 1].t) return null;
  for (let k = 1; k < cone.length; k++) {
    const a = cone[k - 1];
    const b = cone[k];
    if (t <= b.t) {
      const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
      const m = (x: number, y: number) => Math.exp(Math.log(x) + f * (Math.log(y) - Math.log(x)));
      return { t, p5: m(a.p5, b.p5), p25: m(a.p25, b.p25), p50: m(a.p50, b.p50), p75: m(a.p75, b.p75), p95: m(a.p95, b.p95) };
    }
  }
  return cone[cone.length - 1];
}

export type Readout =
  | { id: string; kind: 'trend'; endT: number; endPrice: number; pAbove: number; slopePctPerMonth: number }
  | { id: string; kind: 'buy' | 'sell'; t: number; price: number; future: true; p: number; vsTodayPct: number }
  | { id: string; kind: 'buy' | 'sell'; t: number; price: number; future: false; actual: number; vsActualPct: number }
  | { id: string; kind: 'pair'; buy: Mark; sell: Mark; returnPct: number };

/**
 * What the forecast says about each drawn object:
 *  • trend: its price at the end of the horizon and P(the price ends above it);
 *  • future buy point: P(price that day ≤ it) — the chance it is cheap enough to buy there;
 *  • future sell point: P(price that day ≥ it);
 *  • past points: the real price that day;
 *  • a buy followed by a later sell: the return of that plan.
 */
export function readouts(d: Drawing, cone: ConeT[], history: Pt[], anchor: number): Readout[] {
  const out: Readout[] = [];
  const now = cone[0]?.t ?? Date.now();
  const end = cone[cone.length - 1];
  if (end)
    for (const tr of d.trends) {
      const endPrice = trendAt(tr, end.t);
      const month = 30 * 86_400_000;
      out.push({ id: tr.id, kind: 'trend', endT: end.t, endPrice, pAbove: 1 - probBelow(end, endPrice), slopePctPerMonth: (trendAt(tr, tr.a[0] + month) / tr.a[1] - 1) * 100 });
    }
  const marks = [...d.marks].sort((a, b) => a.at[0] - b.at[0]);
  for (const m of marks) {
    const [t, price] = m.at;
    const c = t > now ? coneAt(cone, t) : null;
    if (c) {
      const below = probBelow(c, price);
      out.push({ id: m.id, kind: m.kind, t, price, future: true, p: m.kind === 'buy' ? below : 1 - below, vsTodayPct: (price / anchor - 1) * 100 });
    } else if (t <= now && history.length) {
      let best = history[0];
      for (const h of history) if (Math.abs(h[0] - t) < Math.abs(best[0] - t)) best = h;
      out.push({ id: m.id, kind: m.kind, t, price, future: false, actual: best[1], vsActualPct: (price / best[1] - 1) * 100 });
    }
  }
  // each buy with the first sell after it
  for (const b of marks.filter((m) => m.kind === 'buy')) {
    const s = marks.find((m) => m.kind === 'sell' && m.at[0] > b.at[0]);
    if (s) out.push({ id: `${b.id}>${s.id}`, kind: 'pair', buy: b, sell: s, returnPct: (s.at[1] / b.at[1] - 1) * 100 });
  }
  return out;
}
