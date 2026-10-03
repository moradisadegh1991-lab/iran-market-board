'use client';
import { useEffect, useRef } from 'react';
import type { IChartApi, ISeriesApi, SeriesType, Time, UTCTimestamp, WhitespaceData, LineData } from 'lightweight-charts';
import { IND_COLOR, type IndicatorLines } from '@/lib/indicators';

const faTime = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const faDay = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric' });
const faDayYear = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'short', day: 'numeric' });
const faClock = new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit' });

type Lw = typeof import('lightweight-charts');

/** [ms, value|null] → series data, one item per second, nulls as gaps (whitespace items) */
function toData(points: [number, number | null][]): (LineData<Time> | WhitespaceData<Time>)[] {
  const seen = new Set<number>();
  return points
    .map(([ms, v]) => ({ time: Math.floor(ms / 1000) as UTCTimestamp, v }))
    .sort((a, b) => a.time - b.time)
    .filter((d) => (seen.has(d.time) ? false : (seen.add(d.time), true)))
    .map((d) => (d.v === null || !Number.isFinite(d.v) ? { time: d.time } : { time: d.time, value: d.v }));
}

export default function PriceChart({
  points,
  intraday,
  rising,
  decimals,
  lines,
}: {
  points: [number, number][];
  intraday: boolean;
  rising: boolean;
  decimals: number;
  /** indicator lines (lib/indicators.ts), aligned with `points` */
  lines?: IndicatorLines | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lwRef = useRef<Lw | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const indRef = useRef<ISeriesApi<SeriesType>[]>([]);
  const intradayRef = useRef(intraday);
  const decimalsRef = useRef(decimals);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const lw = await import('lightweight-charts');
      if (disposed || !host.current) return;
      lwRef.current = lw;
      const css = getComputedStyle(document.documentElement);
      const font = css.getPropertyValue('--body').trim() || 'Vazirmatn, Tahoma, sans-serif';
      const chart = lw.createChart(host.current, {
        autoSize: true,
        layout: { background: { type: lw.ColorType.Solid, color: 'transparent' }, textColor: '#5D6878', fontFamily: font, fontSize: 12, attributionLogo: false, panes: { separatorColor: '#DCE1E8' } },
        grid: { vertLines: { visible: false }, horzLines: { color: '#E6EAF0' } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
        timeScale: {
          borderVisible: false,
          timeVisible: true,
          secondsVisible: false,
          fixLeftEdge: true,
          fixRightEdge: true,
          tickMarkFormatter: (t: Time, type: number) => {
            const d = new Date((t as number) * 1000);
            return type >= 3 ? faClock.format(d) : faDay.format(d);
          },
        },
        crosshair: { mode: lw.CrosshairMode.Magnet, vertLine: { labelBackgroundColor: '#1A2848' }, horzLine: { labelBackgroundColor: '#1A2848' } },
        handleScroll: { vertTouchDrag: false },
        localization: {
          locale: 'fa-IR',
          priceFormatter: (p: number) => p.toLocaleString('fa-IR', { maximumFractionDigits: Math.abs(p) < 10 ? Math.max(2, decimalsRef.current) : decimalsRef.current }),
          timeFormatter: (t: Time) => (intradayRef.current ? faTime : faDayYear).format(new Date((t as number) * 1000)),
        },
      });
      seriesRef.current = chart.addSeries(lw.AreaSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
      chartRef.current = chart;
      apply();
    })();
    return () => {
      disposed = true;
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      indRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply() {
    intradayRef.current = intraday;
    decimalsRef.current = decimals;
    const s = seriesRef.current;
    const chart = chartRef.current;
    const lw = lwRef.current;
    if (!s || !chart || !lw) return;
    const color = rising ? '#117A45' : '#B83A2F';
    s.applyOptions({ lineColor: color, topColor: rising ? 'rgba(17,122,69,.22)' : 'rgba(184,58,47,.2)', bottomColor: 'rgba(255,255,255,0)', priceFormat: { type: 'price', precision: decimals, minMove: 1 / 10 ** decimals } });
    s.setData(toData(points) as LineData<Time>[]);

    // indicators: rebuilt from scratch on every change (a handful of series)
    for (const x of indRef.current) chart.removeSeries(x);
    indRef.current = [];
    const line = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
    for (const o of lines?.overlays ?? []) {
      const x = chart.addSeries(lw.LineSeries, { ...line, color: o.color, lineStyle: o.dashed ? lw.LineStyle.Dashed : lw.LineStyle.Solid, priceFormat: { type: 'price', precision: decimals, minMove: 1 / 10 ** decimals } });
      x.setData(toData(o.points));
      indRef.current.push(x);
    }
    let pane = 1;
    if (lines?.rsi) {
      const x = chart.addSeries(lw.LineSeries, { ...line, lineWidth: 2, color: IND_COLOR.rsi, lastValueVisible: true, priceFormat: { type: 'price', precision: 0, minMove: 1 } }, pane);
      x.setData(toData(lines.rsi));
      x.createPriceLine({ price: 70, color: '#B83A2F', lineWidth: 1, lineStyle: lw.LineStyle.Dotted, axisLabelVisible: true, title: '' });
      x.createPriceLine({ price: 30, color: '#117A45', lineWidth: 1, lineStyle: lw.LineStyle.Dotted, axisLabelVisible: true, title: '' });
      indRef.current.push(x);
      pane++;
    }
    if (lines?.macd) {
      const fmt = { type: 'price' as const, precision: decimals ? decimals + 1 : 0, minMove: decimals ? 1 / 10 ** (decimals + 1) : 1 };
      const h = chart.addSeries(lw.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: fmt }, pane);
      h.setData(toData(lines.macd.hist).map((d) => ('value' in d ? { ...d, color: d.value >= 0 ? 'rgba(17,122,69,.45)' : 'rgba(184,58,47,.45)' } : d)));
      const m = chart.addSeries(lw.LineSeries, { ...line, lineWidth: 2, color: IND_COLOR.macd, priceFormat: fmt }, pane);
      m.setData(toData(lines.macd.macd));
      const sg = chart.addSeries(lw.LineSeries, { ...line, color: IND_COLOR.signal, priceFormat: fmt }, pane);
      sg.setData(toData(lines.macd.signal));
      indRef.current.push(h, m, sg);
      pane++;
    }
    const panes = chart.panes();
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? 3 : 1));
    chart.timeScale().applyOptions({ timeVisible: intraday });
    chart.timeScale().fitContent();
  }

  useEffect(apply, [points, intraday, rising, decimals, lines]);

  const panes = (lines?.rsi ? 1 : 0) + (lines?.macd ? 1 : 0);
  return <div ref={host} className={`chart-host${panes ? ` with-panes-${panes}` : ''}`} dir="ltr" role="img" aria-label="نمودار قیمت" />;
}
