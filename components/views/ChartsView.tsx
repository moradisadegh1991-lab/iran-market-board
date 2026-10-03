'use client';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { fmtPct, fmtPrice, isNum } from '@/lib/num';
import type { ChartData, Timeframe } from '@/lib/chart';
import { FORECAST_ASSETS, FORECAST_HORIZONS } from '@/lib/forecast-meta';
import { computeIndicators, IND_COLOR, indicatorEvidence, INDICATORS, readings, type IndicatorKey } from '@/lib/indicators';
import ForecastPanel from '../ForecastPanel';
import { useSnapshot } from '../SnapshotProvider';
import { Chips, FilterBar, PageHead } from '../ui';

const PriceChart = dynamic(() => import('../PriceChart'), { ssr: false, loading: () => <div className="chart-host skeleton" /> });

const TFS: { key: Timeframe; label: string }[] = [
  { key: '1d', label: 'روزانه' },
  { key: '1w', label: 'هفتگی' },
  { key: '1m', label: 'ماهانه' },
  { key: '3m', label: '۳ ماه' },
  { key: '6m', label: '۶ ماه' },
  { key: '1y', label: '۱ سال' },
];
const CORE = [
  { key: 'usd', label: 'دلار' },
  { key: 'usdt', label: 'تتر' },
  { key: 'g18', label: 'طلای ۱۸' },
  { key: 'coin', label: 'سکه' },
  { key: 'ons', label: 'انس جهانی' },
  { key: 'tse', label: 'شاخص بورس' },
  { key: 'btc', label: 'بیت‌کوین' },
  { key: 'eth', label: 'اتریوم' },
];
const UNIT: Record<string, string> = { toman: 'تومان', usd: 'دلار', point: 'واحد' };

type Mode = 'price' | 'forecast';
const isForecastAsset = (a: string | null) => FORECAST_ASSETS.some((x) => x.key === a);

