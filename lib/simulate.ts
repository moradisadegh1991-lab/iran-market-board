import { createHash } from 'node:crypto';
import { kv } from '@/lib/store';
import { errMsg } from '@/lib/http';
import { isNum, tehranDate } from '@/lib/num';
import { buildSeries, loadSeriesInputs, type AssetSeries } from '@/lib/series';
import { loadNews, type NewsLoad } from '@/lib/news';
import { DEFAULT_PARAMS, PROFILES, SIM_ASSETS, simulate, type SimAsset, type SimParams, type SimProfile, type SimResult, type SimSeries } from '@/lib/engine/simulator';
import type { LearnOutcome } from '@/lib/engine/learning';
import { applyLearning, getLearnedParams, lookupFromSeries, noveltyOf } from '@/lib/learning';

export interface SimRequest {
  start: string;
  end: string;
  capitalToman: number;
  profile: SimProfile;
  assets: SimAsset[];
  useNews: boolean;
  engine: 'learned' | 'baseline';
  learn: boolean; // admin only — checked in the route
}

export interface EngineComparison {
  baseline: { returnPct: number; maxDrawdownPct: number; trades: number; winRatePct: number | null; finalToman: number };
  learned: { returnPct: number; maxDrawdownPct: number; trades: number; winRatePct: number | null; finalToman: number };
  overlapPct: number; // share of this window the learned engine had already seen → in-sample if high
}

export interface SimResponse extends SimResult {
  news: { enabled: boolean; items: number; reviewed: number; chunksLoaded: number; chunksTotal: number; sources: string[]; errors: string[] };
  narrative: { text: string; model: string } | null;
  narrativeError: string | null;
  engine: { used: 'learned' | 'baseline'; version: number };
  comparison: EngineComparison | null;
  learning: LearnOutcome | null;
  generatedAt: string;
  cached: boolean;
}

