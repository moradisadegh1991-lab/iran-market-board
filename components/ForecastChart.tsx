'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConeT } from '@/lib/forecast-meta';
import { trendAt, type Drawing, type Pt } from '@/lib/forecast-draw';
import { IND_COLOR, type IndicatorLines } from '@/lib/indicators';
export type { ConeT };

const faDay = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: 'Asia/Tehran',
  month: 'short',
  day: 'numeric',
});
const faDayYear = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});
const compact = new Intl.NumberFormat('fa-IR', {
  notation: 'compact',
  maximumSignificantDigits: 3,
});

const PAD = { top: 18, right: 62, bottom: 26, left: 6 };
/** height of the RSI / MACD panes under the price */
const PANE = 74;
const GAP = 12;
const DAY = 86_400_000;

export type DrawTool = 'none' | 'trend' | 'buy' | 'sell' | 'erase';

/** the engine's buy/sell plan, in price (lib/engine/forecast-timing.ts) */
export interface PlanMarks {
  buy: number;
  sell: number;
  /** typical day (from today) and level of the window's low / high */
  lowDay: number;
  low: number;
  highDay: number;
  high: number;
}

type Path = [number, number | null][];

/**
 * Past prices, then the forecast cone: 90% band, 50% band and the median, from today to the horizon.
 * Optionally: indicator lines over the past prices (RSI and MACD in panes below), the engine's buy and
 * sell levels, and the user's own trend lines and buy/sell points (drawn with `tool`).
 */
