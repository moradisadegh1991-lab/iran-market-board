// «چرا این پیش‌بینی؟» (rule 94) — the pure half. Everything here only DESCRIBES a forecast that is already made:
// where each of the three readings put the median, what happened after the past days that looked like today, the trend
// and volatility the cone rests on, and the recent headlines. None of it feeds back into the numbers — on real prices
// 2016–2026 adding the news score to the forecast did not make it better in the years held out
// (scripts/eval/forecast-news-eval.ts), so news is context here, never an input. A test locks that: the files that
// compute the forecast never import the news modules.
import type { ScoredNews, SimAsset } from './simulator';

const DAY = 86_400_000;
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const addDays = (iso: string, n: number) => new Date(dayMs(iso) + n * DAY).toISOString().slice(0, 10);

// ── what happened after the days that looked like today ──

export interface AnalogPath {
  date: string;
  /** the move over the whole horizon, percent */
  movePct: number;
  /** [days since that day, percent from that day's price] — from 0 to the horizon */
  path: [number, number][];
}

/**
 * For each matched past day, the price path over the next `days` (sampled at `steps` + 1 points), as percent from that day.
 * Only rows up to date + days are read, and a match is only ever a day whose outcome was already known (forecast-model.ts),
 * so the path ends at the same move the forecast counted.
 */
export function analogPaths(dates: string[], prices: number[], matches: { date: string; movePct: number }[], days: number, steps = 24): AnalogPath[] {
  const index = new Map(dates.map((d, i) => [d, i] as const));
  const out: AnalogPath[] = [];
  for (const m of matches) {
    const i = index.get(m.date);
    if (i === undefined) continue;
    const path: [number, number][] = [];
    let j = i;
    for (let k = 0; k <= steps; k++) {
      const day = Math.round((days * k) / steps);
      const target = dayMs(dates[i]) + day * DAY;
      while (j < dates.length && dayMs(dates[j]) < target) j++;
      if (j >= dates.length) break;
      path.push([day, (prices[j] / prices[i] - 1) * 100]);
    }
    if (path.length >= 2) out.push({ date: m.date, movePct: m.movePct, path });
  }
  return out;
}

// ── trend and volatility the cone rests on ──

export interface TrendFacts {
  ret1mPct: number | null;
  ret3mPct: number | null;
  /** distance of today's price from its 200-row average, percent; null with fewer than 200 rows */
  vsMa200Pct: number | null;
}

function onOrBefore(dates: string[], prices: number[], iso: string): number | null {
  let lo = 0;
  let hi = dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (dates[m] <= iso) {
      ans = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return ans >= 0 ? prices[ans] : null;
}

export function trendFacts(dates: string[], prices: number[], today: number): TrendFacts {
  const n = dates.length;
  if (!n) return { ret1mPct: null, ret3mPct: null, vsMa200Pct: null };
  const last = dates[n - 1];
  const back = (d: number) => {
    const p = onOrBefore(dates, prices, addDays(last, -d));
    return p && p > 0 ? (today / p - 1) * 100 : null;
  };
  let ma: number | null = null;
  if (n >= 200) {
    let s = 0;
    for (let k = n - 200; k < n; k++) s += prices[k];
    ma = s / 200;
  }
  return { ret1mPct: back(30), ret3mPct: back(91), vsMa200Pct: ma ? (today / ma - 1) * 100 : null };
}

// ── who pulled the forecast where ──

export interface PartView {
  lowPct: number;
  midPct: number;
  highPct: number;
  pUp: number;
}
export type PartKey = 'engine' | 'empirical' | 'analog';
export const PART_KEYS: PartKey[] = ['engine', 'empirical', 'analog'];

/**
 * The ensemble is the plain average of the three readings' quantiles in log space, so each reading's median minus the
 * average median is exactly how far it pulled the forecast; the three pulls add up to zero. In percentage points of log move.
 */
export function pulls(parts: Record<PartKey, PartView>): Record<PartKey, number> {
  const lg = (pct: number) => Math.log(1 + pct / 100) * 100;
  const mids = PART_KEYS.map((k) => lg(parts[k].midPct));
  const avg = mids.reduce((s, x) => s + x, 0) / mids.length;
  return { engine: mids[0] - avg, empirical: mids[1] - avg, analog: mids[2] - avg };
}

// ── news: context only ──

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'over', 'into', 'after', 'amid', 'says', 'said', 'will', 'its', 'are', 'was', 'has', 'have', 'not', 'but', 'new', 'about']);
const storyWords = (title: string) => new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)));
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / (a.size + b.size - n);
}

