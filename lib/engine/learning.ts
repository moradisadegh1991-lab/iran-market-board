// Learning from finished runs (backtests or live sessions).
// Pure: takes a result + a way to look at prices AFTER each trade, returns adjusted parameters and plain-language lessons.
//
// Honest design limits (shown in the UI too):
//  • It tunes a handful of bounded knobs of a fixed rule set; it does not invent new strategies.
//  • Updates are small, scaled by how many closed trades the run produced and by how much of the window is NEW
//    (re-running a period that was already learned from teaches nothing — that would just be curve fitting).
//  • Every update first pulls parameters slightly back toward the defaults, so one lucky or unlucky run cannot drag them far.
import { clamp, fmtInt, fmtNum, fmtPct, isNum } from '@/lib/num';
import { mean } from './stats';
import {
  DEFAULT_PARAMS, PROFILES, SIGNAL_COMPONENTS, SIM_ASSETS, normalizeParams,
  type SignalComponent, type SimAsset, type SimParams, type SimResult, type SimTrade,
} from './simulator';

export interface PriceLookup {
  /** closes strictly after `date`, at most `sessions` of them (empty when the future is not known yet) */
  after(asset: SimAsset, date: string, sessions: number): number[];
}

export type LessonTone = 'mistake' | 'good' | 'info';

export interface Lesson {
  code: string;
  tone: LessonTone;
  title: string;
  detail: string;
  evidence: number; // how many trades/assets support it
  change: string | null; // what the engine changed because of it
}

export interface TradeFlag {
  n: number;
  code: string;
  text: string;
}

export interface ParamDelta {
  key: string;
  label: string;
  from: number;
  to: number;
}

export interface LearnOutcome {
  applied: boolean;
  reason: string | null;
  lr: number;
  newFraction: number;
  closedRoundTrips: number;
  lessons: Lesson[];
  flags: TradeFlag[];
  deltas: ParamDelta[];
  before: SimParams;
  after: SimParams;
}

interface RoundTrip {
  asset: SimAsset;
  entry: SimTrade;
  exit: SimTrade;
  buyToman: number;
  realizedToman: number;
  returnPct: number; // realized P&L over capital deployed, after costs
  holdDays: number;
  sells: SimTrade[];
}

const ASSET_LABEL = Object.fromEntries(SIM_ASSETS.map((a) => [a.key, a.label])) as Record<SimAsset, string>;
const COMPONENT_LABEL = Object.fromEntries(SIGNAL_COMPONENTS.map((c) => [c.key, c.label])) as Record<SignalComponent, string>;

export function roundTrips(trades: SimTrade[]): RoundTrip[] {
  const out: RoundTrip[] = [];
  const open = new Map<SimAsset, { qty: number; maxQty: number; entry: SimTrade; buy: number; realized: number; sells: SimTrade[] }>();
  for (const t of [...trades].sort((a, b) => a.n - b.n)) {
    const cur = open.get(t.asset);
    if (t.side === 'buy') {
      if (!cur) open.set(t.asset, { qty: t.qty, maxQty: t.qty, entry: t, buy: t.valueToman, realized: 0, sells: [] });
      else {
        cur.qty += t.qty;
        cur.maxQty = Math.max(cur.maxQty, cur.qty);
        cur.buy += t.valueToman;
      }
      continue;
    }
    if (!cur) continue;
    cur.qty -= t.qty;
    cur.realized += t.realizedToman ?? 0;
    cur.sells.push(t);
    if (cur.qty <= cur.maxQty * 1e-9) {
      out.push({
        asset: t.asset, entry: cur.entry, exit: t, buyToman: cur.buy, realizedToman: cur.realized,
        returnPct: cur.buy > 0 ? (cur.realized / cur.buy) * 100 : 0, holdDays: t.holdDays ?? 0, sells: cur.sells,
      });
      open.delete(t.asset);
    }
  }
  return out;
}

const PARAM_LABELS: Record<string, string> = {
  entryShift: 'سخت‌گیری آستانه ورود (امتیاز)',
  exitShift: 'آستانه خروج (امتیاز)',
  stopMult: 'ضریب فاصله حد ضرر',
  bandMult: 'ضریب باند بازتنظیم',
  minHoldDays: 'حداقل روز نگهداری',
  cooldownDays: 'روزهای ممنوعیت ورود پس از حد ضرر',
};