export default function ForecastChart({
  history,
  cone,
  fmt,
  lines,
  plan,
  drawing,
  tool = 'none',
  onAddTrend,
  onAddMark,
  onRemove,
}: {
  history: [number, number][];
  cone: ConeT[];
  fmt: (v: number) => string;
  lines?: IndicatorLines | null;
  plan?: PlanMarks | null;
  drawing?: Drawing | null;
  tool?: DrawTool;
  onAddTrend?: (a: Pt, b: Pt) => void;
  onAddMark?: (kind: 'buy' | 'sell', at: Pt) => void;
  onRemove?: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [h, setH] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [pending, setPending] = useState<Pt | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setW(el.clientWidth);
      setH(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setPending(null), [tool]);

  const panes = (lines?.rsi ? 1 : 0) + (lines?.macd ? 1 : 0);

  const g = useMemo(() => {
    if (!w || !h || history.length < 2 || cone.length < 2) return null;
    const t0 = history[0][0];
    const t1 = cone[cone.length - 1].t;
    let lo = Infinity;
    let hi = -Infinity;
    for (const [, v] of history) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    for (const c of cone) {
      lo = Math.min(lo, c.p5);
      hi = Math.max(hi, c.p95);
    }
    for (const o of lines?.overlays ?? []) for (const [, v] of o.points) if (v !== null) ((lo = Math.min(lo, v)), (hi = Math.max(hi, v)));
    if (plan) ((lo = Math.min(lo, plan.buy, plan.low)), (hi = Math.max(hi, plan.sell, plan.high)));
    const span = hi - lo || hi * 0.01 || 1;
    lo -= span * 0.04;
    hi += span * 0.04;
    const iw = w - PAD.left - PAD.right;
    const ih = Math.max(80, h - PAD.top - PAD.bottom - panes * (PANE + GAP));
    const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * iw;
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * ih;
    const tOf = (px: number) => t0 + ((px - PAD.left) / iw) * (t1 - t0);
    const vOf = (py: number) => lo + (1 - (py - PAD.top) / ih) * (hi - lo);
    const path = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)},${y(b).toFixed(1)}`).join('');
    // a line with gaps where the value is null (an indicator before its window is full)
    const gapPath = (pts: Path, yy: (v: number) => number) => {
      let d = '';
      let pen = false;
      for (const [t, v] of pts) {
        if (v === null || !Number.isFinite(v)) {
          pen = false;
          continue;
        }
        d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)},${yy(v).toFixed(1)}`;
        pen = true;
      }
      return d;
    };
    const band = (lowK: keyof ConeT, highK: keyof ConeT) =>
      path(cone.map((c) => [c.t, c[highK]] as [number, number])) +
      cone
        .slice()
        .reverse()
        .map((c) => `L${x(c.t).toFixed(1)},${y(c[lowK]).toFixed(1)}`)
        .join('') +
      'Z';
    // ~4 round ticks
    const raw = (hi - lo) / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const stepTick = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
    const ticks: number[] = [];
    for (let v = Math.ceil(lo / stepTick) * stepTick; v <= hi; v += stepTick) ticks.push(v);

    // panes under the price: RSI (0–100), then MACD (its own symmetric scale)
    const paneTops: { kind: 'rsi' | 'macd'; top: number }[] = [];
    let top = PAD.top + ih + GAP;
    if (lines?.rsi) (paneTops.push({ kind: 'rsi', top }), (top += PANE + GAP));
    if (lines?.macd) paneTops.push({ kind: 'macd', top });
    const paneG = paneTops.map(({ kind, top }) => {
      if (kind === 'rsi') {
        const yy = (v: number) => top + (1 - v / 100) * PANE;
        return {
          kind,
          top,
          yy,
          d: [gapPath(lines!.rsi!, yy)],
          ticks: [30, 70],
        };
      }
      const m = lines!.macd!;
      let a = 0;
      for (const s of [m.macd, m.signal, m.hist]) for (const [, v] of s) if (v !== null) a = Math.max(a, Math.abs(v));
      a = a || 1;
      const yy = (v: number) => top + (0.5 - v / (2 * a)) * PANE;
      const bw = Math.max(1, (iw / Math.max(1, m.hist.length + cone.length)) * 0.6);
      const bars = m.hist
        .filter(([, v]) => v !== null)
        .map(([t, v]) => ({
          x: x(t) - bw / 2,
          y: Math.min(yy(0), yy(v!)),
          h: Math.abs(yy(v!) - yy(0)),
          up: v! >= 0,
          w: bw,
        }));
      return {
        kind,
        top,
        yy,
        d: [gapPath(m.macd, yy), gapPath(m.signal, yy)],
        ticks: [0],
        bars,
      };
    });

    return {
      x,
      y,
      tOf,
      vOf,
      t0,
      t1,
      ih,
      now: cone[0].t,
      ticks,
      hist: path(history),
      outer: band('p5', 'p95'),
      inner: band('p25', 'p75'),
      median: path(cone.map((c) => [c.t, c.p50])),
      overlays: (lines?.overlays ?? []).map((o) => ({
        key: o.key,
        color: o.color,
        dashed: o.dashed,
        d: gapPath(o.points, y),
      })),
      paneG,
      iw,
    };
  }, [w, h, history, cone, lines, plan, panes]);

  // the user's trend lines, straight in log price from their first point to the chart's end
  const trends = useMemo(() => {
    if (!g || !drawing) return [];
    return drawing.trends.map((tr) => {
      const from = Math.max(g.t0, Math.min(tr.a[0], tr.b[0]));
      const pts: [number, number][] = [];
      for (let k = 0; k <= 32; k++) {
        const t = from + ((g.t1 - from) * k) / 32;
        pts.push([g.x(t), g.y(trendAt(tr, t))]);
      }
      return {
        id: tr.id,
        pts,
        d: pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join(''),
        a: tr.a,
        b: tr.b,
      };
    });
  }, [g, drawing]);

  // the point under the finger: a past price, or the forecast range on that day
  const tip = useMemo(() => {
    if (!g || hover === null || tool !== 'none') return null;
    const t = g.tOf(hover);
    if (t <= g.now) {
      let best = history[0];
      for (const p of history) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
      return {
        kind: 'past' as const,
        t: best[0],
        v: best[1],
        px: g.x(best[0]),
        py: g.y(best[1]),
      };
    }
    let best = cone[0];
    for (const c of cone) if (Math.abs(c.t - t) < Math.abs(best.t - t)) best = c;
    return {
      kind: 'cone' as const,
      c: best,
      t: best.t,
      px: g.x(best.t),
      py: g.y(best.p50),
    };
  }, [g, hover, history, cone, tool]);

  const local = (e: React.PointerEvent) => {
    const r = host.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };
  const move = (e: React.PointerEvent) => {
    const { px } = local(e);
    setHover(Math.min(Math.max(px, PAD.left), w - PAD.right));
  };
  const down = (e: React.PointerEvent) => {
    if (tool === 'none' || !g) return move(e);
    const { px, py } = local(e);
    if (px < PAD.left || px > w - PAD.right || py < PAD.top || py > PAD.top + g.ih) return;
    e.preventDefault();
    const at: Pt = [Math.round(g.tOf(px)), g.vOf(py)];
    if (at[1] <= 0) return;
    if (tool === 'buy' || tool === 'sell') onAddMark?.(tool, at);
    else if (tool === 'trend') {
      if (!pending) setPending(at);
      else if (Math.abs(g.x(pending[0]) - px) >= 8) {
        onAddTrend?.(pending, at);
        setPending(null);
      }
    } else if (tool === 'erase' && drawing) {
      // the nearest drawn object within a finger's width
      let best: { id: string; d: number } | null = null;
      for (const m of drawing.marks) {
        const d = Math.hypot(g.x(m.at[0]) - px, g.y(m.at[1]) - py);
        if (!best || d < best.d) best = { id: m.id, d };
      }
      for (const tr of trends)
        for (const [a, b] of tr.pts) {
          const d = Math.hypot(a - px, b - py);
          if (!best || d < best.d) best = { id: tr.id, d };
        }
      if (best && best.d <= 24) onRemove?.(best.id);
    }
  };

  const fullH = h;
  return (
    <div
      ref={host}
      className={`chart-host fc-host${panes ? ` with-panes-${panes}` : ''}${tool !== 'none' ? ' drawing' : ''}`}
      dir="ltr"
      role="img"
      aria-label="نمودار پیش‌بینی قیمت: قیمت‌های گذشته و محدوده محتمل آینده"
      onPointerMove={move}
      onPointerDown={down}
      onPointerLeave={() => setHover(null)}
    >
      {g ? (
        <svg width={w} height={fullH}>
          {g.ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={w - PAD.right} y1={g.y(v)} y2={g.y(v)} className="fc-grid" />
              <text x={w - PAD.right + 6} y={g.y(v) + 4} className="fc-axis">
                {compact.format(v)}
              </text>
            </g>
          ))}
          <path d={g.outer} className="fc-outer" />
          <path d={g.inner} className="fc-inner" />
          <path d={g.median} className="fc-median" />
          {g.overlays.map((o) => (
            <path key={o.key} d={o.d} fill="none" stroke={o.color} strokeWidth={1.4} strokeDasharray={o.dashed ? '4 3' : undefined} data-ind={o.key} />
          ))}
          <path d={g.hist} className="fc-hist" />
          <line x1={g.x(g.now)} x2={g.x(g.now)} y1={PAD.top - 8} y2={PAD.top + g.ih} className="fc-today" />
          <text x={g.x(g.now)} y={PAD.top - 9} className="fc-axis fc-today-label" textAnchor="middle">
            امروز
          </text>
          <circle cx={g.x(g.now)} cy={g.y(cone[0].p50)} r={3.5} className="fc-dot" />

          {plan ? (
            <g className="fc-plan" data-testid="fc-plan">
              <line x1={g.x(g.now) - 4} x2={w - PAD.right} y1={g.y(plan.buy)} y2={g.y(plan.buy)} className="fc-plan-buy" />
              <text x={g.x(g.now) - 5} y={g.y(plan.buy) + (plan.buy < plan.sell ? 13 : -5)} textAnchor="end" className="fc-axis fc-halo fc-plan-buy-t">
                خرید محدود
              </text>
              <line x1={g.x(g.now) - 4} x2={w - PAD.right} y1={g.y(plan.sell)} y2={g.y(plan.sell)} className="fc-plan-sell" />
              <text x={g.x(g.now) - 5} y={g.y(plan.sell) - 5} textAnchor="end" className="fc-axis fc-halo fc-plan-sell-t">
                هدف فروش
              </text>
              <circle cx={g.x(g.now + plan.lowDay * DAY)} cy={g.y(plan.low)} r={5} className="fc-plan-low" />
              <circle cx={g.x(g.now + plan.highDay * DAY)} cy={g.y(plan.high)} r={5} className="fc-plan-high" />
            </g>
          ) : null}

          {g.paneG.map((p) => (
            <g key={p.kind} data-pane={p.kind}>
              <rect x={PAD.left} y={p.top} width={g.iw} height={PANE} className="fc-pane" />
              {p.ticks.map((v) => (
                <g key={v}>
                  <line x1={PAD.left} x2={w - PAD.right} y1={p.yy(v)} y2={p.yy(v)} className="fc-grid" strokeDasharray="2 3" />
                  <text x={w - PAD.right + 6} y={p.yy(v) + 4} className="fc-axis">
                    {v.toLocaleString('fa-IR')}
                  </text>
                </g>
              ))}
              {'bars' in p && p.bars
                ? p.bars.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={Math.max(0.5, b.h)} fill={b.up ? 'rgba(17,122,69,.45)' : 'rgba(184,58,47,.45)'} />)
                : null}
              <path d={p.d[0]} fill="none" stroke={p.kind === 'rsi' ? IND_COLOR.rsi : IND_COLOR.macd} strokeWidth={1.6} />
              {p.d[1] ? <path d={p.d[1]} fill="none" stroke={IND_COLOR.signal} strokeWidth={1.2} /> : null}
              <text x={PAD.left + 4} y={p.top + 12} className="fc-axis fc-halo fc-pane-label" textAnchor="start">
                {p.kind === 'rsi' ? 'RSI ۱۴' : 'MACD ۱۲/۲۶/۹'}
              </text>
            </g>
          ))}

          {trends.map((tr) => (
            <g key={tr.id} className="fc-user-trend" data-testid="fc-trend">
              <path d={tr.d} />
              <circle cx={g.x(tr.a[0])} cy={g.y(tr.a[1])} r={3.5} />
              <circle cx={g.x(tr.b[0])} cy={g.y(tr.b[1])} r={3.5} />
            </g>
          ))}
          {drawing?.marks
            .filter((m) => m.at[0] >= g.t0 && m.at[0] <= g.t1)
            .map((m) => {
              const cx = g.x(m.at[0]);
              const cy = g.y(m.at[1]);
              return (
                <g key={m.id} className={`fc-mark fc-mark-${m.kind}`} data-testid={`fc-mark-${m.kind}`}>
                  <path d={m.kind === 'buy' ? `M${cx},${cy - 2}l7,12h-14z` : `M${cx},${cy + 2}l7,-12h-14z`} />
                  <text x={cx} y={m.kind === 'buy' ? cy + 24 : cy - 15} textAnchor="middle" className="fc-axis fc-halo">
                    {m.kind === 'buy' ? 'خرید' : 'فروش'}
                  </text>
                </g>
              );
            })}
          {pending ? <circle cx={g.x(pending[0])} cy={g.y(pending[1])} r={5} className="fc-pending" /> : null}

          <text x={PAD.left} y={fullH - 8} className="fc-axis" textAnchor="start">
            {faDay.format(g.t0)}
          </text>
          <text x={w - PAD.right} y={fullH - 8} className="fc-axis" textAnchor="end">
            {faDay.format(g.t1)}
          </text>
          {tip ? (
            <g>
              <line x1={tip.px} x2={tip.px} y1={PAD.top} y2={fullH - PAD.bottom} className="fc-cross" />
              <circle cx={tip.px} cy={tip.py} r={3.5} className="fc-dot" />
            </g>
          ) : null}
        </svg>
      ) : null}
      {tip ? (
        <div
          className="fc-tip"
          dir="rtl"
          style={{
            [tip.px > w / 2 ? 'right' : 'left']: tip.px > w / 2 ? w - tip.px + 8 : tip.px + 8,
          }}
        >
          <b>{faDayYear.format(tip.t)}</b>
          {tip.kind === 'past' ? (
            <span className="num">{fmt(tip.v)}</span>
          ) : (
            <>
              <span>
                میانه: <span className="num">{fmt(tip.c.p50)}</span>
              </span>
              <span>
                ۵۰٪: <span className="num">{fmt(tip.c.p25)}</span> تا <span className="num">{fmt(tip.c.p75)}</span>
              </span>
              <span>
                ۹۰٪: <span className="num">{fmt(tip.c.p5)}</span> تا <span className="num">{fmt(tip.c.p95)}</span>
              </span>
            </>
          )}
        </div>
      ) : null}
      {tool === 'trend' ? (
        <p className="fc-hint" dir="rtl">
          {pending ? 'نقطه دوم خط را لمس کنید.' : 'نقطه اول خط روند را لمس کنید.'}
        </p>
      ) : tool === 'buy' || tool === 'sell' ? (
        <p className="fc-hint" dir="rtl">
          جای {tool === 'buy' ? 'خرید' : 'فروش'} را روی نمودار لمس کنید (زمان و قیمت).
        </p>
      ) : tool === 'erase' ? (
        <p className="fc-hint" dir="rtl">
          خط یا نقطه‌ای را که می‌خواهید پاک شود لمس کنید.
        </p>
      ) : null}
    </div>
  );
}