/** the facts of the global-macro rules (lib/news.ts) — the only ones that concern a dollar-priced gold price */
const GLOBAL_GOLD_FACTS = new Set(['انتظار کاهش نرخ بهره آمریکا', 'سیاست انقباضی فدرال رزرو', 'تضعیف دلار جهانی', 'تقویت دلار جهانی', 'خرید طلای بانک‌های مرکزی', 'نگرانی رکود و فرار از ریسک']);

/** which lexicon asset a forecast asset reads its headlines from */
export const NEWS_ASSET: Record<string, SimAsset | null> = { usd: 'usd', usdt: 'usd', coin: 'coin', nim: 'coin', rob: 'coin', g18: 'g18', silver: 'g18', ons: 'g18', tse: 'tse', btc: 'btc', eth: 'eth' };

export interface NewsHeadline {
  date: string;
  title: string;
  source: string;
  url: string;
  /** how many outlets carried this same story (this one included) */
  outlets: number;
  /** signed push on this asset's price, −1..+1, after the headline's own weight */
  effect: number;
  /** the facts the lexicon matched, in Persian */
  facts: string[];
}
export interface NewsView {
  asset: string;
  /** the window the daily score covers */
  from: string;
  to: string;
  daily: { date: string; score: number }[];
  headlines: NewsHeadline[];
  /** headlines in the window, and how many push up / down */
  count: number;
  up: number;
  down: number;
  /** sum of the daily scores over the last `netDays` */
  net: number;
  netDays: number;
  tone: 'up' | 'down' | 'mixed' | 'none';
}

/**
 * The recent headlines as the forecast page shows them. A headline counts when the lexicon reads a push on this asset;
 * its effect is the lexicon's direction × the rule's weight (a report of the move itself weighs less than a cause).
 * Nothing dated after `asOf` is read. For gold priced in dollars (ons) only the global-macro facts count — Iran's
 * sanctions move the rial price of gold, not the ounce.
 */
export function newsView(items: ScoredNews[], assetKey: string, asOf: string, opts: { days?: number; netDays?: number; maxHeadlines?: number } = {}): NewsView | null {
  const sim = NEWS_ASSET[assetKey];
  if (!sim) return null;
  const days = opts.days ?? 45;
  const netDays = opts.netDays ?? 14;
  const from = addDays(asOf, -(days - 1));
  const raw: { it: ScoredNews; effect: number; words: Set<string> }[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (it.date < from || it.date > asOf) continue;
    const e = it.effects[sim];
    if (!e) continue;
    if (assetKey === 'ons' && !it.facts.some((f) => GLOBAL_GOLD_FACTS.has(f))) continue;
    const key = it.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    raw.push({ it, effect: Math.max(-1, Math.min(1, e * it.weight)), words: storyWords(it.title) });
  }
  // one story, one push: the same event carried by five outlets is five headlines but one piece of news
  const stories: { rep: (typeof raw)[number]; words: Set<string>; date: string; outlets: Set<string> }[] = [];
  for (const r of raw.sort((a, b) => (a.it.date < b.it.date ? -1 : a.it.date > b.it.date ? 1 : 0))) {
    const hit = stories.find((st) => Math.sign(st.rep.effect) === Math.sign(r.effect) && Math.abs(dayMs(r.it.date) - dayMs(st.date)) <= 4 * DAY && jaccard(st.words, r.words) >= 0.4);
    if (hit) {
      hit.outlets.add(r.it.source);
      if (Math.abs(r.effect) > Math.abs(hit.rep.effect)) hit.rep = r;
      for (const w of r.words) hit.words.add(w);
    } else stories.push({ rep: r, words: new Set(r.words), date: r.it.date, outlets: new Set([r.it.source]) });
  }
  const rows: NewsHeadline[] = stories.map((st) => ({
    date: st.rep.it.date,
    title: st.rep.it.title,
    source: st.rep.it.source,
    url: st.rep.it.url,
    outlets: st.outlets.size,
    effect: st.rep.effect,
    facts: st.rep.it.facts,
  }));
  const score = new Map<string, number>();
  for (const r of rows) score.set(r.date, (score.get(r.date) ?? 0) + r.effect);
  const daily: { date: string; score: number }[] = [];
  for (let k = 0; k < days; k++) {
    const d = addDays(from, k);
    daily.push({ date: d, score: score.get(d) ?? 0 });
  }
  const netFrom = addDays(asOf, -(netDays - 1));
  const net = daily.filter((x) => x.date >= netFrom).reduce((s, x) => s + x.score, 0);
  const recent = rows.filter((r) => r.date >= netFrom);
  const up = recent.filter((r) => r.effect > 0).length;
  const down = recent.filter((r) => r.effect < 0).length;
  // the headlines worth reading: strongest pushes first, newest among equals
  const headlines = rows
    .slice()
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect) || (a.date < b.date ? 1 : -1))
    .slice(0, opts.maxHeadlines ?? 8)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const tone: NewsView['tone'] = !recent.length ? 'none' : Math.abs(net) < 1 || (up > 0 && down > 0 && Math.min(up, down) / Math.max(up, down) >= 0.6) ? 'mixed' : net > 0 ? 'up' : 'down';
  return { asset: assetKey, from, to: asOf, daily, headlines, count: rows.length, up, down, net, netDays, tone };
}

