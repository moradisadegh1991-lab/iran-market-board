// 1-month screen for TSE + IFB stocks: relative strength, volume surge, breakout proximity, trend, money flow
import { clamp, fmtPct, isNum } from '@/lib/num';
import type { TseSymbol } from '@/lib/sources/brsapi';
import type { TseStore } from '@/lib/history';
import type { StockRow } from '@/lib/types';
import { computeRisk } from './risk';
import { mean, median, pctRank, rsi, sma } from './stats';

const minTval = () => Number(process.env.TSE_MIN_TVAL || 5e9); // rial

const ret = (c: number[], n: number) => (c.length > n && c[c.length - 1 - n] > 0 ? c[c.length - 1] / c[c.length - 1 - n] - 1 : null);

export function screenTse(
  today: TseSymbol[] | null,
  store: TseStore,
  indexCloses: number[],
): { rows: StockRow[]; mode: 'history' | 'warmup' | 'unavailable'; historyDays: number; note: string } {
  const historyDays = store.dates.length;
  if (!today?.length) {
    return { rows: [], mode: 'unavailable', historyDays, note: 'داده نمادها از BrsApi در دسترس نیست. خروجی /api/diag را بررسی کنید.' };
  }
  const bySym = new Map(today.map((s) => [s.symbol, s]));
  const idxR20 = ret(indexCloses, 20);

  if (historyDays >= 20) {
    type F = { s: TseSymbol; c: number[]; v: number[]; r5: number | null; r20: number | null; r60: number | null; rs: number | null; surge: number | null; nearHigh: number; trend: number; rsi: number | null; flow: number | null };
    const feats: F[] = [];
    for (const [symbol, h] of Object.entries(store.sym)) {
      const s = bySym.get(symbol);
      if (!s || s.tno <= 0) continue;
      const c = h.c.filter((x): x is number => isNum(x) && x > 0);
      const v = h.v.filter((x): x is number => isNum(x) && x >= 0);
      if (c.length < 20 || median(v.slice(-20)) * 1e6 < minTval()) continue;
      const r20 = ret(c, 20);
      const sma20 = sma(c, 20), sma50 = sma(c, 50);
      const last = c[c.length - 1];
      const recentV = mean(v.slice(-5)), baseV = mean(v.slice(-40, -5));
      feats.push({
        s, c, v,
        r5: ret(c, 5),
        r20,
        r60: ret(c, Math.min(60, c.length - 1)),
        rs: r20 !== null && idxR20 !== null ? r20 - idxR20 : r20,
        surge: baseV > 0 ? recentV / baseV : null,
        nearHigh: last / Math.max(...c.slice(-60)),
        trend: sma20 && last > sma20 ? (sma50 === null || sma20 > sma50 ? 1 : 0.6) : 0,
        rsi: rsi(c, 14),
        flow: s.netRealFlow !== null && s.tval > 0 ? s.netRealFlow / s.tval : null,
      });
    }
    if (feats.length) {
      const R = (f: (x: F) => number | null) => pctRank(feats.map((x) => f(x) ?? NaN));
      const rRs = R((x) => x.rs), rR60 = R((x) => x.r60), rSurge = R((x) => x.surge), rHigh = R((x) => x.nearHigh), rFlow = R((x) => x.flow);
      const hasFlow = feats.some((x) => x.flow !== null);
      const rows = feats.map((f, i) => {
        let score = 0.28 * rRs[i] + 0.12 * rR60[i] + 0.2 * rSurge[i] + 0.15 * rHigh[i] + 0.15 * f.trend + (hasFlow ? 0.1 * rFlow[i] : 0.1 * rRs[i]);
        const reasons: string[] = [];
        const flags: string[] = [];
        if (f.r20 !== null && rRs[i] > 0.7) reasons.push(`بازده ۲۰ روزه ${fmtPct(f.r20 * 100, 0)}${idxR20 !== null ? ' (قوی‌تر از شاخص)' : ''}`);
        if (f.surge !== null && f.surge > 1.5) reasons.push(`ارزش معاملات ۵ روز اخیر ${fmtPct((f.surge - 1) * 100, 0)} بالاتر از میانگین`);
        if (f.nearHigh > 0.95) reasons.push('نزدیک سقف ۶۰ روزه');
        if (f.trend === 1) reasons.push('قیمت بالای SMA20 و SMA50');
        if (hasFlow && f.flow !== null && f.flow > 0.1) reasons.push('ورود پول حقیقی');
        if ((f.r5 ?? 0) > 0.25 || (f.rsi ?? 0) > 80) {
          score -= 0.12;
          flags.push('اشباع خرید');
        }
        if (isNum(f.s.maxAllowed) && isNum(f.s.last) && f.s.last >= f.s.maxAllowed * 0.999) {
          score -= 0.05;
          flags.push('صف خرید');
        }
        if (isNum(f.s.pe) && f.s.pe > 30) {
          score -= 0.05;
          flags.push('P/E بالا');
        }
        if ((isNum(f.s.pe) && f.s.pe < 0) || (isNum(f.s.eps) && f.s.eps < 0)) {
          score -= 0.08;
          flags.push('زیان‌ده');
        }
        if (!reasons.length) reasons.push('امتیاز ترکیبی متوازن');
        const risk = computeRisk(store.dates.slice(-f.c.length), f.c).horizons.m1;
        return {
          rank: 0,
          symbol: f.s.symbol,
          name: f.s.name,
          price: f.s.last ?? f.s.close,
          chgToday: f.s.lastChgPct ?? f.s.chgPct,
          r20: f.r20 === null ? null : f.r20 * 100,
          r60: f.r60 === null ? null : f.r60 * 100,
          volSurge: f.surge,
          pe: f.s.pe,
          sector: f.s.sector,
          score: Math.round(clamp(score, 0, 1) * 100),
          riskMonth: risk?.hold ?? null,
          reasons: reasons.slice(0, 3),
          flags,
        } satisfies StockRow;
      });
      return {
        rows: rows.sort((a, b) => b.score - a.score).slice(0, 25).map((r, i) => ({ ...r, rank: i + 1 })),
        mode: 'history',
        historyDays,
        note: `غربال بر پایه ${historyDays} روز معاملاتی ذخیره‌شده.`,
      };
    }
  }

  // warm-up: single-day features only (low confidence)
  const liquid = today.filter((s) => s.tno > 0 && s.tval >= minTval());
  const R = (f: (x: TseSymbol) => number | null) => pctRank(liquid.map((x) => f(x) ?? NaN));
  const rChg = R((x) => (isNum(x.lastChgPct) ? x.lastChgPct : x.chgPct)), rVal = R((x) => x.tval);
  const rTurn = R((x) => (isNum(x.mv) && x.mv > 0 ? x.tval / x.mv : null));
  const rFlow = R((x) => (x.netRealFlow !== null && x.tval > 0 ? x.netRealFlow / x.tval : null));
  const rows = liquid
    .map((s, i) => {
      let score = 0.3 * rChg[i] + 0.3 * rVal[i] + 0.2 * rTurn[i] + 0.2 * rFlow[i];
      const flags: string[] = [];
      if (isNum(s.maxAllowed) && isNum(s.last) && s.last >= s.maxAllowed * 0.999) {
        score -= 0.1;
        flags.push('صف خرید');
      }
      if ((isNum(s.pe) && s.pe < 0) || (isNum(s.eps) && s.eps < 0)) {
        score -= 0.08;
        flags.push('زیان‌ده');
      }
      return {
        rank: 0,
        symbol: s.symbol,
        name: s.name,
        price: s.last ?? s.close,
        chgToday: s.lastChgPct ?? s.chgPct,
        r20: null,
        r60: null,
        volSurge: null,
        pe: s.pe,
        sector: s.sector,
        score: Math.round(clamp(score, 0, 1) * 100),
        riskMonth: null,
        reasons: ['فقط داده‌های امروز (حالت گرم‌شدن)'],
        flags,
      } satisfies StockRow;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map((r, i) => ({ ...r, rank: i + 1 }));
  return {
    rows,
    mode: 'warmup',
    historyDays,
    note: `تاریخچه کافی نیست (${historyDays} از ۲۰ روز). تا تکمیل، رتبه‌بندی فقط بر اساس معاملات امروز است؛ برای پر کردن فوری از scripts/backfill_tse.py استفاده کنید.`,
  };
}
