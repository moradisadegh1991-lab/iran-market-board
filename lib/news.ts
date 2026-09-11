// News for the simulated trader: fetched per calendar month × topic, cached (past months never change),
// deduplicated, then scored by a transparent rule lexicon into per-asset directional effects.
// Every scored item keeps the exact rule labels that fired, so each trade reason can cite "which fact, from which headline".
import { createHash } from 'node:crypto';
import { kv } from '@/lib/store';
import { errMsg } from '@/lib/http';
import { normSymbol, tehranDate } from '@/lib/num';
import { fetchGdeltNews, fetchGoogleNews, type RawNews } from '@/lib/sources/news';
import type { ScoredNews, SimAsset } from '@/lib/engine/simulator';

interface Topic {
  id: string;
  lang: 'fa' | 'en';
  q: string;
  gdelt?: string; // English query for the GDELT fallback
  assets: SimAsset[];
}

export const NEWS_TOPICS: Topic[] = [
  { id: 'fx', lang: 'fa', q: 'قیمت دلار بازار ارز', gdelt: '(Iran rial OR "Iranian currency")', assets: ['usd', 'coin', 'g18'] },
  { id: 'gold', lang: 'fa', q: 'قیمت طلا سکه امامی', assets: ['g18', 'coin'] },
  { id: 'tse', lang: 'fa', q: 'بورس تهران شاخص کل', gdelt: '("Tehran Stock Exchange")', assets: ['tse'] },
  { id: 'iran-policy', lang: 'fa', q: 'مذاکرات هسته ای OR تحریم ایران OR مکانیسم ماشه', gdelt: '(Iran sanctions OR "Iran nuclear")', assets: ['usd', 'coin', 'g18', 'tse'] },
  { id: 'global-gold', lang: 'en', q: 'gold price Fed', gdelt: '("gold price" Fed)', assets: ['g18', 'coin'] },
  { id: 'crypto', lang: 'en', q: 'bitcoin price', gdelt: '(bitcoin price)', assets: ['btc', 'eth'] },
  { id: 'crypto-reg', lang: 'en', q: 'crypto ETF OR SEC crypto OR ethereum', gdelt: '(ethereum OR "crypto ETF")', assets: ['btc', 'eth'] },
];

// ─────────────────────────── lexicon ───────────────────────────

type Effects = Partial<Record<SimAsset, number>>;
interface Rule {
  re: RegExp;
  fx: Effects;
  fact: string; // Persian label shown in trade reasons
  weight: number; // 1 = fundamental driver, 0.4 = price report (echo of the move itself)
}

const R = (src: string) => new RegExp(src, 'i');

