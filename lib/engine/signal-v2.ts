// Daily signal v2 for the multi-asset engine (backtest + live paper trading).
//
// Every component below was chosen from a measured relationship on REAL TGJU history (2014–2020
// design period, scripts/eval/factor-ic.ts), not from trading folklore. What the data said:
//  • trend and momentum predict the next 20–60 days for dollar, 18k gold and coin (rank IC +0.2…+0.3);
//    the rial weakens in long persistent waves, and these assets ride them;
//  • HIGH RSI predicted HIGHER returns (IC +0.2…+0.26) — v1 sold "overbought" assets and took
//    profit at RSI>72, i.e. it bet against the strongest regularity in this market;
//  • 18k gold trading at a rich premium over its melt value (ounce × dollar) predicted weaker
//    returns (IC −0.26 at 60 days) — a genuine fundamental, previously unused for gold;
//  • the dollar's own 60-day trend predicted gold and coin (IC +0.2…+0.28);
//  • the coin-bubble penalty v1 applies was NOT supported (IC ≈ 0, slightly positive) — dropped.
// News scoring is unchanged from v1.
import { clamp, fmtInt, fmtPct, isNum } from '@/lib/num';
import { ewmaVol, logReturns, mean, rsi, sma, std } from './stats';
import { addDays, cutoffMs, type NewsRef, type PriceBook, type SignalComponent, type SimAsset, type SimInput, type SimParams, type Signal } from './simulator';

const DAY = 86_400_000;
const pctTxt = (x: number, d = 0) => fmtPct(x * 100, d);
const pctAbs = (x: number, d = 0) => fmtPct(x * 100, d, false);

/** Premium of a gold instrument over the value of the pure gold in it. */
function meltPremium(asset: SimAsset, px: number | null, ons: number | null, usd: number | null): number | null {
  if (!isNum(px) || !isNum(ons) || !isNum(usd)) return null;
  const grams = asset === 'coin' ? 7.3224 : asset === 'g18' ? 0.75 : null;
  return grams ? px / ((ons / 31.1035) * grams * usd) - 1 : null;
}

