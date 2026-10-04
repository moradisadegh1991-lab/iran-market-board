'use client';
import { useEffect, useRef, useState } from 'react';
import { chartSummary, type Reply } from '@/lib/assistant/ask';
import { api } from '@/lib/api';

type Spec = NonNullable<Reply['chart']>;
interface Data {
  points: [number, number][];
  stats: { first: number; last: number; changePct: number; high: number; low: number } | null;
}

const W = 320;
const H = 150;
const PAD = { l: 8, r: 8, t: 16, b: 34 };
const fa = (v: number, unit: Spec['unit']) => v.toLocaleString('fa-IR', { maximumFractionDigits: unit === 'toman' || v >= 100 ? 0 : 2 });
const day = (ms: number, intraday: boolean) =>
  new Date(ms).toLocaleString('fa-IR', intraday ? { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' } : { day: 'numeric', month: 'short', timeZone: 'Asia/Tehran' });

/**
 * The chart the assistant answers with: one line, the first and last price and the range's high/low,
 * and a crosshair with the day and price under the finger. Data from /api/chart (only the asset and the
 * range are sent); `onSummary` gets the sentence to say once it arrives.
 */
export default function AskChart({ spec, onSummary }: { spec: Spec; onSummary: (s: { text: string; speech: string }) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const said = useRef(onSummary);
  said.current = onSummary;

  useEffect(() => {
    let alive = true;
    fetch(api(`/api/chart?asset=${encodeURIComponent(spec.asset)}&tf=${spec.tf}`))
      .then((r) => r.json())
      .then((j: Data & { error?: string }) => {
        if (!alive) return;
        if (j.error || !Array.isArray(j.points)) throw new Error(j.error ?? 'bad');
        setData(j);
        said.current(chartSummary(spec, j.stats));
      })
      .catch(() => {
        if (alive) setErr('نمودار نرسید (اینترنت یا سرور). کمی بعد دوباره بپرسید.');
      });
    return () => {
      alive = false;
    };
  }, [spec]);

  if (err) return <p className="fin-err ask-chart-err">{err}</p>;
  if (!data) return <p className="muted small ask-chart-wait">در حال گرفتن نمودار…</p>;
  const pts = data.points.filter((p) => Number.isFinite(p[1]));
  if (pts.length < 2) return <p className="muted small">برای این بازه داده کافی نیست.</p>;

  const t0 = pts[0][0];
  const t1 = pts[pts.length - 1][0];
  const vs = pts.map((p) => p[1]);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = hi - lo || 1;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / span) * (H - PAD.t - PAD.b);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const intraday = spec.tf === '1d';
  const up = pts[pts.length - 1][1] >= pts[0][1];
  const hiI = vs.indexOf(hi);
  const loI = vs.indexOf(lo);
  const h = hover != null ? pts[hover] : null;

  function at(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * W;
    const t = t0 + ((fx - PAD.l) / (W - PAD.l - PAD.r)) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i][0] - t) < Math.abs(pts[best][0] - t)) best = i;
    setHover(best);
  }

  return (
    <figure className="ask-chart" data-testid="ask-chart">
      <div className="ask-chart-tip" aria-live="polite">
        {h ? (
          <>
            <b>{fa(h[1], spec.unit)}</b> <span className="muted">{day(h[0], intraday)}</span>
          </>
        ) : (
          <span className="muted">انگشت را روی نمودار بکشید</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        direction="ltr"
        aria-label={`${spec.label}: از ${fa(pts[0][1], spec.unit)} به ${fa(pts[pts.length - 1][1], spec.unit)}`}
        onPointerMove={at}
        onPointerDown={at}
        onPointerLeave={() => setHover(null)}
      >
        <line x1={PAD.l} x2={W - PAD.r} y1={y(hi)} y2={y(hi)} className="ask-grid" />
        <line x1={PAD.l} x2={W - PAD.r} y1={y(lo)} y2={y(lo)} className="ask-grid" />
        <path d={path} className={`ask-line ${up ? 'up' : 'down'}`} />
        <circle cx={x(pts[hiI][0])} cy={y(hi)} r={3} className="ask-dot" />
        <circle cx={x(pts[loI][0])} cy={y(lo)} r={3} className="ask-dot" />
        <text x={x(pts[hiI][0]) > W / 2 ? PAD.l : W - PAD.r} y={y(hi) - 5} className="ask-lbl" textAnchor={x(pts[hiI][0]) > W / 2 ? 'start' : 'end'}>
          بیشترین {fa(hi, spec.unit)}
        </text>
        <text x={x(pts[loI][0]) > W / 2 ? PAD.l : W - PAD.r} y={y(lo) + 13} className="ask-lbl" textAnchor={x(pts[loI][0]) > W / 2 ? 'start' : 'end'}>
          کمترین {fa(lo, spec.unit)}
        </text>
        <text x={PAD.l} y={H - 4} className="ask-lbl" textAnchor="start">
          {day(t0, intraday)}
        </text>
        <text x={W - PAD.r} y={H - 4} className="ask-lbl" textAnchor="end">
          {day(t1, intraday)}
        </text>
        {h ? (
          <g>
            <line x1={x(h[0])} x2={x(h[0])} y1={PAD.t - 6} y2={H - PAD.b} className="ask-cross" />
            <circle cx={x(h[0])} cy={y(h[1])} r={4.5} className={`ask-hover ${up ? 'up' : 'down'}`} />
          </g>
        ) : null}
      </svg>
    </figure>
  );
}