export function paramRows(p: SimParams): { key: string; label: string; value: number; def: number }[] {
  const d = DEFAULT_PARAMS;
  return [
    ...SIGNAL_COMPONENTS.map(({ key }) => ({ key: `weights.${key}`, label: `وزن ${COMPONENT_LABEL[key]}`, value: p.weights[key], def: d.weights[key] })),
    ...(['entryShift', 'exitShift', 'stopMult', 'bandMult', 'minHoldDays', 'cooldownDays'] as const).map((k) => ({ key: k, label: PARAM_LABELS[k], value: p[k], def: d[k] })),
    ...SIM_ASSETS.map(({ key }) => ({ key: `assetTrust.${key}`, label: `ضریب اعتماد به ${ASSET_LABEL[key]}`, value: p.assetTrust[key], def: d.assetTrust[key] })),
  ];
}

function diffParams(a: SimParams, b: SimParams): ParamDelta[] {
  const ra = paramRows(a);
  const rb = paramRows(b);
  return ra
    .map((r, i) => ({ key: r.key, label: r.label, from: r.value, to: rb[i].value }))
    .filter((d) => Math.abs(d.to - d.from) >= (d.key.includes('Days') || d.key.includes('Shift') ? 0.05 : 0.005));
}

export function learnFromResult(current: SimParams, r: SimResult, lookup: PriceLookup, newFraction: number): LearnOutcome {
  const before = normalizeParams(current);
  const p: SimParams = structuredClone(before);
  const lessons: Lesson[] = [];
  const flags: TradeFlag[] = [];
  const m = r.metrics;
  const rts = roundTrips(r.trades);
  const closed = rts.length;
  const sampleFactor = Math.min(1, (closed + 2) / 10);
  const lr = clamp(newFraction, 0, 1) * sampleFactor;
  const prof = PROFILES[r.input.profile];
  const dep = r.benchmarks.find((b) => b.key === 'deposit');
  const costOf = (a: SimAsset) => SIM_ASSETS.find((x) => x.key === a)!.cost;
  const changes: string[] = [];
  const bump = (fn: () => void, text: string) => {
    if (lr <= 0) return null;
    fn();
    changes.push(text);
    return text;
  };

  // 0) shrink toward defaults — memory fades a little with every new period
  const shrink = 0.04 * clamp(newFraction, 0, 1);
  const toward = (v: number, d: number) => d + (v - d) * (1 - shrink);
  for (const { key } of SIGNAL_COMPONENTS) p.weights[key] = toward(p.weights[key], DEFAULT_PARAMS.weights[key]);
  for (const k of ['entryShift', 'exitShift', 'stopMult', 'bandMult', 'minHoldDays', 'cooldownDays'] as const) p[k] = toward(p[k], DEFAULT_PARAMS[k]);
  for (const { key } of SIM_ASSETS) p.assetTrust[key] = toward(p.assetTrust[key], DEFAULT_PARAMS.assetTrust[key]);

  // 1) whipsaws: quick losing round trips → entries were too eager
  const whips = rts.filter((t) => t.realizedToman < 0 && t.holdDays <= 21);
  for (const t of whips) flags.push({ n: t.entry.n, code: 'whipsaw', text: `ورود زودهنگام: ظرف ${fmtInt(t.holdDays)} روز با ${fmtPct(t.returnPct, 1)} بسته شد` });
  if (whips.length >= 2 && whips.length / Math.max(1, closed) >= 0.3) {
    const rate = whips.length / closed;
    const step = Math.min(3, 4 * lr * (rate / 0.5));
    const change = bump(() => {
      p.entryShift += step;
      p.minHoldDays += 0.8 * lr;
    }, `آستانه ورود ${fmtNum(step, 1)} امتیاز سخت‌تر شد`);
    lessons.push({
      code: 'whipsaw', tone: 'mistake', evidence: whips.length,
      title: 'ورود در بازار بی‌روند',
      detail: `${fmtInt(whips.length)} از ${fmtInt(closed)} موقعیت بسته‌شده (${fmtPct(rate * 100, 0, false)}) در کمتر از سه هفته با زیان بسته شد؛ سیگنال روند قبل از تثبیت روند عمل کرده بود.`,
      change,
    });
  }

  // 2) trailing stops: too tight (price bounced right back) or too loose (big losses)
  const stops = r.trades.filter((t) => t.kind === 'stop');
  let tight = 0;
  let loose = 0;
  for (const t of stops) {
    const after = lookup.after(t.asset, t.date, 10);
    const mkt = t.price / (1 - costOf(t.asset));
    if (after.length >= 5 && Math.max(...after) >= mkt * 1.06) {
      tight++;
      flags.push({ n: t.n, code: 'stop_tight', text: 'حد ضرر خیلی نزدیک بود: قیمت ظرف ۱۰ جلسه دست‌کم ۶٪ بالاتر از نقطه خروج برگشت' });
    } else if (isNum(t.realizedPct) && t.realizedPct <= -12) {
      loose++;
      flags.push({ n: t.n, code: 'stop_loose', text: `حد ضرر دیر فعال شد: زیان ${fmtPct(t.realizedPct, 1)}` });
    }
  }
  if (tight >= 2 && tight / stops.length >= 0.5) {
    const change = bump(() => (p.stopMult += 0.12 * lr), 'فاصله حد ضرر بازتر شد');
    lessons.push({ code: 'stop_tight', tone: 'mistake', evidence: tight, title: 'حد ضرر بیش از حد نزدیک', detail: `از ${fmtInt(stops.length)} بار فعال شدن حد ضرر، ${fmtInt(tight)} بار قیمت کمی بعد به بالای نقطه خروج برگشت؛ نوسان عادی بازار با شکست روند اشتباه گرفته شد.`, change });
  } else if (loose >= 2 && loose / stops.length >= 0.5) {
    const change = bump(() => (p.stopMult -= 0.1 * lr), 'فاصله حد ضرر تنگ‌تر شد');
    lessons.push({ code: 'stop_loose', tone: 'mistake', evidence: loose, title: 'حد ضرر بیش از حد باز', detail: `${fmtInt(loose)} خروج با حد ضرر زیانی بیش از ۱۲٪ داشت؛ موقعیت‌ها بیش از حد اجازه ضرر گرفتند.`, change });
  }

  // 3) exits: too early (trend kept going) or too late (held losers for long)
  const exits = r.trades.filter((t) => t.side === 'sell' && (t.kind === 'exit' || t.kind === 'trim' || t.kind === 'take_profit'));
  let early = 0;
  for (const t of exits) {
    const after = lookup.after(t.asset, t.date, 20);
    const mkt = t.price / (1 - costOf(t.asset));
    if (after.length >= 15 && Math.max(...after) >= mkt * 1.1 && after[after.length - 1] >= mkt * 1.05) {
      early++;
      flags.push({ n: t.n, code: 'early_exit', text: 'خروج زودهنگام: روند بعد از فروش دست‌کم ۱۰٪ دیگر ادامه یافت' });
    }
  }
  if (early >= 2 && early / Math.max(1, exits.length) >= 0.4) {
    const change = bump(() => {
      p.exitShift -= 3 * lr;
      p.minHoldDays += 0.5 * lr;
    }, 'آستانه خروج صبورتر شد');
    lessons.push({ code: 'early_exit', tone: 'mistake', evidence: early, title: 'فروش پیش از پایان روند', detail: `${fmtInt(early)} از ${fmtInt(exits.length)} فروش عادی زودتر از موعد بود؛ قیمت پس از فروش پایدار بالا رفت.`, change });
  }
  const late = rts.filter((t) => t.returnPct <= -8 && t.holdDays > 21 && t.exit.kind !== 'stop');
  for (const t of late) flags.push({ n: t.exit.n, code: 'late_exit', text: `خروج دیرهنگام: ${fmtInt(t.holdDays)} روز نگهداری و ${fmtPct(t.returnPct, 1)} زیان` });
  if (late.length >= 2) {
    const change = bump(() => (p.exitShift += 2 * lr), 'آستانه خروج زودتر فعال می‌شود');
    lessons.push({ code: 'late_exit', tone: 'mistake', evidence: late.length, title: 'نگهداری زیاده از حد زیان‌ده‌ها', detail: `${fmtInt(late.length)} موقعیت بیش از سه هفته با زیان بیش از ۸٪ نگهداری شد.`, change });
  }

  // 4) missed moves and avoided falls, per asset
  const depRet = dep?.returnPct ?? 0;
  const missed = r.attribution.filter((a) => isNum(a.marketPct) && a.marketPct >= Math.max(12, 1.5 * depRet) && a.daysHeld / Math.max(1, m.days) < 0.2);
  if (missed.length) {
    const change = bump(() => {
      p.entryShift -= Math.min(3, 2 * lr * missed.length);
      for (const a of missed) p.assetTrust[a.asset] += 0.06 * lr;
    }, 'آستانه ورود کمی آسان‌تر و اعتماد به این دارایی‌ها بیشتر شد');
    lessons.push({ code: 'missed_move', tone: 'mistake', evidence: missed.length, title: 'جاماندن از رشد', detail: `${missed.map((a) => `${a.label} (${fmtPct(a.marketPct, 0)})`).join('، ')} رشد قابل‌توجهی داشت اما کمتر از ۲۰٪ زمان در سبد بود.`, change });
  }
  const avoided = r.attribution.filter((a) => isNum(a.marketPct) && a.marketPct <= -10 && a.daysHeld / Math.max(1, m.days) < 0.2);
  if (avoided.length) lessons.push({ code: 'avoided_fall', tone: 'good', evidence: avoided.length, title: 'دوری از افت', detail: `از افت ${avoided.map((a) => `${a.label} (${fmtPct(a.marketPct, 0)})`).join('، ')} عمدتاً دور ماند.`, change: null });

  // 5) costs eating the edge
  const pnlBeforeFees = m.pnlToman - m.interestToman + m.feesToman;
  const tradesPerMonth = m.trades / Math.max(1, m.days / 30);
  if (m.feesToman > m.startEquity * 0.004 && tradesPerMonth > 5 && (pnlBeforeFees <= 0 || m.feesToman > 0.35 * pnlBeforeFees)) {
    const change = bump(() => {
      p.bandMult += 0.15 * lr;
      p.cooldownDays += 1 * lr;
    }, 'باند بازتنظیم پهن‌تر شد تا معاملات کوچک کمتر شود');
    lessons.push({ code: 'fee_drag', tone: 'mistake', evidence: m.trades, title: 'کارمزد بیش از حد', detail: `${fmtNum(tradesPerMonth, 1)} معامله در ماه و ${fmtInt(m.feesToman)} تومان کارمزد و اسپرد؛ ${pnlBeforeFees <= 0 ? 'سود پیش از کارمزد صفر یا منفی بود' : `حدود ${fmtPct((m.feesToman / pnlBeforeFees) * 100, 0, false)} سود پیش از کارمزد صرف هزینه شد`}.`, change });
  }

  // 6) news: did news-led entries go the way the news said?
  const newsRts = rts.filter((t) => Math.abs(t.entry.newsScore) >= 5);
  if (newsRts.length >= 3) {
    const aligned = newsRts.filter((t) => Math.sign(t.entry.newsScore) === Math.sign(t.returnPct)).length / newsRts.length;
    if (aligned < 0.4) {
      const change = bump(() => (p.weights.news -= 0.15 * lr), 'وزن اخبار کمتر شد');
      lessons.push({ code: 'news_misread', tone: 'mistake', evidence: newsRts.length, title: 'برداشت نادرست از اخبار', detail: `فقط ${fmtPct(aligned * 100, 0, false)} از ${fmtInt(newsRts.length)} ورودی که خبر در آن اثر جدی داشت، هم‌جهت با خبر نتیجه داد.`, change });
    } else if (aligned > 0.65) {
      const change = bump(() => (p.weights.news += 0.1 * lr), 'وزن اخبار بیشتر شد');
      lessons.push({ code: 'news_helped', tone: 'good', evidence: newsRts.length, title: 'اخبار کمک کرد', detail: `${fmtPct(aligned * 100, 0, false)} از ${fmtInt(newsRts.length)} ورود خبری هم‌جهت با خبر نتیجه داد.`, change });
    }
  }

  // 7) credit assignment for the price-based signal parts (news handled above)
  const credit: Partial<Record<SignalComponent, number[]>> = {};
  for (const t of rts) {
    const c = t.entry.components;
    if (!c) continue;
    const parts = SIGNAL_COMPONENTS.filter(({ key }) => key !== 'news');
    const norm = parts.reduce((s, { key }) => s + Math.abs(c[key]), 0);
    if (norm < 1) continue;
    const outcome = Math.tanh(t.returnPct / 8);
    for (const { key } of parts) (credit[key] ??= []).push((outcome * c[key]) / norm);
  }
  const moved: string[] = [];
  for (const { key } of SIGNAL_COMPONENTS) {
    const g = credit[key];
    if (!g || g.length < 3 || g.every((v) => v === 0)) continue;
    const delta = 0.6 * lr * mean(g);
    if (Math.abs(delta) < 0.01) continue;
    p.weights[key] += delta;
    moved.push(`${COMPONENT_LABEL[key]} ${delta > 0 ? '↑' : '↓'}`);
  }
  if (moved.length) {
    changes.push('وزن اجزای سیگنال بر اساس نتیجه معاملات تنظیم شد');
    lessons.push({ code: 'credit', tone: 'info', evidence: closed, title: 'کدام نشانه‌ها درست گفتند', detail: `بر پایه ${fmtInt(closed)} موقعیت بسته‌شده، سهم هر نشانه در ورودهای موفق و ناموفق سنجیده شد: ${moved.join('، ')}.`, change: 'وزن اجزای سیگنال تنظیم شد' });
  }

  // 8) per-asset trust from each asset's contribution
  for (const a of r.attribution) {
    if (!a.trades) continue;
    const share = (a.realizedToman + a.unrealizedToman) / (m.startEquity * 0.05);
    if (lr > 0) p.assetTrust[a.asset] *= Math.exp(0.25 * lr * Math.tanh(share));
  }

  // 9) overall verdict
  const passive = r.benchmarks.filter((b) => b.key !== 'strategy').sort((a, b) => b.returnPct - a.returnPct)[0];
  if (dep && m.returnPct < dep.returnPct && m.avgExposurePct > 40) {
    const change = bump(() => (p.entryShift += 1.5 * lr), 'آستانه ورود کمی سخت‌تر شد');
    lessons.push({ code: 'risk_unpaid', tone: 'mistake', evidence: 1, title: 'ریسک جبران نشد', detail: `با ${fmtPct(m.avgExposurePct, 0, false)} درگیری میانگین در بازار، بازده ${fmtPct(m.returnPct, 1)} از سپرده (${fmtPct(dep.returnPct, 1)}) کمتر شد.`, change });
  } else if (passive && m.returnPct >= passive.returnPct) {
    lessons.push({ code: 'beat_passive', tone: 'good', evidence: 1, title: 'بهتر از همه گزینه‌های منفعل', detail: `بازده ${fmtPct(m.returnPct, 1)} از بهترین گزینه منفعل («${passive.label}» با ${fmtPct(passive.returnPct, 1)}) بهتر بود.`, change: null });
  }

  const after = normalizeParams({ ...p, version: before.version });
  let deltas = diffParams(before, after);
  let applied = true;
  let reason: string | null = null;
  if (newFraction < 0.2) {
    applied = false;
    reason = `${fmtPct((1 - newFraction) * 100, 0, false)} این بازه قبلاً آموزش داده شده بود؛ تکرار همان دوره فقط موتور را روی گذشته بیش‌برازش می‌کند، پس پارامترها تغییر نکرد.`;
  } else if (closed < 1 && !missed.length) {
    applied = false;
    reason = 'هیچ موقعیتی کامل بسته نشد؛ نمونه برای نتیجه‌گیری کافی نیست.';
  } else if (!deltas.length) {
    applied = false;
    reason = 'نتیجه این دوره تغییر معناداری در پارامترها ایجاد نکرد.';
  }
  if (!applied) deltas = [];
  if (!lessons.length) lessons.push({ code: 'none', tone: 'info', evidence: closed, title: 'خطای الگودار دیده نشد', detail: `در ${fmtInt(closed)} موقعیت بسته‌شده الگوی تکرارشونده‌ای از خطا پیدا نشد.`, change: null });

  return {
    applied, reason, lr, newFraction, closedRoundTrips: closed, lessons, flags, deltas, before,
    after: applied ? { ...after, version: before.version + 1 } : before,
  };
}
