'use client';
import { useEffect, useRef } from 'react';
import type { IChartApi, ISeriesApi, Time, UTCTimestamp } from 'lightweight-charts';

const faTime = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const faDay = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric' });
const faDayYear = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'short', day: 'numeric' });
const faClock = new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit' });

export default function PriceChart({ points, intraday, rising, decimals }: { points: [number, number][]; intraday: boolean; rising: boolean; decimals: number }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const intradayRef = useRef(intraday);
  const decimalsRef = useRef(decimals);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const lw = await import('lightweight-charts');
      if (disposed || !host.current) return;
      const css = getComputedStyle(document.documentElement);
      const font = css.getPropertyValue('--body').trim() || 'Vazirmatn, Tahoma, sans-serif';
      const chart = lw.createChart(host.current, {
        autoSize: true,
        layout: { background: { type: lw.ColorType.Solid, color: 'transparent' }, textColor: '#5D6878', fontFamily: font, fontSize: 12, attributionLogo: false },
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
          priceFormatter: (p: number) => p.toLocaleString('fa-IR', { maximumFractionDigits: decimalsRef.current }),
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply() {
    intradayRef.current = intraday;
    decimalsRef.current = decimals;
    const s = seriesRef.current;
    const chart = chartRef.current;
    if (!s || !chart) return;
    const color = rising ? '#117A45' : '#B83A2F';
    s.applyOptions({ lineColor: color, topColor: rising ? 'rgba(17,122,69,.22)' : 'rgba(184,58,47,.2)', bottomColor: 'rgba(255,255,255,0)', priceFormat: { type: 'price', precision: decimals, minMove: 1 / 10 ** decimals } });
    const seen = new Set<number>();
    const data = points
      .map(([ms, v]) => ({ time: Math.floor(ms / 1000) as UTCTimestamp, value: v }))
      .sort((a, b) => a.time - b.time)
      .filter((d) => (seen.has(d.time) ? false : (seen.add(d.time), true)));
    s.setData(data);
    chart.timeScale().applyOptions({ timeVisible: intraday });
    chart.timeScale().fitContent();
  }

  useEffect(apply, [points, intraday, rising, decimals]);

  return <div ref={host} className="chart-host" dir="ltr" role="img" aria-label="نمودار قیمت" />;
}
