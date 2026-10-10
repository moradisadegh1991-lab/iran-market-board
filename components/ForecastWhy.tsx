'use client';
// «چرا این پیش‌بینی؟» (rule 94): the reasons behind the forecast on the charts page, with figures —
//  ① where each of the three readings put the median and how wide its band is, next to the combination;
//  ② what the price did after the past days that looked like today, day by day;
//  ③ the last 45 days of price beside the daily push of the headlines, and the headlines themselves.
// Everything here describes; none of it changes the forecast's numbers (the news least of all — lib/engine/forecast-why.ts).
// Drawn as plain SVG at 360 units wide (one unit ≈ one phone pixel), time left to right.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Newspaper, TriangleAlert, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { forecastReasons, NEWS_EVIDENCE, PART_KEYS, PART_LABEL, type AnalogPath, type NewsView, type PartView, type Reason, type TrendFacts } from '@/lib/engine/forecast-why';
import { isoToJalali, JALALI_MONTHS } from '@/lib/jalali';
import type { ForecastData } from './ForecastPanel';

const W = 360;
const fa = (n: number, d = 0) => n.toLocaleString('fa-IR', { maximumFractionDigits: d, minimumFractionDigits: d });
const sgn = (n: number, d = 0) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fa(Math.abs(n), d)}٪`;
const shortDate = (iso: string) => {
  try {
    const j = isoToJalali(iso);
    return `${fa(j.jd)} ${JALALI_MONTHS[j.jm - 1]}`;
  } catch {
    return iso;
  }
};
const DAY = 86_400_000;

// ── the news, fetched on its own so a slow feed never holds the forecast back ──

interface NewsBody {
  view: NewsView | null;
  sources: string[];
  reviewed: number;
  chunks: { loaded: number; total: number };
  asOf: string;
  note?: string;
}
const newsCache = new Map<string, { at: number; body: NewsBody }>();
const NEWS_TTL = 10 * 60_000;

function useNews(asset: string): { state: 'loading' | 'ok' | 'error'; body: NewsBody | null; retry: () => void } {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [body, setBody] = useState<NewsBody | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const hit = newsCache.get(asset);
    if (hit && Date.now() - hit.at < NEWS_TTL && tick === 0) {
      setBody(hit.body);
      setState('ok');
      return;
    }
    const ctrl = new AbortController();
    setState('loading');
    fetch(api(`/api/forecast-news?asset=${encodeURIComponent(asset)}`), { signal: ctrl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        if (j.chunks?.loaded > 0 || !j.view) newsCache.set(asset, { at: Date.now(), body: j });
        setBody(j);
        setState('ok');
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setState('error');
      });
    return () => ctrl.abort();
  }, [asset, tick]);
  return { state, body, retry: () => setTick((t) => t + 1) };
}

// ── ① three readings and the combination ──

function Readings({ parts, mid, low, high }: { parts: Record<'engine' | 'empirical' | 'analog', PartView>; mid: number; low: number; high: number }) {
  const rows = [
    ...PART_KEYS.map((k) => ({ key: k as string, label: PART_LABEL[k], low: parts[k].lowPct, mid: parts[k].midPct, high: parts[k].highPct, main: false })),
    { key: 'all', label: 'ترکیب (همین پیش‌بینی)', low, mid, high, main: true },
  ];
  const vals = rows.flatMap((r) => [r.low, r.mid, r.high]).concat(0);
  const span = Math.max(...vals) - Math.min(...vals) || 1;
  const lo = Math.min(...vals) - span * 0.06;
  const hi = Math.max(...vals) + span * 0.06;
  const padL = 14;
  const padR = 14;
  const x = (v: number) => padL + ((v - lo) / (hi - lo)) * (W - padL - padR);
  const top = 24;
  const rowH = 54;
  const H = top + rows.length * rowH + 4;
  return (
    <svg className="fcw-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="میانه و محدوده ۹۰٪ هر نگاه در کنار ترکیب" data-testid="fcw-readings">
      <line x1={x(0)} x2={x(0)} y1={top - 10} y2={H - 4} className="fcw-axis" />
      <text x={x(0)} y={top - 14} textAnchor="middle" className="fcw-tick">
        امروز
      </text>
      {rows.map((r, i) => {
        const y = top + i * rowH;
        const cy = y + 30;
        const wide = x(r.high) - x(r.low) > 52;
        return (
          <g key={r.key} className={r.main ? 'fcw-main' : undefined}>
            <text x={W - padR} y={y + 12} textAnchor="end" className={r.main ? 'fcw-label fcw-label-main' : 'fcw-label'}>
              {r.label}
            </text>
            <line x1={x(r.low)} x2={x(r.high)} y1={cy} y2={cy} className="fcw-range" />
            <line x1={x(r.low)} x2={x(r.low)} y1={cy - 4} y2={cy + 4} className="fcw-range" />
            <line x1={x(r.high)} x2={x(r.high)} y1={cy - 4} y2={cy + 4} className="fcw-range" />
            <circle cx={x(r.mid)} cy={cy} r={5} className="fcw-dot" />
            <text x={x(r.mid)} y={cy - 10} textAnchor="middle" className="fcw-val">
              {sgn(r.mid)}
            </text>
            {wide ? (
              <>
                <text x={x(r.low)} y={cy + 18} textAnchor="middle" className="fcw-tick">
                  {sgn(r.low)}
                </text>
                <text x={x(r.high)} y={cy + 18} textAnchor="middle" className="fcw-tick">
                  {sgn(r.high)}
                </text>
              </>
            ) : null}
            <title>{`${r.label}: میانه ${sgn(r.mid)}، محدوده ۹۰٪ از ${sgn(r.low)} تا ${sgn(r.high)}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

