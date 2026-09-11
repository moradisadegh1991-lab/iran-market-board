'use client';
import { useEffect, useRef } from 'react';
import type { IChartApi, ISeriesApi, ISeriesMarkersPluginApi, Time, UTCTimestamp } from 'lightweight-charts';

export interface EquityLine {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  width?: 1 | 2 | 3;
  points: { date: string; value: number }[];
}
export interface EquityMarker {
  date: string;
  side: 'buy' | 'sell';
  text: string;
}

const faDay = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric' });
const faDayYear = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'short', day: 'numeric' });
const ts = (iso: string) => Math.floor(Date.parse(`${iso}T12:00:00Z`) / 1000) as UTCTimestamp;
const compact = (v: number) => (v >= 1e9 ? `${(v / 1e9).toLocaleString('fa-IR', { maximumFractionDigits: 2 })} میلیارد` : v >= 1e6 ? `${(v / 1e6).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} میلیون` : v.toLocaleString('fa-IR', { maximumFractionDigits: 0 }));

export default function EquityChart({ lines, markers }: { lines: EquityLine[]; markers: EquityMarker[] }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef(new Map<string, ISeriesApi<'Line'>>());
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lwRef = useRef<typeof import('lightweight-charts') | null>(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const lw = await import('lightweight-charts');
      if (disposed || !host.current) return;
      lwRef.current = lw;
      const css = getComputedStyle(document.documentElement);
      chartRef.current = lw.createChart(host.current, {
        autoSize: true,
        layout: { background: { type: lw.ColorType.Solid, color: 'transparent' }, textColor: '#5D6878', fontFamily: css.getPropertyValue('--body').trim() || 'Vazirmatn, Tahoma, sans-serif', fontSize: 12, attributionLogo: false },
        grid: { vertLines: { visible: false }, horzLines: { color: '#E6EAF0' } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.08 } },
        timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true, tickMarkFormatter: (t: Time) => faDay.format(new Date((t as number) * 1000)) },
        crosshair: { mode: lw.CrosshairMode.Magnet, vertLine: { labelBackgroundColor: '#1A2848' }, horzLine: { labelBackgroundColor: '#1A2848' } },
        handleScroll: { vertTouchDrag: false },
        localization: { locale: 'fa-IR', priceFormatter: compact, timeFormatter: (t: Time) => faDayYear.format(new Date((t as number) * 1000)) },
      });
      apply();
    })();
    return () => {
      disposed = true;
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current.clear();
      markersRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply() {
    const lw = lwRef.current;
    const chart = chartRef.current;
    if (!lw || !chart) return;
    const wanted = new Set(lines.map((l) => l.key));
    for (const [k, s] of seriesRef.current) {
      if (!wanted.has(k)) {
        chart.removeSeries(s);
        seriesRef.current.delete(k);
      }
    }
    // draw benchmarks first so the strategy line sits on top
    for (const l of [...lines].reverse()) {
      let s = seriesRef.current.get(l.key);
      if (!s) {
        s = chart.addSeries(lw.LineSeries, { priceLineVisible: false, lastValueVisible: false, crosshairMarkerRadius: 3 });
        seriesRef.current.set(l.key, s);
      }
      s.applyOptions({ color: l.color, lineWidth: l.width ?? 2, lineStyle: l.dashed ? lw.LineStyle.Dashed : lw.LineStyle.Solid });
      s.setData(l.points.map((p) => ({ time: ts(p.date), value: p.value })));
    }
    const main = seriesRef.current.get(lines[0]?.key);
    if (main) {
      const data = markers
        .map((m) => ({ time: ts(m.date) as Time, position: m.side === 'buy' ? ('belowBar' as const) : ('aboveBar' as const), shape: m.side === 'buy' ? ('arrowUp' as const) : ('arrowDown' as const), color: m.side === 'buy' ? '#117A45' : '#B83A2F', text: m.text }))
        .sort((a, b) => (a.time as number) - (b.time as number));
      if (markersRef.current) markersRef.current.setMarkers(data);
      else markersRef.current = lw.createSeriesMarkers(main, data);
    }
    chart.timeScale().fitContent();
  }

  useEffect(apply, [lines, markers]);

  return <div ref={host} className="chart-host equity-host" dir="ltr" role="img" aria-label="نمودار ارزش سرمایه در طول شبیه‌سازی" />;
}
