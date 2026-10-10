'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { addMark, addTrend, DRAW_KEY, emptyDrawing, normalizeDrawings, readouts, removeItem, type Drawing, type Drawings, type Readout } from '@/lib/forecast-draw';
import { FORECAST_ASSETS, FORECAST_HORIZONS, type Calibration } from '@/lib/forecast-meta';
import { computeIndicators, type IndicatorKey } from '@/lib/indicators';
import { fmtPct, fmtPrice } from '@/lib/num';
import type { HorizonKey, ScenarioRow } from '@/lib/types';
import type { ConeT, DrawTool } from './ForecastChart';
import IndicatorChips from './IndicatorChips';
import ForecastWhy from './ForecastWhy';
import type { AnalogPath, TrendFacts } from '@/lib/engine/forecast-why';
import { fmtDateFa } from './finance/kit';
import { Chips, FilterBar } from './ui';

const ForecastChart = dynamic(() => import('./ForecastChart'), {
  ssr: false,
  loading: () => <div className="chart-host skeleton" />,
});

export interface ForecastData {
  asset: string;
  label: string;
  unit: 'toman' | 'usd' | 'point';
  horizon: { key: HorizonKey; label: string; days: number };
  anchor: number;
  history: [number, number][];
  cone: (ConeT & { day: number })[];
  row: ScenarioRow | null;
  calibration: Calibration | null;
  annualVolPct: number | null;
  /** the trend the cone rests on, for «چرا این پیش‌بینی؟» */
  trend?: TrendFacts | null;
  drivers: string[];
  reconstructed?: boolean;
  /** 'ensemble' for rial assets (engine + past moves + similar patterns), else the scenario engine */
  method?: 'ensemble' | 'engine';
  /** chance the price ends the horizon higher than today */
  pUp?: number | null;
  /** daily rows before `history`, for indicator warm-up */
  warmup?: [number, number][];
  /** «when to buy, when to sell» within the horizon (lib/engine/forecast-timing.ts), in price */
  timing?: Timing | null;
  ensemble?: {
    parts: Record<'engine' | 'empirical' | 'analog', { lowPct: number; midPct: number; highPct: number; pUp: number }>;
    analog: { n: number; matches: { date: string; movePct: number }[]; paths?: AnalogPath[] };
    empiricalN: number;
    since: string;
  } | null;
}

export interface PlanRecord {
  n: number;
  periods: number;
  from: string;
  to: string;
  buyVsNowPct: number;
  buyBetterPct: number;
  buyFilledPct: number;
  sellVsNowPct: number;
  sellVsEndPct: number;
  sellFilledPct: number;
  fill: number;
  lowDayErr: number;
  lowDayErrNaive: number;
}
export interface Timing {
  fill: number;
  buy: number;
  buyPct: number;
  sell: number;
  sellPct: number;
  low: [number, number, number];
  lowPct: [number, number, number];
  lowDay: number;
  high: [number, number, number];
  highPct: [number, number, number];
  highDay: number;
  pDip: number;
  n: { empirical: number; analog: number };
  record: PlanRecord | null;
}

const TOOLS: { key: DrawTool; label: string }[] = [
  { key: 'none', label: 'فقط دیدن' },
  { key: 'trend', label: 'خط روند' },
  { key: 'buy', label: 'نقطه خرید' },
  { key: 'sell', label: 'نقطه فروش' },
  { key: 'erase', label: 'پاک‌کن' },
];
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** a probability read off the cone: beyond its 90% band it only knows «under 5%» / «over 95%» */
const probFa = (p: number) => (p < 0.05 ? 'کمتر از ۵٪' : p > 0.95 ? 'بیشتر از ۹۵٪' : `${Math.round(p * 100).toLocaleString('fa-IR')}٪`);
const dayFa = (ms: number) => fmtDateFa(new Date(ms + 3.5 * 3600_000).toISOString().slice(0, 10));
const daysFa = (d: number) => `${Math.round(d).toLocaleString('fa-IR')} روز`;

const PART_LABEL = { engine: 'موتور سناریو', empirical: 'حرکت‌های گذشته', analog: 'الگوهای مشابه' } as const;

const UNIT: Record<string, string> = {
  toman: 'تومان',
  usd: 'دلار',
  point: 'واحد',
};
const ASSET_OPTS = FORECAST_ASSETS.map((a) => ({
  key: a.key as string,
  label: a.label,
}));
const H_OPTS = FORECAST_HORIZONS.map((h) => ({
  key: h.key as string,
  label: h.label,
}));
const pctFa = (v: number) => `${Math.round(v).toLocaleString('fa-IR')}٪`;