// ── ② paths after the similar days ──

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function Paths({ paths, days, low, mid, high }: { paths: AnalogPath[]; days: number; low: number; mid: number; high: number }) {
  const full = paths.filter((p) => p.path.length === paths[0].path.length);
  const all = full.flatMap((p) => p.path.map((q) => q[1])).concat([0, low, high]);
  const span = Math.max(...all) - Math.min(...all) || 1;
  const lo = Math.min(...all) - span * 0.05;
  const hi = Math.max(...all) + span * 0.05;
  const padL = 40;
  const padR = 50;
  const padT = 10;
  const padB = 26;
  const H = 210;
  const x = (d: number) => padL + (d / days) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const line = (pts: [number, number][]) => pts.map(([d, v], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  const med: [number, number][] = full[0].path.map(([d], k) => [d, median(full.map((p) => p.path[k][1]))]);
  const ticks = [lo + span * 0.05, 0, hi - span * 0.05].filter((v, i, a) => i === 1 || Math.abs(y(v) - y(0)) > 16 || a.length === 0);
  return (
    <svg className="fcw-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="مسیر قیمت بعد از روزهای مشابه گذشته" data-testid="fcw-paths">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className={v === 0 ? 'fcw-axis' : 'fcw-grid'} />
          <text x={padL - 6} y={y(v) + 4} textAnchor="end" className="fcw-tick">
            {sgn(v)}
          </text>
        </g>
      ))}
      {/* numbers only: a label that mixes digits and Persian words reads in the wrong order inside a left-to-right figure */}
      {[0, days / 2, days].map((d) => (
        <text key={d} x={x(d)} y={H - 8} textAnchor={d === 0 ? 'start' : d === days ? 'end' : 'middle'} className="fcw-tick">
          {fa(d)}
        </text>
      ))}
      {full.map((p) => (
        <path key={p.date} d={line(p.path)} className={p.movePct >= 0 ? 'fcw-path fcw-path-up' : 'fcw-path fcw-path-down'}>
          <title>{`${shortDate(p.date)}: بعد از ${fa(days)} روز ${sgn(p.movePct, 1)}`}</title>
        </path>
      ))}
      <path d={line(med)} className="fcw-median" />
      {/* the combined forecast at the horizon: its 90% band and median, to hold against the paths */}
      <line x1={x(days) + 14} x2={x(days) + 14} y1={y(low)} y2={y(high)} className="fcw-fc" />
      <line x1={x(days) + 9} x2={x(days) + 19} y1={y(low)} y2={y(low)} className="fcw-fc" />
      <line x1={x(days) + 9} x2={x(days) + 19} y1={y(high)} y2={y(high)} className="fcw-fc" />
      <circle cx={x(days) + 14} cy={y(mid)} r={5} className="fcw-fc-dot" />
      <text x={x(days) + 22} y={y(mid) + 4} textAnchor="start" className="fcw-val">
        {sgn(mid)}
      </text>
    </svg>
  );
}

// ── ③ price beside the daily push of the headlines ──

