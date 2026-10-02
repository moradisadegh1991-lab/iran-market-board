'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface ConeT {
  t: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

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

/** Past prices, then the forecast cone: 90% band, 50% band and the median, from today to the horizon. */
export default function ForecastChart({ history, cone, fmt }: { history: [number, number][]; cone: ConeT[]; fmt: (v: number) => string }) {
  const host = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [h, setH] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

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
    const span = hi - lo || hi * 0.01 || 1;
    lo -= span * 0.04;
    hi += span * 0.04;
    const iw = w - PAD.left - PAD.right;
    const ih = h - PAD.top - PAD.bottom;
    const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * iw;
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * ih;
    const path = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)},${y(b).toFixed(1)}`).join('');
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
    return {
      x,
      y,
      t0,
      t1,
      now: cone[0].t,
      ticks,
      hist: path(history),
      outer: band('p5', 'p95'),
      inner: band('p25', 'p75'),
      median: path(cone.map((c) => [c.t, c.p50])),
      iw,
    };
  }, [w, h, history, cone]);

  // the point under the finger: a past price, or the forecast range on that day
  const tip = useMemo(() => {
    if (!g || hover === null) return null;
    const t = g.t0 + ((hover - PAD.left) / g.iw) * (g.t1 - g.t0);
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
  }, [g, hover, history, cone]);

  const move = (e: React.PointerEvent) => {
    const r = host.current!.getBoundingClientRect();
    setHover(Math.min(Math.max(e.clientX - r.left, PAD.left), w - PAD.right));
  };

  return (
    <div
      ref={host}
      className="chart-host fc-host"
      dir="ltr"
      role="img"
      aria-label="نمودار پیش‌بینی قیمت: قیمت‌های گذشته و محدوده محتمل آینده"
      onPointerMove={move}
      onPointerDown={move}
      onPointerLeave={() => setHover(null)}
    >
      {g ? (
        <svg width={w} height={h}>
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
          <path d={g.hist} className="fc-hist" />
          <line x1={g.x(g.now)} x2={g.x(g.now)} y1={PAD.top - 8} y2={h - PAD.bottom} className="fc-today" />
          <text x={g.x(g.now)} y={PAD.top - 9} className="fc-axis fc-today-label" textAnchor="middle">
            امروز
          </text>
          <circle cx={g.x(g.now)} cy={g.y(cone[0].p50)} r={3.5} className="fc-dot" />
          <text x={PAD.left} y={h - 8} className="fc-axis" textAnchor="start">
            {faDay.format(g.t0)}
          </text>
          <text x={w - PAD.right} y={h - 8} className="fc-axis" textAnchor="end">
            {faDay.format(g.t1)}
          </text>
          {tip ? (
            <g>
              <line x1={tip.px} x2={tip.px} y1={PAD.top} y2={h - PAD.bottom} className="fc-cross" />
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
    </div>
  );
}