export const NEWS_RULES: Rule[] = [
  // Iran — sanctions, diplomacy, geopolitics
  { re: R('توافق (هسته|ایران|تهران|با آمریکا)|احیای برجام|رفع تحریم|لغو تحریم|آزادسازی (منابع|پول|دارایی)|پیشرفت (در )?مذاکرات|sanctions? (relief|lifted|eased)|nuclear deal (reached|agreed|revived)'), fx: { usd: -0.8, coin: -0.6, g18: -0.5, tse: 0.6 }, fact: 'نشانه توافق یا کاهش تحریم', weight: 1 },
  { re: R('تحریم(‌| )?(های)? ?جدید|تشدید تحریم|مکانیسم ماشه|اسنپ ?بک|بازگشت تحریم|شکست مذاکرات|توقف مذاکرات|قطعنامه (علیه|شورای حکام)|snap ?back|new sanctions|talks (collapse|stall|fail)'), fx: { usd: 0.8, coin: 0.7, g18: 0.5, tse: -0.6 }, fact: 'تشدید تحریم یا شکست مذاکره', weight: 1 },
  { re: R('حمله (به|هوایی|نظامی|اسرائیل)|درگیری نظامی|تنش نظامی|جنگ (با|ایران|منطقه)|تهدید نظامی|strikes? on iran|israel(i)? (strike|attack)|military escalation|war with iran'), fx: { usd: 0.7, coin: 0.7, g18: 0.6, tse: -0.8, btc: -0.2, eth: -0.2 }, fact: 'تنش ژئوپلیتیک', weight: 1 },
  { re: R('آتش ?بس|کاهش تنش|توقف درگیری|ceasefire|de-?escalation'), fx: { usd: -0.5, coin: -0.4, g18: -0.3, tse: 0.5 }, fact: 'کاهش تنش ژئوپلیتیک', weight: 1 },
  { re: R('تورم .{0,20}(افزایش|رکورد|بالا|صعود)|نرخ تورم .{0,12}(رسید|درصد)|رشد نقدینگی|افزایش نقدینگی|چاپ پول'), fx: { usd: 0.4, coin: 0.4, g18: 0.4, tse: 0.2 }, fact: 'فشار تورمی و رشد نقدینگی', weight: 0.8 },
  { re: R('(بانک مرکزی|مرکز مبادله).{0,30}(عرضه|تزریق|کنترل|مهار).{0,10}(ارز|دلار)|مداخله .{0,10}بازار ارز'), fx: { usd: -0.4, coin: -0.2 }, fact: 'مداخله بانک مرکزی در بازار ارز', weight: 0.7 },
  { re: R('افزایش نرخ (سود|بهره) (بانکی|سپرده|اوراق)|نرخ سود .{0,12}(افزایش|بالا رفت)|انتشار اوراق با نرخ'), fx: { tse: -0.5, usd: -0.2 }, fact: 'افزایش نرخ سود بدون ریسک', weight: 0.8 },
  { re: R('کاهش نرخ (سود|بهره) (بانکی|سپرده|اوراق)|صندوق (توسعه|تثبیت).{0,20}(ورود|خرید|حمایت)|بسته حمایتی (از )?بورس|تزریق .{0,15}(به )?بورس'), fx: { tse: 0.5 }, fact: 'سیاست حمایتی از بازار سهام', weight: 0.8 },
  { re: R('افزایش قیمت (بنزین|حامل|خودرو)|آزادسازی قیمت|یکسان ?سازی نرخ ارز|حذف ارز (دولتی|نیمایی|۴۲۰۰|4200)'), fx: { usd: 0.3, coin: 0.3, g18: 0.3, tse: 0.3 }, fact: 'اصلاح قیمت‌های دستوری (تورم‌زا)', weight: 0.7 },
  { re: R('قیمت نفت .{0,15}(جهش|افزایش|صعود)|oil (prices? )?(surge|jump|soar)'), fx: { tse: 0.25, usd: -0.1 }, fact: 'رشد قیمت نفت', weight: 0.5 },

  // Global macro — gold & crypto
  { re: R('(fed|federal reserve|powell|فدرال رزرو).{0,40}(cut|lower|ease|کاهش).{0,15}(rates?|نرخ)|rate cuts?|کاهش نرخ بهره آمریکا'), fx: { g18: 0.5, coin: 0.4, btc: 0.5, eth: 0.5 }, fact: 'انتظار کاهش نرخ بهره آمریکا', weight: 1 },
  { re: R('(fed|federal reserve|powell|فدرال رزرو).{0,40}(hike|raise|hawkish|higher for longer|افزایش)|rate hikes?'), fx: { g18: -0.4, coin: -0.3, btc: -0.5, eth: -0.5 }, fact: 'سیاست انقباضی فدرال رزرو', weight: 1 },
  { re: R('(dollar index|dxy|us dollar).{0,20}(falls|weakens|slides|drops)'), fx: { g18: 0.3, coin: 0.2, btc: 0.2 }, fact: 'تضعیف دلار جهانی', weight: 0.6 },
  { re: R('(dollar index|dxy|us dollar).{0,20}(rises|strengthens|rallies|jumps)'), fx: { g18: -0.3, coin: -0.2, btc: -0.2 }, fact: 'تقویت دلار جهانی', weight: 0.6 },
  { re: R('central banks?.{0,20}(buy|buying|purchases?).{0,10}gold|خرید طلا (توسط|بانک‌های) مرکزی'), fx: { g18: 0.4, coin: 0.3 }, fact: 'خرید طلای بانک‌های مرکزی', weight: 0.8 },
  { re: R('recession|stock market (crash|sell-?off|plunge)|risk-?off|رکود جهانی'), fx: { g18: 0.3, coin: 0.2, btc: -0.4, eth: -0.5 }, fact: 'نگرانی رکود و فرار از ریسک', weight: 0.8 },
  { re: R('(bitcoin|btc|crypto) etfs?.{0,20}(inflows?|approv|record)|spot (bitcoin|ether) etf'), fx: { btc: 0.6, eth: 0.4 }, fact: 'ورود سرمایه به ETFهای کریپتو', weight: 1 },
  { re: R('(bitcoin|btc|crypto) etfs?.{0,20}outflows?'), fx: { btc: -0.5, eth: -0.4 }, fact: 'خروج سرمایه از ETFهای کریپتو', weight: 1 },
  { re: R('(hack|exploit|bankrupt|insolven|collapse|هک).{0,30}(exchange|crypto|defi|صرافی)|(exchange|صرافی).{0,20}(hacked|هک شد)'), fx: { btc: -0.5, eth: -0.7 }, fact: 'هک یا ورشکستگی در بازار کریپتو', weight: 1 },
  { re: R('(sec|regulator|doj|cftc).{0,30}(sues|lawsuit|crackdown|charges|ban)|crypto ban'), fx: { btc: -0.4, eth: -0.5 }, fact: 'فشار نظارتی بر کریپتو', weight: 0.9 },
  { re: R('(strategic )?bitcoin reserve|treasur(y|ies) (buy|add).{0,10}bitcoin|companies? (buy|add).{0,10}bitcoin'), fx: { btc: 0.5, eth: 0.2 }, fact: 'خرید نهادی بیت‌کوین', weight: 0.9 },
  { re: R('ethereum.{0,20}(upgrade|hard fork|pectra|dencun)|ether etf.{0,10}(approv|inflow)'), fx: { eth: 0.5 }, fact: 'رویداد مثبت شبکه اتریوم', weight: 0.8 },

  // Price reports — low weight: they echo the move, they don't cause it
  { re: R('(دلار|ارز|یورو).{0,25}(صعود|افزایش|جهش|رکورد|گران)'), fx: { usd: 0.5 }, fact: 'گزارش رشد دلار', weight: 0.4 },
  { re: R('(دلار|ارز|یورو).{0,25}(کاهش|ریزش|سقوط|عقب ?نشینی|ارزان|افت)'), fx: { usd: -0.5 }, fact: 'گزارش افت دلار', weight: 0.4 },
  { re: R('(طلا|سکه).{0,25}(صعود|افزایش|جهش|رکورد|گران)|gold.{0,20}(record|all-time high|surges|rallies)'), fx: { g18: 0.5, coin: 0.5 }, fact: 'گزارش رشد طلا و سکه', weight: 0.4 },
  { re: R('(طلا|سکه).{0,25}(کاهش|ریزش|سقوط|ارزان|افت)|gold.{0,20}(slumps|tumbles|falls|drops)'), fx: { g18: -0.5, coin: -0.5 }, fact: 'گزارش افت طلا و سکه', weight: 0.4 },
  { re: R('(بورس|شاخص( کل)?).{0,20}(سبز|صعود|رشد|رکورد|مثبت)'), fx: { tse: 0.5 }, fact: 'گزارش رشد بورس', weight: 0.4 },
  { re: R('(بورس|شاخص( کل)?).{0,20}(قرمز|ریزش|سقوط|افت|منفی|خروج پول)'), fx: { tse: -0.5 }, fact: 'گزارش افت بورس', weight: 0.4 },
  { re: R('(bitcoin|btc|crypto|بیت ?کوین).{0,25}(surges?|rall(y|ies)|record|jumps|soars|صعود|رکورد)'), fx: { btc: 0.4, eth: 0.3 }, fact: 'گزارش رشد کریپتو', weight: 0.4 },
  { re: R('(bitcoin|btc|crypto|بیت ?کوین).{0,25}(plunges?|drops|crash|tumbles|slides|سقوط|ریزش)'), fx: { btc: -0.4, eth: -0.4 }, fact: 'گزارش افت کریپتو', weight: 0.4 },
];