function NewsChart({ view, history }: { view: NewsView; history: [number, number][] }) {
  const n = view.daily.length;
  const t0 = Date.parse(`${view.from}T12:00:00Z`);
  const t1 = Date.parse(`${view.to}T12:00:00Z`);
  const pts = history.filter(([t]) => t >= t0 - DAY && t <= t1 + DAY);
  const base = pts[0]?.[1];
  const padL = 40;
  const padR = 10;
  const plotW = W - padL - padR;
  const x = (i: number) => padL + (i / (n - 1)) * plotW;
  const xt = (t: number) => padL + Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1))) * plotW;
  const pctSeries = base ? pts.map(([t, p]) => [t, (p / base - 1) * 100] as [number, number]) : [];
  const pMin = Math.min(0, ...pctSeries.map((p) => p[1]));
  const pMax = Math.max(0, ...pctSeries.map((p) => p[1]));
  const pSpan = pMax - pMin || 1;
  const topH = 104;
  const yP = (v: number) => 10 + (1 - (v - (pMin - pSpan * 0.06)) / (pSpan * 1.12)) * (topH - 10);
  const botTop = topH + 18;
  const botH = 58;
  const zero = botTop + botH / 2;
  const maxAbs = Math.max(1, ...view.daily.map((d) => Math.abs(d.score)));
  const barH = (s: number) => (Math.abs(s) / maxAbs) * (botH / 2 - 4);
  const H = botTop + botH + 22;
  const bw = Math.max(2, Math.min(7, (plotW / n) * 0.62));
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const at = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const u = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.min(n - 1, Math.max(0, Math.round(((u - padL) / plotW) * (n - 1)))));
  };
  const priceAt = (i: number) => {
    const t = t0 + (i / (n - 1)) * (t1 - t0);
    let best: [number, number] | null = null;
    for (const p of pctSeries) if (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
    return best && Math.abs(best[0] - t) <= 3 * DAY ? best[1] : null;
  };
  const h = hover === null ? null : { i: hover, d: view.daily[hover], p: priceAt(hover) };
  const tipX = h ? Math.min(W - 118, Math.max(padL, x(h.i) - 59)) : 0;
  return (
    <svg
      ref={ref}
      className="fcw-svg fcw-hover"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="قیمت ۴۵ روز اخیر و فشار روزانه خبرها"
      data-testid="fcw-news"
      onPointerMove={at}
      onPointerDown={at}
      onPointerLeave={() => setHover(null)}
    >
      {[pMin, 0, pMax].map((v, k) => (
        <g key={k}>
          <line x1={padL} x2={W - padR} y1={yP(v)} y2={yP(v)} className={v === 0 ? 'fcw-axis' : 'fcw-grid'} />
          <text x={padL - 6} y={yP(v) + 4} textAnchor="end" className="fcw-tick">
            {sgn(v, Math.abs(v) < 10 ? 1 : 0)}
          </text>
        </g>
      ))}
      {pctSeries.length > 1 ? (
        <path d={pctSeries.map(([t, v], i) => `${i ? 'L' : 'M'}${xt(t).toFixed(1)} ${yP(v).toFixed(1)}`).join('')} className="fcw-price" />
      ) : null}
      <line x1={padL} x2={W - padR} y1={zero} y2={zero} className="fcw-axis" />
      {view.daily.map((d, i) =>
        d.score ? (
          <rect
            key={d.date}
            x={x(i) - bw / 2}
            y={d.score > 0 ? zero - barH(d.score) : zero}
            width={bw}
            height={barH(d.score)}
            rx={d.score > 0 ? 0 : 0}
            className={d.score > 0 ? 'fcw-bar-up' : 'fcw-bar-down'}
          />
        ) : null,
      )}
      {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
        <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="fcw-tick">
          {shortDate(view.daily[i].date)}
        </text>
      ))}
      {h ? (
        <g pointerEvents="none">
          <line x1={x(h.i)} x2={x(h.i)} y1={8} y2={botTop + botH} className="fcw-cross" />
          <rect x={tipX} y={2} width={118} height={52} rx={6} className="fcw-tip" />
          <text x={tipX + 59} y={17} textAnchor="middle" className="fcw-tip-t">
            {shortDate(h.d.date)}
          </text>
          <text x={tipX + 110} y={33} textAnchor="end" className="fcw-tip-t">
            قیمت
          </text>
          <text x={tipX + 8} y={33} textAnchor="start" className="fcw-tip-t fcw-tip-v">
            {h.p === null ? '—' : sgn(h.p, 1)}
          </text>
          <text x={tipX + 110} y={48} textAnchor="end" className="fcw-tip-t">
            خبر
          </text>
          <text x={tipX + 8} y={48} textAnchor="start" className="fcw-tip-t fcw-tip-v">
            {h.d.score === 0 ? '۰' : `${h.d.score > 0 ? '+' : '−'}${fa(Math.abs(h.d.score), 1)}`}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

const TONE_ICON: Record<Reason['tone'], LucideIcon> = { up: TrendingUp, down: TrendingDown, flat: Minus, warn: TriangleAlert };

function ReasonList({ reasons, newsLoading }: { reasons: Reason[]; newsLoading: boolean }) {
  return (
    <ul className="fcw-reasons" aria-label="دلیل‌های این پیش‌بینی">
      {reasons.map((r) => {
        const I = r.id === 'news' ? Newspaper : TONE_ICON[r.tone];
        return (
          <li key={r.id} className={`fcw-r fcw-r-${r.tone}`} data-testid={`why-${r.id}`}>
            <span className="fcw-r-ic" aria-hidden="true">
              <I size={18} strokeWidth={1.9} />
            </span>
            <span>
              <b>{r.title}</b>
              {r.inNumbers ? null : <small className="fcw-tag">بیرون از عدد</small>}
              <span className="fcw-r-t">{r.text}</span>
            </span>
          </li>
        );
      })}
      {newsLoading ? (
        <li className="fcw-r fcw-r-flat" aria-busy="true">
          <span className="fcw-r-ic" aria-hidden="true">
            <Newspaper size={18} strokeWidth={1.9} />
          </span>
          <span className="muted">در حال خواندن خبرهای اخیر…</span>
        </li>
      ) : null}
    </ul>
  );
}

const isFa = (s: string) => /[؀-ۿ]/.test(s);

function Headlines({ view }: { view: NewsView }) {
  if (!view.headlines.length) return null;
  return (
    <ul className="fcw-news" data-testid="fcw-headlines">
      {view.headlines.map((h) => (
        <li key={`${h.date}-${h.title}`}>
          <span className={`fcw-eff ${h.effect > 0 ? 'up' : 'down'}`} aria-label={h.effect > 0 ? 'فشار صعودی' : 'فشار نزولی'}>
            {h.effect > 0 ? '▲' : '▼'} {fa(Math.abs(h.effect), 1)}
          </span>
          <span className="fcw-news-main">
            <a href={h.url} target="_blank" rel="noopener noreferrer" dir="auto" lang={isFa(h.title) ? 'fa' : 'en'}>
              {h.title}
            </a>
            <small>
              {shortDate(h.date)} <span aria-hidden="true">—</span> <bdi>{h.source}</bdi>
              {h.outlets > 1 ? ` و ${fa(h.outlets - 1)} رسانه دیگر` : ''}
            </small>
            <small>
              <b>{h.facts.join(' و ')}</b>
            </small>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function ForecastWhy({ data, hLabel }: { data: ForecastData; hLabel: string }) {
  const { state, body, retry } = useNews(data.asset);
  const view = body?.view ?? null;
  const ens = data.ensemble;
  const row = data.row;
  const paths = ens?.analog.paths;
  const reasons = useMemo(
    () =>
      row
        ? forecastReasons({
            hLabel,
            midPct: row.basePct,
            lowPct: row.worstPct,
            highPct: row.bestPct,
            pUp: data.pUp ?? null,
            parts: ens?.parts ?? null,
            analog: ens ? { n: ens.analog.n, matches: ens.analog.matches } : null,
            trend: (data.trend as TrendFacts | null | undefined) ?? null,
            annualVolPct: data.annualVolPct,
            news: view,
          })
        : [],
    [row, data.pUp, ens, data.trend, data.annualVolPct, hLabel, view],
  );
  if (!row) return null;
  return (
    <section className="fcw" aria-labelledby="fcw-h" data-testid="fc-why">
      <h3 id="fcw-h">چرا این پیش‌بینی؟</h3>
      <p className="muted small">دلیل‌ها با نمودار؛ همه‌شان توضیح همین عددند و فقط «سه نگاه» و روند و نوسان در ساختن عدد نقش دارند.</p>

      <ReasonList reasons={reasons} newsLoading={state === 'loading'} />

      {ens ? (
        <figure className="fcw-fig">
          <figcaption>
            <b>سه نگاه و ترکیبشان</b>
            <span className="muted small"> نقطه = میانه، خط = محدوده ۹۰٪ محتمل، درصد تغییر نسبت به قیمت امروز</span>
          </figcaption>
          <Readings parts={ens.parts} mid={row.basePct} low={row.worstPct} high={row.bestPct} />
        </figure>
      ) : null}

      {paths && paths.length >= 2 ? (
        <figure className="fcw-fig">
          <figcaption>
            <b>بعد از روزهای مشابه، قیمت چه کرد؟</b>
            <span className="muted small"> هر خط یکی از روزهای گذشته که الگوی قیمتش شبیه امروز بود؛ خط ضخیم میانه آن‌هاست و سمت راست، پیش‌بینی ترکیبی برای همین افق. محور افقی: روزهای بعد از آن روز (۰ = همان روز)، محور عمودی: درصد تغییر قیمت</span>
          </figcaption>
          <Paths paths={paths} days={data.horizon.days} low={row.worstPct} mid={row.basePct} high={row.bestPct} />
          <ul className="fc-legend fcw-legend" aria-label="راهنمای نمودار مسیرها">
            <li>
              <i className="fcw-sw fcw-sw-up" /> بالاتر تمام شد
            </li>
            <li>
              <i className="fcw-sw fcw-sw-down" /> پایین‌تر تمام شد
            </li>
            <li>
              <i className="fcw-sw fcw-sw-med" /> میانه نمونه‌ها
            </li>
            <li>
              <i className="fcw-sw fcw-sw-fc" /> پیش‌بینی ترکیبی
            </li>
          </ul>
        </figure>
      ) : null}

      <figure className="fcw-fig">
        <figcaption>
          <b>خبرها در کنار قیمت</b>
          <span className="muted small"> آخرین ۴۵ روز؛ فقط زمینه است و در عدد پیش‌بینی نیست. بالا: قیمت (درصد تغییر از ابتدای بازه)، پایین: فشار روزانه خبرها (ستون بالا = صعودی، پایین = نزولی)؛ انگشت یا ماوس را روی نمودار حرکت دهید</span>
        </figcaption>
        {state === 'loading' ? <div className="fcw-skel" aria-busy="true" /> : null}
        {state === 'error' ? (
          <p className="note" role="status">
            خبرها از سرور نرسید. <button className="fin-link" onClick={retry}>دوباره امتحان کنید</button>
          </p>
        ) : null}
        {state === 'ok' && view ? (
          <>
            <NewsChart view={view} history={data.history} />
            <ul className="fc-legend fcw-legend" aria-label="راهنمای نمودار خبر">
              <li>
                <i className="fcw-sw fcw-sw-price" /> قیمت
              </li>
              <li>
                <i className="fcw-sw fcw-sw-up" /> روز با فشار صعودی خبر
              </li>
              <li>
                <i className="fcw-sw fcw-sw-down" /> روز با فشار نزولی خبر
              </li>
            </ul>
            <Headlines view={view} />
            <p className="muted small" data-testid="fcw-news-meta">
              {view.count
                ? `${fa(view.count)} ماجرای مرتبط (هر ماجرا یک بار، حتی اگر چند رسانه نوشته باشند) از ${fa(body!.reviewed)} تیتر خوانده‌شده؛ هر خبر با واژه‌نامه همین اپ (همان که معامله‌گر برخط می‌خواند) امتیاز می‌گیرد و واقعیتی که از آن خوانده شده کنارش نوشته است.`
                : `در ۴۵ روز اخیر از ${fa(body!.reviewed)} تیتر خوانده‌شده، خبری با اثر روی این دارایی پیدا نشد.`}{' '}
              منبع: {body!.sources.length ? body!.sources.join('، ') : 'Google News'}؛ تیترها به زبان اصلی (بیشتر انگلیسی) آمده‌اند چون خبر فارسی از بیرون ایران باز نمی‌شود، پس خبر داخلی بازار در این بخش کم‌رنگ است.
            </p>
          </>
        ) : null}
        {state === 'ok' && !view ? <p className="note">برای این دارایی منبع خبری تعریف نشده است.</p> : null}
        <details className="fcw-why-no">
          <summary>چرا خبر در عدد پیش‌بینی نیست؟</summary>
          <p>{NEWS_EVIDENCE.text}</p>
        </details>
      </figure>
    </section>
  );
}
