'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { FORECAST_ASSETS, FORECAST_HORIZONS, type Calibration } from '@/lib/forecast-meta';
import { fmtPct, fmtPrice } from '@/lib/num';
import type { HorizonKey, ScenarioRow } from '@/lib/types';
import type { ConeT } from './ForecastChart';
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
  drivers: string[];
  reconstructed?: boolean;
  /** 'ensemble' for rial assets (engine + past moves + similar patterns), else the scenario engine */
  method?: 'ensemble' | 'engine';
  /** chance the price ends the horizon higher than today */
  pUp?: number | null;
  ensemble?: {
    parts: Record<'engine' | 'empirical' | 'analog', { lowPct: number; midPct: number; highPct: number; pUp: number }>;
    analog: { n: number; matches: { date: string; movePct: number }[] };
    empiricalN: number;
    since: string;
  } | null;
}

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
export default function ForecastPanel({ asset, horizon, onChange }: { asset: string; horizon: string; onChange: (asset: string, horizon: string) => void }) {
  const [data, setData] = useState<ForecastData | null>(null);
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

  return (
    <>
      <FilterBar>
        <Chips label="دارایی" value={asset} onChange={(a) => onChange(a, horizon)} options={ASSET_OPTS} />
        <Chips label="افق پیش‌بینی" value={horizon} onChange={(h) => onChange(asset, h)} options={H_OPTS} />
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
          <ForecastChart history={shown.history} cone={shown.cone} fmt={fmt} />
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
          </ul>
        ) : null}

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
