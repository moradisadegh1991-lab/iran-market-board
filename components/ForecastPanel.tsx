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
}

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
            {err.replace(/[.。]\s*$/, '')}. {/^HTTP|fetch|network/i.test(err) ? 'اتصال برقرار نشد؛ چند دقیقه بعد دوباره امتحان کنید.' : 'دارایی دیگری را انتخاب کنید.'}
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
            {shown.drivers.length ? (
              <ul className="notes">
                {shown.drivers.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : null}
            <p className="note">
              این نمودار نمی‌گوید قیمت کجا می‌رود؛ محدوده‌ای را نشان می‌دهد که با نوسان و روند گذشته همین دارایی محتمل است (همان موتور <Link href="/scenarios">سناریوها</Link>). خبر سیاسی یا جهش ارزی
              می‌تواند قیمت را بیرون آن ببرد. وعده سود نیست.
              {shown.reconstructed ? ' بخشی از تاریخچه این دارایی بازسازی‌شده است، نه قیمت ثبت‌شده.' : ''}
            </p>
          </div>
        ) : null}
      </section>
    </>
  );
}