/** Weekly / monthly / 3-month / 1-year forecast cones, each with its own past track record. */
export default function ForecastPanel({
  asset,
  horizon,
  onChange,
  ind = [],
  onInd,
}: {
  asset: string;
  horizon: string;
  onChange: (asset: string, horizon: string) => void;
  ind?: IndicatorKey[];
  onInd?: (v: IndicatorKey[]) => void;
}) {
  const [data, setData] = useState<ForecastData | null>(null);
  const [tool, setTool] = useState<DrawTool>('none');
  const [showPlan, setShowPlan] = useState(true);
  const [drawings, setDrawings] = useState<Drawings>({});
  useEffect(() => {
    try {
      setDrawings(normalizeDrawings(JSON.parse(localStorage.getItem(DRAW_KEY) ?? '{}')));
    } catch {
      // storage blocked or corrupt: draw without remembering
    }
  }, []);
  const editDrawing = (fn: (d: Drawing) => Drawing) =>
    setDrawings((all) => {
      const next = { ...all, [asset]: fn(all[asset] ?? emptyDrawing()) };
      try {
        localStorage.setItem(DRAW_KEY, JSON.stringify(next));
      } catch {
        // not remembered, still shown
      }
      return next;
    });
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [err, setErr] = useState('');

  useEffect(() => {
    const ctrl = new AbortController();
    setState('loading');
    fetch(api(`/api/forecast?asset=${encodeURIComponent(asset)}&h=${horizon}`), { signal: ctrl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        setData(j);
        setState('ok');
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setErr(e instanceof Error ? e.message : String(e));
        setState('error');
      });
    return () => ctrl.abort();
  }, [asset, horizon]);

  const shown = data && data.asset === asset && data.horizon.key === horizon ? data : null;
  const row = shown?.row;
  const unit = shown ? UNIT[shown.unit] : '';
  const decimals = shown ? (shown.anchor < 10 ? 4 : shown.unit === 'usd' && shown.anchor < 1000 ? 2 : 0) : 0;
  const fmt = (v: number) => (decimals ? v.toLocaleString('fa-IR', { maximumFractionDigits: decimals }) : fmtPrice(v));
  const cal = shown?.calibration;
  const hLabel = FORECAST_HORIZONS.find((h) => h.key === horizon)?.label ?? '';
  const inner = shown?.cone[shown.cone.length - 1];
  const lines = useMemo(() => (shown && ind.length ? computeIndicators(shown.history, shown.warmup ?? [], ind) : null), [shown, ind]);
  const drawing = drawings[asset] ?? null;
  const said = useMemo<Readout[]>(() => (shown && drawing ? readouts(drawing, shown.cone, shown.history, shown.anchor) : []), [shown, drawing]);
  const tm = shown?.timing;
  const plan = tm && showPlan ? { buy: tm.buy, sell: tm.sell, lowDay: tm.lowDay, low: tm.low[1], highDay: tm.highDay, high: tm.high[1] } : null;

  return (
    <>
      <FilterBar>
        <Chips label="دارایی" value={asset} onChange={(a) => onChange(a, horizon)} options={ASSET_OPTS} />
        <Chips label="افق پیش‌بینی" value={horizon} onChange={(h) => onChange(asset, h)} options={H_OPTS} />
        {onInd ? <IndicatorChips value={ind} onChange={onInd} /> : null}
      </FilterBar>

      <section className="panel chart-panel fc-panel" aria-busy={state === 'loading'} aria-labelledby="fc-h">
        <header className="chart-head">
          <div>
            <h2 id="fc-h">
              پیش‌بینی {hLabel} {FORECAST_ASSETS.find((a) => a.key === asset)?.label}
            </h2>
            {shown ? (
              <p className="chart-last">
                <span className="num">{fmt(shown.anchor)}</span> <small>{unit} · امروز</small>
              </p>
            ) : null}
          </div>
          {row && inner ? (
            <dl className="chart-stats fc-stats">
              {typeof shown?.pUp === 'number' ? (
                <div>
                  <dt>احتمال بالاتر بودن، {row.label} بعد</dt>
                  <dd className={shown.pUp >= 0.5 ? 'up' : 'down'}>{pctFa(shown.pUp * 100)}</dd>
                </div>
              ) : null}
              <div>
                <dt>میانه، {row.label} بعد</dt>
                <dd>
                  <span className="num">{fmt(row.base)}</span> <small className={`num ${row.basePct >= 0 ? 'up' : 'down'}`}>({fmtPct(row.basePct, 1)})</small>
                </dd>
              </div>
              <div>
                <dt>محدوده ۵۰٪ محتمل</dt>
                <dd>
                  <span className="num">{fmt(inner.p25)}</span> تا <span className="num">{fmt(inner.p75)}</span>
                </dd>
              </div>
              <div>
                <dt>محدوده ۹۰٪ محتمل</dt>
                <dd>
                  <span className="num">{fmt(row.worst)}</span> تا <span className="num">{fmt(row.best)}</span>
                  <small className="muted">
                    {' '}
                    (<span className="num">{fmtPct(row.worstPct, 0)}</span> تا <span className="num">{fmtPct(row.bestPct, 0)}</span>)
                  </small>
                </dd>
              </div>
            </dl>
          ) : null}
        </header>

        {state === 'error' ? (
          <p className="empty">
            {/^HTTP|fetch|network|load failed/i.test(err)
              ? 'پیش‌بینی از سرور نرسید (اتصال اینترنت یا سرور). چند دقیقه بعد دوباره امتحان کنید.'
              : `${err.replace(/[.。]\s*$/, '')}. دارایی دیگری را انتخاب کنید.`}
          </p>
        ) : shown && shown.cone.length >= 2 ? (
          <>
            <div className="chips fc-tools" role="group" aria-label="ابزار رسم">
              {TOOLS.map((t) => (
                <button key={t.key} aria-pressed={tool === t.key} onClick={() => setTool(t.key)}>
                  {t.label}
                </button>
              ))}
              {drawing && (drawing.trends.length || drawing.marks.length) ? (
                <button className="ghost" onClick={() => (editDrawing(() => emptyDrawing()), setTool('none'))}>
                  پاک کردن همه
                </button>
              ) : null}
              {tm ? (
                <button aria-pressed={showPlan} onClick={() => setShowPlan((x) => !x)}>
                  نقاط خرید و فروش موتور
                </button>
              ) : null}
            </div>
            <ForecastChart
              history={shown.history}
              cone={shown.cone}
              fmt={fmt}
              lines={lines}
              plan={plan}
              drawing={drawing}
              tool={tool}
              onAddTrend={(a, b) => editDrawing((d) => addTrend(d, a, b, newId()))}
              onAddMark={(k, at) => editDrawing((d) => addMark(d, k, at, newId()))}
              onRemove={(id) => editDrawing((d) => removeItem(d, id))}
            />
          </>
        ) : state === 'loading' || !shown ? (
          <div className="chart-host skeleton" />
        ) : (
          <p className="empty">برای این دارایی و افق پیش‌بینی ساخته نشد.</p>
        )}

        {state !== 'error' ? (
          <ul className="fc-legend" aria-label="راهنمای نمودار">
            <li>
              <i className="fc-sw fc-sw-hist" /> قیمت گذشته
            </li>
            <li>
              <i className="fc-sw fc-sw-median" /> میانه پیش‌بینی
            </li>
            <li>
              <i className="fc-sw fc-sw-inner" /> ۵۰٪ محتمل
            </li>
            <li>
              <i className="fc-sw fc-sw-outer" /> ۹۰٪ محتمل
            </li>
            {plan ? (
              <>
                <li>
                  <i className="fc-sw fc-sw-buy" /> خرید محدود موتور
                </li>
                <li>
                  <i className="fc-sw fc-sw-sell" /> هدف فروش موتور
                </li>
                <li>
                  <i className="fc-sw fc-sw-low" /> کف معمول
                </li>
                <li>
                  <i className="fc-sw fc-sw-high" /> سقف معمول
                </li>
              </>
            ) : null}
          </ul>
        ) : null}

        {shown && state !== 'error' && said.length ? (
          <div className="fc-readouts" data-testid="fc-readouts">
            <h3>رسم شما در برابر پیش‌بینی</h3>
            <ul className="notes">
              {said.map((r) => (
                <li key={r.id}>{readoutText(r, fmt, unit)}</li>
              ))}
            </ul>
            <p className="muted small">
              احتمال‌ها از همین مخروط پیش‌بینی خوانده شده‌اند (قیمت در همان روز، نه «تا آن روز»)؛ بیرون از محدوده ۹۰٪ فقط «کمتر از ۵٪» یا «بیشتر از ۹۵٪» گفته می‌شود. رسم‌ها فقط روی همین دستگاه
              می‌مانند.
            </p>
          </div>
        ) : null}

        {tm && state !== 'error' ? <TimingBox t={tm} fmt={fmt} unit={unit} hLabel={hLabel} /> : null}

        {shown && state !== 'error' ? (
          <div className="fc-notes">
            {cal ? (
              <p className={`fc-cal ${cal.insidePct < 80 ? 'warn' : ''}`}>
                <b>کارنامه همین روش:</b> {cal.n.toLocaleString('fa-IR')} پیش‌بینی {hLabel} در گذشته ({fmtDateFa(cal.from)} تا {fmtDateFa(cal.to)}) — هر بار فقط با قیمت‌های تا همان روز — قیمت واقعی در{' '}
                <b>{pctFa(cal.insidePct)}</b> مواقع داخل محدوده ۹۰٪ ماند، {pctFa(cal.abovePct)} بالاتر و {pctFa(cal.belowPct)} پایین‌تر رفت. خطای معمول میانه:{' '}
                {cal.medianErrPct.toLocaleString('fa-IR', {
                  maximumFractionDigits: 1,
                })}
                ٪.
                {cal.insidePct < 80 ? ' یعنی برای این دارایی محدوده از واقعیت باریک‌تر بوده؛ حرکت بیرون از آن را دور از ذهن ندانید.' : ''}
                {cal.abovePct >= cal.belowPct + 10 ? ' بیشتر خطاها رو به بالا بوده (جهش‌های ارزی).' : ''}
              </p>
            ) : (
              <p className="fc-cal muted">تاریخچه این دارایی برای سنجیدن کارنامه این افق کافی نیست.</p>
            )}
            <ForecastWhy data={shown} hLabel={hLabel} />
            {shown.ensemble ? (
              <div className="fc-ens">
                <h3>سه نگاه به {hLabel === 'هفتگی' ? 'هفته' : hLabel === 'ماهانه' ? 'ماه' : hLabel === '۳ ماهه' ? 'سه ماه' : 'سال'} آینده</h3>
                <p className="muted small">
                  مثل یک معامله‌گر که قبل از تصمیم چند نگاه را کنار هم می‌گذارد: «موتور سناریو» از نوسان و روند ۱۵ ماه اخیر، «حرکت‌های گذشته» از همه حرکت‌های واقعی هم‌اندازه در ۸ سال اخیر، و «الگوهای مشابه» از
                  روزهایی که شکل قیمت شبیه امروز بود. هر کدام به‌تنهایی گاهی خطا می‌کند؛ میانگین این سه روی داده واقعی ۱۳۹۵ تا ۱۴۰۵ (دلار، سکه، طلا) در همه افق‌ها از موتور سناریو به‌تنهایی دقیق‌تر بوده و همین ترکیب در
                  نمودار بالاست.
                </p>
                <div className="table-scroll">
                  <table className="t fc-ens-t">
                    <thead>
                      <tr>
                        <th scope="col">روش</th>
                        <th scope="col">میانه</th>
                        <th scope="col">محدوده ۹۰٪</th>
                        <th scope="col">احتمال بالاتر</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(['engine', 'empirical', 'analog'] as const).map((k) => {
                        const x = shown.ensemble!.parts[k];
                        return (
                          <tr key={k}>
                            <th scope="row">{PART_LABEL[k]}</th>
                            <td className={`num ${x.midPct >= 0 ? 'up' : 'down'}`}>{fmtPct(x.midPct, 0)}</td>
                            <td className="num">
                              {fmtPct(x.lowPct, 0)} تا {fmtPct(x.highPct, 0)}
                            </td>
                            <td className="num">{pctFa(x.pUp * 100)}</td>
                          </tr>
                        );
                      })}
                      {row ? (
                        <tr className="fc-ens-sum">
                          <th scope="row">ترکیب (نمودار بالا)</th>
                          <td className={`num ${row.basePct >= 0 ? 'up' : 'down'}`}>{fmtPct(row.basePct, 0)}</td>
                          <td className="num">
                            {fmtPct(row.worstPct, 0)} تا {fmtPct(row.bestPct, 0)}
                          </td>
                          <td className="num">{typeof shown.pUp === 'number' ? pctFa(shown.pUp * 100) : '—'}</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                {shown.ensemble.analog.matches.length ? (
                  <>
                    <h4>روزهایی از گذشته که الگوی قیمت شبیه امروز بود</h4>
                    <p className="muted small">
                      بازده یک هفته تا یک سال اخیر، نوسان و فاصله از میانگین ۲۰۰ روزه — {shown.ensemble.analog.n.toLocaleString('fa-IR')} روز مشابه‌تر از تاریخچه پیدا شد. نزدیک‌ترین‌ها و این‌که {hLabel === 'هفتگی' ? 'یک هفته' : row?.label}{' '}
                      بعدشان چه شد:
                    </p>
                    <ul className="fc-matches">
                      {shown.ensemble.analog.matches.map((m) => (
                        <li key={m.date}>
                          <span>{fmtDateFa(m.date)}</span>
                          <b className={`num ${m.movePct >= 0 ? 'up' : 'down'}`}>{fmtPct(m.movePct, 0)}</b>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}
            {shown.drivers.length ? (
              <ul className="notes">
                {shown.drivers.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : null}
            <p className="note">
              این نمودار نمی‌گوید قیمت کجا می‌رود؛ محدوده‌ای را نشان می‌دهد که با رفتار گذشته همین دارایی محتمل است (
              {shown.method === 'ensemble' ? 'ترکیب سه نگاه بالا' : (
                <>
                  همان موتور <Link href="/scenarios">سناریوها</Link>
                </>
              )}
              ). الگوی شبیه، تکرار همان اتفاق را تضمین نمی‌کند و خبر سیاسی یا جهش ارزی می‌تواند قیمت را بیرون محدوده ببرد. وعده سود نیست.
              {shown.reconstructed ? ' بخشی از تاریخچه این دارایی بازسازی‌شده است، نه قیمت ثبت‌شده.' : ''}
            </p>
          </div>
        ) : null}
      </section>
    </>
  );
}

function readoutText(r: Readout, fmt: (v: number) => string, unit: string): React.ReactNode {
  if (r.kind === 'trend')
    return (
      <>
        خط روند شما (شیب <span className="num">{fmtPct(r.slopePctPerMonth, 1)}</span> در ماه) در پایان افق ({dayFa(r.endT)}) به <span className="num">{fmt(r.endPrice)}</span> {unit} می‌رسد؛ احتمال
        این‌که قیمت بالاتر از خط شما تمام شود: <b>{probFa(r.pAbove)}</b>.
      </>
    );
  if (r.kind === 'pair')
    return (
      <>
        از خرید <span className="num">{fmt(r.buy.at[1])}</span> ({dayFa(r.buy.at[0])}) تا فروش <span className="num">{fmt(r.sell.at[1])}</span> ({dayFa(r.sell.at[0])}): بازده{' '}
        <b className={`num ${r.returnPct >= 0 ? 'up' : 'down'}`}>{fmtPct(r.returnPct, 1)}</b> پیش از کارمزد و اختلاف خرید و فروش.
      </>
    );
  const what = r.kind === 'buy' ? 'خرید' : 'فروش';
  if (r.future)
    return (
      <>
        {what} در <span className="num">{fmt(r.price)}</span> ({dayFa(r.t)}، <span className="num">{fmtPct(r.vsTodayPct, 1)}</span> نسبت به امروز): احتمال این‌که قیمت آن روز{' '}
        {r.kind === 'buy' ? 'همین یا ارزان‌تر' : 'همین یا گران‌تر'} باشد: <b>{probFa(r.p)}</b>.
      </>
    );
  return (
    <>
      {what} در <span className="num">{fmt(r.price)}</span> ({dayFa(r.t)}، گذشته): قیمت واقعی آن روز <span className="num">{fmt(r.actual)}</span> بود (
      <span className="num">{fmtPct(r.vsActualPct, 1)}</span> فاصله).
    </>
  );
}

/** «When to buy, when to sell» as the engine reads it — with what following it really did before. */
function TimingBox({ t, fmt, unit, hLabel }: { t: Timing; fmt: (v: number) => string; unit: string; hLabel: string }) {
  const r = t.record;
  const fill = `${Math.round(t.fill * 100).toLocaleString('fa-IR')}٪`;
  return (
    <div className="fc-timing" data-testid="fc-timing">
      <h3>زمان خرید و فروش از نگاه موتور</h3>
      <p>
        در دوره‌های {hLabel} گذشته‌ای که شبیه امروز بودند (همه دوره‌های ۸ سال اخیر و {t.n.analog.toLocaleString('fa-IR')} دوره با الگوی مشابه)، <b>پایین‌ترین قیمت</b> معمولاً حدود{' '}
        <b>{daysFa(t.lowDay)}</b> بعد آمد، حدود <span className="num">{fmt(t.low[1])}</span> {unit} (<span className="num">{fmtPct(t.lowPct[1], 1)}</span>؛ نیمی از موارد بین{' '}
        <span className="num">{fmtPct(t.lowPct[0], 1)}</span> و <span className="num">{fmtPct(t.lowPct[2], 1)}</span>). <b>بالاترین قیمت</b> معمولاً حدود <b>{daysFa(t.highDay)}</b> بعد، حدود{' '}
        <span className="num">{fmt(t.high[1])}</span> (<span className="num">{fmtPct(t.highPct[1], 1)}</span>). احتمال این‌که قیمت در این مدت اصلاً زیر قیمت امروز برود:{' '}
        <b>{Math.round(t.pDip * 100).toLocaleString('fa-IR')}٪</b>.
      </p>
      <dl className="fc-plan-kpis">
        <div>
          <dt>خرید محدود</dt>
          <dd>
            <span className="num">{fmt(t.buy)}</span> <small className="num">({fmtPct(t.buyPct, 1)})</small>
          </dd>
          <dd className="muted small">در {fill} دوره‌های مشابه قیمت به آن رسید</dd>
        </div>
        <div>
          <dt>هدف فروش</dt>
          <dd>
            <span className="num">{fmt(t.sell)}</span> <small className="num">({fmtPct(t.sellPct, 1)})</small>
          </dd>
          <dd className="muted small">در {fill} دوره‌های مشابه قیمت به آن رسید</dd>
        </div>
      </dl>
      {r ? (
        <p className={`fc-cal ${r.buyVsNowPct > 0 || r.sellVsEndPct < 0 ? 'warn' : ''}`} data-testid="fc-plan-record">
          <b>کارنامه این برنامه:</b> {r.n.toLocaleString('fa-IR')} بار در گذشته ({fmtDateFa(r.from)} تا {fmtDateFa(r.to)})، هر بار فقط با قیمت‌های تا همان روز. خرید با سفارش محدود — و اگر قیمت به آن
          نمی‌رسید، خرید در پایان دوره — در {Math.round(r.buyBetterPct).toLocaleString('fa-IR')}٪ مواقع ارزان‌تر از خرید همان روز بود، ولی{' '}
          <b>میانگین قیمت خرید {r.buyVsNowPct >= 0 ? 'گران‌تر' : 'ارزان‌تر'}</b> (<span className="num">{fmtPct(r.buyVsNowPct, 1)}</span>) بود؛ چون وقتی قیمت پایین نمی‌آمد، بالا می‌رفت. فروش در هدف
          به‌جای نگه‌داشتن تا پایان دوره، میانگین {Math.abs(r.sellVsEndPct).toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪ {r.sellVsEndPct < 0 ? 'کمتر' : 'بیشتر'} گرفت. سفارش‌ها در{' '}
          {Math.round(r.buyFilledPct).toLocaleString('fa-IR')}٪ (خرید) و {Math.round(r.sellFilledPct).toLocaleString('fa-IR')}٪ (فروش) مواقع پر شدند. روزِ کف را به‌طور معمول {daysFa(r.lowDayErr)}{' '}
          اشتباه گفت؛ حدس ساده (میانه همه دوره‌ها) {daysFa(r.lowDayErrNaive)}.
        </p>
      ) : (
        <p className="fc-cal muted">تاریخچه این دارایی برای سنجیدن کارنامه این برنامه کافی نیست.</p>
      )}
      <p className="muted small">
        روی داده واقعی ۸ دارایی (دلار، تتر، سکه‌ها، طلا، انس، بیت‌کوین) و ۴ افق، از ۱۳۹۵ تا ۱۴۰۵: منتظر کف ماندن با سفارش محدود در <b>هیچ</b> ترکیبی از خرید همان روز ارزان‌تر تمام نشد (میانگین ۷ تا
        ۱۲٪ گران‌تر)، و فروش در هدف در هیچ ترکیبی از نگه‌داشتن تا پایان دوره بهتر نبود. این خطوط می‌گویند قیمت در دوره‌های مشابه کجا رفت و آمد، نه این‌که کی بخرید یا بفروشید. وعده سود نیست.
      </p>
    </div>
  );
}