export function signalForV2(
  asset: SimAsset,
  book: PriceBook,
  date: string,
  input: Pick<SimInput, 'news'> & { fixedIncomeYield?: number },
  bubbleBooks: { ons?: PriceBook; usd?: PriceBook },
  params: SimParams,
  cut: number = cutoffMs(date),
): Signal | null {
  const p = book.history(date, 260);
  if (p.length < 62) return null;
  const last = p[p.length - 1];
  const ppy = book.periodsPerYear(date);
  const r = logReturns(p.slice(-61));
  const dailyVol = Math.max(ewmaVol(r, 0.94), std(r) * 0.6, 1e-4);
  const annVol = dailyVol * Math.sqrt(ppy);
  const downside = Math.sqrt(mean(r.slice(-40).map((x) => Math.min(0, x) ** 2))) * Math.SQRT2 * Math.sqrt(ppy);
  const riskVol = Math.max(downside, annVol * 0.35, 0.03);
  const up: string[] = [];
  const down: string[] = [];
  const comp: Record<SignalComponent, number> = { trend: 0, momentum: 0, stretch: 0, bubble: 0, news: 0 };

  // 1) trend: distance from the 100-day mean in volatility units, the 200-day side, the 20/50 stack
  const s20 = sma(p, 20)!;
  const s50 = sma(p, 50)!;
  const s100 = p.length >= 100 ? sma(p, 100)! : s50;
  const s200 = p.length >= 200 ? sma(p, 200) : null;
  const d100 = last / s100 - 1;
  const t1 = 15 * Math.tanh(d100 / Math.max(annVol * Math.sqrt(100 / ppy) * 0.5, 0.01));
  comp.trend += t1;
  (t1 >= 0 ? up : down).push(`قیمت ${pctTxt(d100, 1)} نسبت به میانگین ۱۰۰ روزه`);
  if (isNum(s200)) {
    const t2 = last > s200 ? 8 : -8;
    comp.trend += t2;
    (t2 > 0 ? up : down).push(t2 > 0 ? 'بالای میانگین ۲۰۰ روزه (روند بلندمدت صعودی)' : 'زیر میانگین ۲۰۰ روزه (روند بلندمدت نزولی)');
  }
  comp.trend += s20 > s50 ? 7 : -7;

  // 2) momentum, risk-adjusted, 20 and 60 sessions — measured in EXCESS of the deposit rate: with a
  // fixed-income fund paying ~25–30%, an asset drifting up 10% a year is a losing position, not a trend
  const ret20 = last / p[p.length - 21] - 1;
  const ret60 = last / p[p.length - 61] - 1;
  const hurdle = Math.log(1 + (isNum(input.fixedIncomeYield) ? input.fixedIncomeYield! : 0.25)) / ppy;
  const z60 = (Math.log(1 + ret60) - 60 * hurdle) / (annVol * Math.sqrt(60 / ppy));
  const z20 = (Math.log(1 + ret20) - 20 * hurdle) / (annVol * Math.sqrt(20 / ppy));
  const m = 15 * Math.tanh(z60 / 1.5) + 15 * Math.tanh(z20 / 1.5);
  comp.momentum += m;
  (m >= 0 ? up : down).push(`بازده ۶۰ جلسه ${pctTxt(ret60, 1)} و ۲۰ جلسه ${pctTxt(ret20, 1)}`);

  // 3) RSI as strength, not as a reversal warning (see header)
  const R = rsi(p.slice(-60), 14);
  if (isNum(R)) {
    comp.stretch += 8 * ((R - 50) / 50);
    if (R >= 70) up.push(`RSI برابر ${fmtInt(R)}؛ فشار خرید قوی (در این بازار معمولاً ادامه روند بوده، نه برگشت)`);
    else if (R <= 30) down.push(`RSI برابر ${fmtInt(R)}؛ فشار فروش`);
  }

  // 4) fundamentals specific to the Iranian market
  if (bubbleBooks.ons && bubbleBooks.usd) {
    const ons = bubbleBooks.ons, usd = bubbleBooks.usd;
    if (asset === 'g18') {
      const now = meltPremium('g18', last, ons.priceAt(date), usd.priceAt(date));
      const past = Array.from({ length: 25 }, (_, k) => {
        const d = addDays(date, -10 * (k + 1));
        return meltPremium('g18', book.priceAt(d), ons.priceAt(d), usd.priceAt(d));
      }).filter(isNum);
      if (isNum(now) && past.length >= 12) {
        const norm = mean(past);
        const f = -12 * Math.tanh((now - norm) / 0.04);
        comp.bubble += f;
        if (f <= -3) down.push(`طلای ۱۸ عیار ${pctAbs(now, 1)} گران‌تر از ارزش طلای خام است (میانگین سالانه ${pctAbs(norm, 1)})`);
        else if (f >= 3) up.push(`طلای ۱۸ عیار نسبت به ارزش طلای خام ارزان‌تر از معمول است (${pctAbs(now, 1)} در برابر ${pctAbs(norm, 1)})`);
      }
    }
    if (asset === 'g18' || asset === 'coin') {
      const u = usd.history(date, 70);
      if (u.length >= 61) {
        const ur = logReturns(u.slice(-61));
        const uVol = Math.max(std(ur) * Math.sqrt(300), 0.05);
        const uz = Math.log(u[u.length - 1] / u[u.length - 61]) / (uVol * Math.sqrt(60 / 300));
        const f = 10 * Math.tanh(uz / 1.5);
        comp.bubble += f;
        if (Math.abs(f) >= 3) (f > 0 ? up : down).push(`روند ۶۰ روزه دلار ${pctTxt(u[u.length - 1] / u[u.length - 61] - 1, 1)}؛ ${f > 0 ? 'پشتیبان' : 'مخالف'} طلا و سکه`);
      }
    }
  }

  // 5) news — identical to v1
  let newsSum = 0;
  const refs: (NewsRef & { contrib: number })[] = [];
  const from = addDays(date, -10);
  for (const n of input.news) {
    if (n.ms > cut || n.date < from) continue;
    const e = n.effects[asset];
    if (!isNum(e) || e === 0) continue;
    const age = Math.max(0, (cut - n.ms) / DAY);
    const contrib = e * n.weight * Math.exp(-age / 4);
    newsSum += contrib;
    refs.push({ id: n.id, date: n.date, title: n.title, source: n.source, url: n.url, facts: n.facts, effect: e, contrib });
  }
  comp.news = 20 * Math.tanh(newsSum / 1.6);

  const w = params.weights;
  const score = (['trend', 'momentum', 'stretch', 'bubble', 'news'] as SignalComponent[]).reduce((acc, k) => acc + w[k] * comp[k], 0);
  const newsScore = comp.news * w.news;
  const topNews = refs.sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib)).slice(0, 3);
  if (Math.abs(newsScore) >= 3) {
    const facts = [...new Set(topNews.filter((n) => Math.sign(n.contrib) === Math.sign(newsScore)).flatMap((n) => n.facts))].slice(0, 2);
    (newsScore > 0 ? up : down).push(`جمع‌بندی اخبار ۱۰ روز اخیر ${newsScore > 0 ? 'مثبت' : 'منفی'} است: ${facts.join('، ')}`);
  }
  const longUp = isNum(s200) ? last > s200 && last > s100 : last > s100;
  return {
    score: clamp(score, -100, 100),
    newsScore,
    components: comp,
    annVol,
    rsi: R,
    reasonsUp: up,
    reasonsDown: down,
    news: topNews.map(({ contrib: _c, ...n }) => n),
    ppy,
    riskVol,
    stopScale: longUp ? 1.4 : 1,
    noTakeProfit: true,
  };
}