// ── the reasons, in words ──

export interface Reason {
  id: 'agree' | 'analog' | 'trend' | 'vol' | 'news';
  tone: 'up' | 'down' | 'flat' | 'warn';
  title: string;
  text: string;
  /** does this reason change the forecast's numbers? false for the news */
  inNumbers: boolean;
}

export interface ReasonInput {
  hLabel: string;
  /** the combined forecast's median and 90% band, percent */
  midPct: number;
  lowPct: number;
  highPct: number;
  pUp: number | null;
  parts: Record<PartKey, PartView> | null;
  analog: { n: number; matches: { date: string; movePct: number }[] } | null;
  trend: TrendFacts | null;
  annualVolPct: number | null;
  news: NewsView | null;
}

const fa = (n: number, d = 0) => n.toLocaleString('fa-IR', { maximumFractionDigits: d, minimumFractionDigits: d });
const sgn = (n: number, d = 0) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fa(Math.abs(n), d)}٪`;
export const PART_LABEL: Record<PartKey, string> = { engine: 'موتور سناریو', empirical: 'حرکت‌های گذشته', analog: 'الگوهای مشابه' };

export function forecastReasons(i: ReasonInput): Reason[] {
  const out: Reason[] = [];
  const width = i.highPct - i.lowPct;

  if (i.parts) {
    const p = pulls(i.parts);
    const mids = PART_KEYS.map((k) => i.parts![k].midPct);
    const spread = Math.max(...mids) - Math.min(...mids);
    const agree = width > 0 && spread <= 0.15 * width;
    const big = PART_KEYS.reduce((a, k) => (Math.abs(p[k]) > Math.abs(p[a]) ? k : a), 'engine' as PartKey);
    out.push({
      id: 'agree',
      tone: agree ? 'flat' : 'warn',
      title: agree ? 'سه نگاه هم‌نظرند' : 'سه نگاه اختلاف دارند',
      text:
        `میانه ${PART_LABEL.engine} ${sgn(mids[0])}، ${PART_LABEL.empirical} ${sgn(mids[1])} و ${PART_LABEL.analog} ${sgn(mids[2])} است؛ میانگینشان ${sgn(i.midPct)} می‌شود. ` +
        (agree ? 'فاصله‌شان نسبت به پهنای محدوده کم است، پس میانگین به هر کدام نزدیک است.' : `بیشترین کشش از «${PART_LABEL[big]}» است (${p[big] > 0 ? 'به سمت بالا' : 'به سمت پایین'}، ${fa(Math.abs(p[big]), 1)} واحد درصد)؛ وقتی نگاه‌ها اختلاف دارند، به عدد میانه کمتر تکیه کنید و به پهنای محدوده بیشتر.`),
      inNumbers: true,
    });
  } else {
    out.push({ id: 'agree', tone: 'flat', title: 'فقط موتور سناریو', text: 'برای این دارایی ترکیب سه‌نگاهی روی داده واقعی آزموده نشده و عدد همان موتور سناریوست (نوسان و روند ۱۵ ماه اخیر).', inNumbers: true });
  }

  if (i.parts && i.analog && i.analog.n > 0) {
    const a = i.parts.analog;
    const ms = i.analog.matches;
    const upN = ms.filter((m) => m.movePct > 0).length;
    out.push({
      id: 'analog',
      tone: a.pUp >= 0.58 ? 'up' : a.pUp <= 0.42 ? 'down' : 'flat',
      title: 'روزهای مشابه گذشته',
      text:
        `${fa(i.analog.n)} روز از تاریخچه از نظر بازده یک هفته تا یک سال، نوسان و فاصله از میانگین ۲۰۰ روزه شبیه امروز بود؛ ${i.hLabel} بعدشان در ${pctShare(a.pUp)} موارد قیمت بالاتر بود و میانه ${sgn(a.midPct)}.` +
        (ms.length ? ` از ${fa(ms.length)} نمونه نزدیک‌تر، ${fa(upN)} تا بالاتر و ${fa(ms.length - upN)} تا پایین‌تر رفتند.` : ''),
      inNumbers: true,
    });
  }

  if (i.trend && (i.trend.ret3mPct !== null || i.trend.vsMa200Pct !== null)) {
    const t = i.trend;
    const bits: string[] = [];
    if (t.ret1mPct !== null) bits.push(`یک ماه اخیر ${sgn(t.ret1mPct, 1)}`);
    if (t.ret3mPct !== null) bits.push(`سه ماه اخیر ${sgn(t.ret3mPct, 1)}`);
    const ma = t.vsMa200Pct === null ? '' : `؛ قیمت ${fa(Math.abs(t.vsMa200Pct), 1)}٪ ${t.vsMa200Pct >= 0 ? 'بالاتر از' : 'پایین‌تر از'} میانگین ۲۰۰ روزه است`;
    const up = (t.ret3mPct ?? t.vsMa200Pct ?? 0) > 0;
    out.push({
      id: 'trend',
      tone: Math.abs(t.ret3mPct ?? t.vsMa200Pct ?? 0) < 3 ? 'flat' : up ? 'up' : 'down',
      title: 'روند اخیر',
      text: `${bits.join('، ')}${ma}. روند اخیر در شکل مخروط و در «الگوهای مشابه» وارد شده، ولی روی داده واقعی ایران هیچ قاعده روندی از نگه‌داشتن ساده بهتر نبود؛ آن را نشانه ادامه‌دار بودن نگیرید.`,
      inNumbers: true,
    });
  }

  if (i.annualVolPct !== null && width > 0) {
    out.push({
      id: 'vol',
      tone: i.annualVolPct >= 60 ? 'warn' : 'flat',
      title: 'نوسان، پهنای محدوده را می‌سازد',
      text: `نوسان سالانه این دارایی حدود ${fa(i.annualVolPct)}٪ است؛ برای همین محدوده ۹۰٪ ${i.hLabel} از ${sgn(i.lowPct)} تا ${sgn(i.highPct)} باز شده (پهنا ${fa(width)} واحد درصد). نوسان بیشتر یعنی محدوده پهن‌تر، نه جهت مشخص‌تر.`,
      inNumbers: true,
    });
  }

  const n = i.news;
  if (n) {
    const word = n.tone === 'up' ? 'بیشتر خبرها فشار صعودی دارند' : n.tone === 'down' ? 'بیشتر خبرها فشار نزولی دارند' : n.tone === 'mixed' ? 'خبرها دوطرفه‌اند' : 'خبر مرتبطی دیده نشد';
    out.push({
      id: 'news',
      tone: n.tone === 'up' ? 'up' : n.tone === 'down' ? 'down' : 'flat',
      title: 'خبرهای اخیر (فقط زمینه)',
      text:
        n.tone === 'none'
          ? `در ${fa(n.netDays)} روز اخیر خبری که واژه‌نامه اپ برای این دارایی اثری بخواند پیدا نشد. اخبار در عدد پیش‌بینی دخالت ندارند.`
          : `در ${fa(n.netDays)} روز اخیر ${fa(n.up)} ماجرا با فشار صعودی و ${fa(n.down)} ماجرا با فشار نزولی خوانده شد (هر ماجرا یک بار، حتی اگر چند رسانه نوشته باشند)؛ ${word}. این‌ها در عدد پیش‌بینی دخالت ندارند: روی داده واقعی، افزودن امتیاز خبر به پیش‌بینی آن را در سال‌های ندیده بهتر نکرد.`,
      inNumbers: false,
    });
  }
  return out;
}

const pctShare = (p: number) => `${fa(Math.round(p * 100))}٪`;

/** what the evaluation found — the numbers the page quotes (scripts/eval/forecast-news-eval.ts, CLAUDE.md rule 94) */
export const NEWS_EVIDENCE = {
  period: '۱۳۹۵ تا ۱۴۰۵',
  assets: 'دلار، سکه و طلای ۱۸',
  signHitRange: '۴۱ تا ۶۳٪',
  text:
    'روی قیمت‌ها و خبرهای واقعی ۱۳۹۵ تا ۱۴۰۵ (دلار، سکه، طلای ۱۸)، امتیاز خبر را به پیش‌بینی اضافه کردیم و در سال‌هایی سنجیدیم که هنگام طراحی دیده نشده بودند. نتیجه: پیش‌بینی هفتگی در هر سه دارایی ۰٫۶ تا ۱٫۸٪ بدتر شد؛ در پیش‌بینی ماهانه برای دلار ۳٪ بدتر شد و برای سکه و طلا روی سال‌های طراحی وزنی که کمک کند پیدا نشد. جهت اثر خبر هم از سالی به سال دیگر عوض می‌شد و درست‌بودن جهتش بین ۴۱ تا ۶۳٪ بود (شیر یا خط ۵۰٪ است). برای همین خبر فقط برای فهمیدن زمینه کنار پیش‌بینی آمده، نه برای تغییر عدد.',
} as const;