export default function ChartsView() {
  const params = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'forecast' ? 'forecast' : 'price');
  const [fAsset, setFAsset] = useState(() => (isForecastAsset(params.get('asset')) ? params.get('asset')! : 'usd'));
  const [fH, setFH] = useState(() => (FORECAST_HORIZONS.some((h) => h.key === params.get('h')) ? params.get('h')! : 'm1'));
  const { snap } = useSnapshot();
  const alts = useMemo(() => (snap?.scenarios.assets ?? []).filter((a) => a.group === 'alt').map((a) => ({ key: `cg:${a.key.slice(4)}`, label: a.symbol ?? a.label })), [snap]);
  const assets = [...CORE, ...alts];
  const [asset, setAsset] = useState(params.get('asset') ?? 'usd');
  const [tf, setTf] = useState<Timeframe>((params.get('tf') as Timeframe) ?? '1m');
  const [ind, setInd] = useState<IndicatorKey[]>(() => (params.get('ind') ?? '').split(',').filter((k): k is IndicatorKey => INDICATORS.some((x) => x.key === k)));
  const [data, setData] = useState<ChartData | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (mode !== 'price') return;
    const ctrl = new AbortController();
    setState('loading');
    // warm=1: the daily history before the window, so a 200-day average exists from the first visible day
    fetch(api(`/api/chart?asset=${encodeURIComponent(asset)}&tf=${tf}&warm=1`), { signal: ctrl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        setData(j);
        setState('ok');
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setErr(e instanceof Error ? e.message : String(e));
        setState('error');
      });
    router.replace(`/charts?asset=${encodeURIComponent(asset)}&tf=${tf}${ind.length ? `&ind=${ind.join(',')}` : ''}`, { scroll: false });
    return () => ctrl.abort();
  }, [asset, tf, router, mode]);

  useEffect(() => {
    if (mode === 'price') router.replace(`/charts?asset=${encodeURIComponent(asset)}&tf=${tf}${ind.length ? `&ind=${ind.join(',')}` : ''}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ind]);

  const lines = useMemo(() => (data && ind.length && data.points.length >= 2 ? computeIndicators(data.points, data.warmup ?? [], ind) : null), [data, ind]);
  const said = useMemo(() => (data && lines ? readings(data.points, lines) : []), [data, lines]);
  const group = ['usd', 'usdt', 'g18', 'coin'].includes(asset) ? 'rial' : asset === 'btc' || asset === 'eth' || asset.startsWith('cg:') ? 'crypto' : 'other';

  useEffect(() => {
    if (mode === 'forecast') router.replace(`/charts?mode=forecast&asset=${encodeURIComponent(fAsset)}&h=${fH}`, { scroll: false });
  }, [mode, fAsset, fH, router]);

  const switchMode = (m: Mode) => {
    // carry the asset across when both sections have it
    if (m === 'forecast' && isForecastAsset(asset)) setFAsset(asset);
    if (m === 'price' && CORE.some((c) => c.key === fAsset)) setAsset(fAsset);
    setMode(m);
  };

  const label = assets.find((a) => a.key === asset)?.label ?? asset;
  const st = data?.stats;
  const decimals = data && st ? (st.last < 10 ? 4 : st.last < 1000 && data.unit === 'usd' ? 2 : 0) : 0;
  const scenario = snap?.scenarios.assets.find((a) => a.key === asset || `cg:${a.key.slice(4)}` === asset);

  return (
    <div className="wrap">
      <PageHead title="نمودار قیمت">
        {mode === 'price'
          ? 'دارایی و بازه زمانی را انتخاب کنید. روی نمودار انگشت یا نشانگر را حرکت دهید تا قیمت هر لحظه را ببینید.'
          : 'محدوده محتمل قیمت در هفته، ماه، سه ماه و سال آینده، با کارنامه همین روش در گذشته. روی نمودار انگشت بکشید تا محدوده هر روز را ببینید.'}
      </PageHead>
      <div className="seg chart-mode" role="group" aria-label="نوع نمودار">
        <button aria-pressed={mode === 'price'} onClick={() => switchMode('price')}>
          نمودار قیمت
        </button>
        <button aria-pressed={mode === 'forecast'} onClick={() => switchMode('forecast')}>
          پیش‌بینی
        </button>
      </div>
      {mode === 'forecast' ? (
        <ForecastPanel
          asset={fAsset}
          horizon={fH}
          onChange={(a, h) => {
            setFAsset(a);
            setFH(h);
          }}
        />
      ) : (
        <>
          <FilterBar>
            <Chips label="دارایی" value={asset} onChange={setAsset} options={assets} />
            <Chips label="بازه زمانی" value={tf} onChange={setTf} options={TFS} />
            <div className="chips ind-chips" role="group" aria-label="اندیکاتور">
              <span className="ind-chips-label">اندیکاتور:</span>
              {INDICATORS.map((o) => (
                <button key={o.key} aria-pressed={ind.includes(o.key)} onClick={() => setInd((x) => (x.includes(o.key) ? x.filter((k) => k !== o.key) : [...x, o.key]))}>
                  <i className="ind-sw" style={{ background: IND_COLOR[o.key] }} aria-hidden="true" />
                  {o.label}
                </button>
              ))}
            </div>
          </FilterBar>

          <section className="panel chart-panel" aria-busy={state === 'loading'}>
            <header className="chart-head">
              <div>
                <h2>{label}</h2>
                {st ? (
                  <p className="chart-last num">
                    {fmtPrice(st.last)} <small>{data ? UNIT[data.unit] : ''}</small>
                  </p>
                ) : null}
              </div>
              {st ? (
                <dl className="chart-stats">
                  <div>
                    <dt>تغییر در این بازه</dt>
                    <dd className={`num ${st.changePct >= 0 ? 'up' : 'down'}`}>{fmtPct(st.changePct, 1)}</dd>
                  </div>
                  <div>
                    <dt>بیشترین</dt>
                    <dd className="num">{fmtPrice(st.high)}</dd>
                  </div>
                  <div>
                    <dt>کمترین</dt>
                    <dd className="num">{fmtPrice(st.low)}</dd>
                  </div>
                </dl>
              ) : null}
            </header>
            {state === 'error' ? (
              <p className="empty">نمودار دریافت نشد: {err}. بازه دیگری را امتحان کنید یا چند دقیقه بعد دوباره باز کنید.</p>
            ) : data && data.points.length >= 2 ? (
              <PriceChart points={data.points} intraday={data.resolution === 'intraday'} rising={(st?.changePct ?? 0) >= 0} decimals={decimals} lines={lines} />
            ) : state === 'loading' ? (
              <div className="chart-host skeleton" />
            ) : (
              <p className="empty">برای این بازه هنوز داده‌ای ثبت نشده است.</p>
            )}
            {data?.note ? <p className="note">{data.note}</p> : null}
            {lines && said.length ? (
              <div className="ind-read" data-testid="ind-readings">
                <h3>اندیکاتورها الان چه می‌گویند</h3>
                <ul className="notes">
                  {said.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
                {data?.resolution === 'intraday' ? <p className="note">در بازه روزانه و هفتگی، اندیکاتورها روی نقطه‌های ۱۰ دقیقه‌ای حساب شده‌اند، نه روزها (میانگین ۲۰ یعنی ۲۰ نقطه).</p> : null}
                <p className="ind-evidence">{indicatorEvidence(group)}</p>
              </div>
            ) : null}
            {scenario && !scenario.missingReason && scenario.rows.m1 ? (
              <p className="note">
                سناریوی یک‌ماهه: بدترین {fmtPrice(scenario.rows.m1.worst)}، بهترین {fmtPrice(scenario.rows.m1.best)}.{' '}
                <Link href={`/scenarios#s-${scenario.key.replace(':', '-')}`}>جزئیات سناریو</Link>
              </p>
            ) : null}
            {isForecastAsset(asset) ? (
              <p className="note">
                <button type="button" className="linkish" onClick={() => switchMode('forecast')}>
                  پیش‌بینی هفتگی تا یک‌ساله {label} را ببینید
                </button>
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