const normText = (s: string) => normSymbol(s).replace(/\u200c/g, ' ').replace(/\s+/g, ' ').toLowerCase();

export function scoreHeadline(title: string): { effects: Effects; facts: string[]; weight: number } | null {
  const t = normText(title);
  const effects: Effects = {};
  const facts: string[] = [];
  let weight = 0;
  for (const rule of NEWS_RULES) {
    if (!rule.re.test(t)) continue;
    facts.push(rule.fact);
    weight = Math.max(weight, rule.weight);
    for (const [k, v] of Object.entries(rule.fx) as [SimAsset, number][]) effects[k] = Math.max(-1, Math.min(1, (effects[k] ?? 0) + v * rule.weight));
  }
  return facts.length ? { effects, facts, weight } : null;
}

// ─────────────────────────── loading ───────────────────────────

interface Chunk {
  topic: Topic;
  after: string; // first day of month
  before: string; // first day of next month (exclusive)
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function monthChunks(start: string, end: string, topics: Topic[]): Chunk[] {
  const out: Chunk[] = [];
  let y = +start.slice(0, 4), m = +start.slice(5, 7);
  const endKey = +end.slice(0, 4) * 12 + +end.slice(5, 7);
  while (y * 12 + m <= endKey) {
    const after = `${y}-${String(m).padStart(2, '0')}-01`;
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    const before = `${ny}-${String(nm).padStart(2, '0')}-01`;
    for (const topic of topics) out.push({ topic, after, before });
    y = ny;
    m = nm;
  }
  return out;
}

export interface NewsLoad {
  items: ScoredNews[];
  reviewed: number; // headlines read (before relevance filtering)
  chunksTotal: number;
  chunksLoaded: number;
  sources: string[];
  errors: string[];
}

export async function loadNews(start: string, end: string, assets: SimAsset[], deadlineMs: number): Promise<NewsLoad> {
  const topics = NEWS_TOPICS.filter((t) => t.assets.some((a) => assets.includes(a)));
  const chunks = monthChunks(addDays(start, -12), end, topics);
  const today = tehranDate();
  const errors: string[] = [];
  const sources = new Set<string>();
  let loaded = 0;
  const raw: RawNews[] = [];

  async function loadChunk(c: Chunk) {
    const key = `news:v1:${c.topic.id}:${c.after}`;
    const cached = await kv.get<{ items: RawNews[]; via: string }>(key);
    if (cached) {
      raw.push(...cached.items);
      sources.add(cached.via);
      loaded++;
      return;
    }
    if (Date.now() > deadlineMs) return;
    let items: RawNews[] = [];
    let via = 'Google News';
    try {
      items = await fetchGoogleNews(c.topic.q, c.after, c.before, c.topic.lang);
    } catch (e) {
      errors.push(`Google News (${c.topic.id} ${c.after}): ${errMsg(e)}`);
      if (c.topic.gdelt) {
        try {
          items = await fetchGdeltNews(c.topic.gdelt, c.after, c.before);
          via = 'GDELT';
        } catch (e2) {
          errors.push(`GDELT (${c.topic.id} ${c.after}): ${errMsg(e2)}`);
          return;
        }
      } else return;
    }
    const complete = c.before <= addDays(today, -2); // a finished month can be cached for a long time
    const slim = items.slice(0, 100).map((i) => ({ ...i, title: i.title.slice(0, 220) }));
    await kv.set(key, { items: slim, via }, complete ? 120 * 86400 : 6 * 3600);
    raw.push(...slim);
    sources.add(via);
    loaded++;
  }

  // small worker pool: polite to Google and bounded by the request deadline
  const queue = [...chunks];
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      while (queue.length) await loadChunk(queue.shift()!);
    }),
  );

  const seen = new Set<string>();
  const items: ScoredNews[] = [];
  for (const r of raw.sort((a, b) => a.ms - b.ms)) {
    const date = tehranDate(new Date(r.ms));
    if (date < addDays(start, -12) || date > end) continue;
    const norm = normText(r.title).replace(/[^\p{L}\p{N} ]/gu, '').slice(0, 90);
    if (seen.has(norm)) continue;
    seen.add(norm);
    const sc = scoreHeadline(r.title);
    if (!sc) continue;
    const effects = Object.fromEntries(Object.entries(sc.effects).filter(([k, v]) => assets.includes(k as SimAsset) && Math.abs(v!) >= 0.05));
    if (!Object.keys(effects).length) continue;
    items.push({
      id: createHash('sha1').update(norm).digest('hex').slice(0, 12),
      date,
      ms: r.ms,
      title: r.title,
      source: r.source,
      url: r.url,
      effects,
      facts: sc.facts,
      weight: sc.weight,
    });
  }
  return { items, reviewed: seen.size, chunksTotal: chunks.length, chunksLoaded: loaded, sources: [...sources], errors: errors.slice(0, 6) };
}