export interface Coverage {
  today: string;
  assets: { key: SimAsset; label: string; from: string | null; to: string | null; points: number; basis: string; reconstructed: boolean }[];
  earliestStart: string | null; // first date on which at least 62 prior sessions exist for every asset that has data
  latestEnd: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function toRial(usdPriced: AssetSeries, usd: AssetSeries): { dates: string[]; prices: number[] } {
  const dates: string[] = [];
  const prices: number[] = [];
  let j = -1;
  for (let i = 0; i < usdPriced.dates.length; i++) {
    const d = usdPriced.dates[i];
    while (j + 1 < usd.dates.length && usd.dates[j + 1] <= d) j++;
    if (j < 0 || daysApart(usd.dates[j], d) > 5) continue; // no recent dollar rate → skip rather than guess
    dates.push(d);
    prices.push(usdPriced.prices[i] * usd.prices[j]);
  }
  return { dates, prices };
}
const daysApart = (a: string, b: string) => Math.abs(Date.parse(b) - Date.parse(a)) / 86400000;

export async function loadAllSeries() {
  const inp = await loadSeriesInputs();
  const usd = buildSeries(inp, 'usd');
  const ons = buildSeries(inp, 'ons');
  const series: Partial<Record<SimAsset, SimSeries>> = {};
  for (const key of ['usd', 'g18', 'coin', 'tse'] as const) {
    const s = key === 'usd' ? usd : buildSeries(inp, key);
    series[key] = { key, dates: s.dates, prices: s.prices, basis: s.basis, reconstructed: s.reconstructed };
  }
  for (const key of ['btc', 'eth'] as const) {
    const s = buildSeries(inp, key);
    const r = toRial(s, usd);
    series[key] = { key, dates: r.dates, prices: r.prices, basis: `${s.basis} × دلار ${usd.basis}`, reconstructed: true };
  }
  return { series, usd, ons };
}

export async function getCoverage(): Promise<Coverage> {
  const { series } = await loadAllSeries();
  const assets = SIM_ASSETS.map((a) => {
    const s = series[a.key];
    return { key: a.key, label: a.label, from: s?.dates[0] ?? null, to: s?.dates.at(-1) ?? null, points: s?.dates.length ?? 0, basis: s?.basis ?? '', reconstructed: s?.reconstructed ?? false };
  });
  const usable = assets.filter((a) => a.points >= 70);
  const warm = usable.map((a) => series[a.key]!.dates[61]).filter(Boolean).sort();
  return {
    today: tehranDate(),
    assets,
    earliestStart: warm.length ? warm[0] : null,
    latestEnd: usable.map((a) => a.to!).sort().at(-1) ?? null,
  };
}

export function validate(body: any): SimRequest {
  const start = String(body?.start ?? '');
  const end = String(body?.end ?? '');
  if (!ISO.test(start) || !ISO.test(end)) throw new Error('تاریخ شروع و پایان را کامل وارد کنید.');
  if (end <= start) throw new Error('تاریخ پایان باید بعد از تاریخ شروع باشد.');
  const span = daysApart(start, end);
  if (span < 20) throw new Error('بازه باید دست‌کم ۲۰ روز باشد تا معامله‌گر فرصت تصمیم داشته باشد.');
  if (span > 400) throw new Error('حداکثر بازه ۴۰۰ روز است؛ تاریخچه رایگان بیشتر از این در دسترس نیست.');
  const capitalToman = Math.round(Number(body?.capitalToman));
  if (!isNum(capitalToman) || capitalToman < 1_000_000) throw new Error('سرمایه اولیه باید دست‌کم ۱ میلیون تومان باشد.');
  if (capitalToman > 1e13) throw new Error('سرمایه اولیه بیش از حد بزرگ است.');
  const profile = (Object.keys(PROFILES).includes(body?.profile) ? body.profile : 'balanced') as SimProfile;
  const valid = SIM_ASSETS.map((a) => a.key);
  const assets = (Array.isArray(body?.assets) ? body.assets : []).filter((a: string): a is SimAsset => valid.includes(a as SimAsset));
  if (!assets.length) throw new Error('دست‌کم یک دارایی برای معامله انتخاب کنید.');
  const learn = body?.learn === true;
  const engine = learn || body?.engine !== 'baseline' ? 'learned' : 'baseline'; // learning always evaluates the learned engine
  return { start, end, capitalToman, profile, assets: [...new Set(assets)] as SimAsset[], useNews: body?.useNews !== false, engine, learn };
}

export async function runSimulation(req: SimRequest, budgetMs = 52_000): Promise<SimResponse> {
  const t0 = Date.now();
  const fixedIncomeYield = Number(process.env.FIXED_INCOME_YIELD || 0.3);
  const params: SimParams = req.engine === 'learned' ? await getLearnedParams() : DEFAULT_PARAMS;
  const { learn: _learn, ...cacheable } = req;
  const cacheKey = `sim:v2:${createHash('sha1').update(JSON.stringify({ ...cacheable, fixedIncomeYield, day: tehranDate(), pv: params.version })).digest('hex')}`;
  const hit = req.learn ? null : await kv.get<SimResponse>(cacheKey);
  if (hit && (hit.news.chunksLoaded === hit.news.chunksTotal || !req.useNews)) return { ...hit, learning: null, cached: true };

  const [{ series, usd, ons }, news] = await Promise.all([
    loadAllSeries(),
    req.useNews
      ? loadNews(req.start, req.end, req.assets, t0 + budgetMs * 0.55).catch((e): NewsLoad => ({ items: [], reviewed: 0, chunksTotal: 0, chunksLoaded: 0, sources: [], errors: [errMsg(e)] }))
      : Promise.resolve<NewsLoad>({ items: [], reviewed: 0, chunksTotal: 0, chunksLoaded: 0, sources: [], errors: [] }),
  ]);

  const simInput = {
    start: req.start,
    end: req.end,
    capitalToman: req.capitalToman,
    profile: req.profile,
    assets: req.assets,
    fixedIncomeYield,
    series,
    ons: { dates: ons.dates, prices: ons.prices },
    usdRef: { dates: usd.dates, prices: usd.prices },
    news: news.items,
  };
  const result = simulate(simInput, params);

  // honest check: does the learned engine actually beat the original rules on this same window?
  let comparison: EngineComparison | null = null;
  if (params.version > 0) {
    const base = simulate(simInput, DEFAULT_PARAMS);
    const pick = (r: SimResult) => ({ returnPct: r.metrics.returnPct, maxDrawdownPct: r.metrics.maxDrawdownPct, trades: r.metrics.trades, winRatePct: r.metrics.winRatePct, finalToman: r.metrics.finalEquity });
    const { overlapFraction } = await noveltyOf(result);
    comparison = { baseline: pick(base), learned: pick(result), overlapPct: overlapFraction * 100 };
  }
  let learning: LearnOutcome | null = null;
  if (req.learn) learning = await applyLearning(result, lookupFromSeries(series), 'backtest', `بک‌تست ${PROFILES[req.profile].label}`);
  if (req.useNews && news.chunksTotal && news.chunksLoaded < news.chunksTotal) {
    result.warnings.unshift(`اخبار ${news.chunksLoaded} از ${news.chunksTotal} بخش ماهانه دریافت شد (محدودیت زمان یا در دسترس نبودن منبع). اجرای دوباره، بخش‌های باقی‌مانده را از حافظه ادامه می‌دهد.`);
  }
  if (result.input.start > addDays(req.start, 3)) result.warnings.push('شروع واقعی شبیه‌سازی به اولین روزی که داده قیمت وجود داشت منتقل شد.');

  let narrative: SimResponse['narrative'] = null;
  let narrativeError: string | null = null;
  if (process.env.ANTHROPIC_API_KEY && Date.now() - t0 < budgetMs - 20_000) {
    try {
      narrative = await writeNarrative(result, Math.max(8_000, budgetMs - (Date.now() - t0) - 3_000));
    } catch (e) {
      narrativeError = errMsg(e);
    }
  }

  const response: SimResponse = {
    ...result,
    news: { enabled: req.useNews, items: news.items.length, reviewed: news.reviewed, chunksLoaded: news.chunksLoaded, chunksTotal: news.chunksTotal, sources: news.sources, errors: news.errors },
    narrative,
    narrativeError,
    engine: { used: req.engine, version: params.version },
    comparison,
    learning,
    generatedAt: new Date().toISOString(),
    cached: false,
  };
  await kv.set(cacheKey, response, 6 * 3600).catch(() => undefined);
  return response;
}

/** Optional: a Persian narrative written by Claude, grounded strictly on the simulation's own numbers and cited headlines. */
async function writeNarrative(r: SimResult, timeoutMs: number): Promise<{ text: string; model: string }> {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const facts = {
    window: [r.input.start, r.input.end],
    profile: PROFILES[r.input.profile].label,
    metrics: r.metrics,
    benchmarks: r.benchmarks.map((b) => ({ label: b.label, returnPct: +b.returnPct.toFixed(2) })),
    assets: r.attribution.map((a) => ({ label: a.label, marketPct: a.marketPct && +a.marketPct.toFixed(1), realizedToman: Math.round(a.realizedToman), unrealizedToman: Math.round(a.unrealizedToman), trades: a.trades })),
    trades: r.trades.slice(0, 40).map((t) => ({ n: t.n, date: t.date, asset: t.asset, side: t.side, kind: t.kind, valueToman: Math.round(t.valueToman), realizedPct: t.realizedPct && +t.realizedPct.toFixed(1), reasons: t.reasons.slice(0, 3), news: t.news.map((n) => `${n.date} ${n.source}: ${n.title}`) })),
    warnings: r.warnings,
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system:
        'You are a senior Iranian multi-asset trader reviewing a backtest. Write in Persian (Farsi), plain prose, 4 short paragraphs, no headings, no bullet lists. ' +
        'Use ONLY the numbers, dates, trades and headlines in the JSON. Never invent prices, events or news. When you mention a news item, name its source and date as given. ' +
        'Cover: whether the result was good relative to the benchmarks and inflation; the 2–3 decisions that mattered most and why they were made; mistakes or luck; one concrete rule change you would test next. End with one sentence that this is not investment advice.',
      messages: [{ role: 'user', content: JSON.stringify(facts) }],
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? `Anthropic HTTP ${res.status}`);
  const text = (json.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  if (!text) throw new Error('پاسخ خالی از مدل');
  return { text, model };
}
