import { kv, storeMode } from '@/lib/store';
import { errMsg } from '@/lib/http';
import { clamp, fmtInt, fmtNum, fmtPct, fmtPrice, isNum, isTseSessionOpen, isTseTradingDay, rialToToman, tehranDate } from '@/lib/num';
import { median } from '@/lib/engine/stats';
import { cachedSource } from '@/lib/sources/cache';
import { fetchTgju, parseTgju } from '@/lib/sources/tgju';
import { fetchGoldApi, parseGoldApi } from '@/lib/sources/goldapi';
import { fetchNobitexStats, fetchNobitexTradable, parseNobitex } from '@/lib/sources/nobitex';
import { fetchBrsGoldCurrency, fetchBrsIndex, fetchBrsSymbols, parseBrsIndex, parseBrsSymbols, parseBrsTetherRial, type TseSymbol } from '@/lib/sources/brsapi';
import { fetchCgMarkets, type CgCoin } from '@/lib/sources/coingecko';
import { dailyMap, loadDaily, loadTse, saveDaily, saveTse, upsertDailyPoint, upsertTseDay } from '@/lib/history';
import { recordIntraday } from '@/lib/intraday';
import { buildSeries, coinSeries, loadSeriesInputs, type SeriesInputs } from '@/lib/series';
import { computeRisk } from '@/lib/engine/risk';
import { candidateSymbols, screenCrypto } from '@/lib/engine/crypto';
import { screenTse } from '@/lib/engine/tse';
import { buildPortfolios } from '@/lib/engine/portfolio';
import { betaVs, buildScenario, returnCorrelation } from '@/lib/engine/scenario';
import type { AssetRisk, AssetScenario, BoardItem, CryptoRow, Profile, RiskAssetKey, Snapshot, SourceStatus } from '@/lib/types';

const SNAP_KEY = 'snapshot:v2';
const LOCK_KEY = 'snapshot:lock';
const COIN_PURE_GRAMS = 7.3224; // Emami coin: 8.136 g × 0.900
const OZ = 31.1035;

export async function getSnapshot(opts: { force?: boolean } = {}): Promise<Snapshot> {
  const ttl = Number(process.env.SNAPSHOT_TTL_SEC || 60);
  const cached = await kv.get<Snapshot>(SNAP_KEY);
  if (!opts.force && cached && Date.now() - Date.parse(cached.generatedAt) < ttl * 1000) return cached;
  const gotLock = await kv.setNx(LOCK_KEY, '1', 40);
  if (!gotLock && cached) return cached;
  try {
    const snap = await buildSnapshot();
    await kv.set(SNAP_KEY, snap, 7 * 24 * 3600);
    return snap;
  } catch (e) {
    if (cached) return cached;
    throw new Error(`snapshot build failed: ${errMsg(e)}`);
  } finally {
    if (gotLock) await kv.del(LOCK_KEY);
  }
}

async function buildSnapshot(): Promise<Snapshot> {
  const now = new Date();
  // BrsApi free tier (TSETMC_AllSymbols / TSETMC_Index) caps at 100 req/day each:
  // 240 s in-session + 3600 s off-session ≈ 80 req/day worst case.
  const tseTtl = isTseSessionOpen(now) ? Number(process.env.TSE_SESSION_TTL_SEC || 240) : Number(process.env.TSE_OFFHOURS_TTL_SEC || 3600);

  const [tgjuR, goldR, nobR, idxR, symR, gcR, cgR, memeR, daily] = await Promise.all([
    cachedSource('tgju', 60, fetchTgju),
    cachedSource('goldapi', 60, fetchGoldApi),
    cachedSource('nobitex', 60, fetchNobitexStats),
    cachedSource('brsIndex', tseTtl, fetchBrsIndex, 4 * 24 * 3600),
    cachedSource('brsSymbols', tseTtl, fetchBrsSymbols, 4 * 24 * 3600),
    cachedSource('brsGoldCurrency', 120, fetchBrsGoldCurrency, 4 * 24 * 3600), // USDT fallback when Nobitex is blocked
    cachedSource<CgCoin[]>('cgMarkets', 300, () => fetchCgMarkets(undefined, 250), 6 * 3600),
    cachedSource<CgCoin[]>('cgMemes', 300, () => fetchCgMarkets('meme-token', 120), 6 * 3600),
    loadDaily(),
  ]);

  // ── live board ──
  const tg = parseTgju(tgjuR.data);
  const ons = parseGoldApi(goldR.data) ?? tg.ons?.price ?? null;
  const nb = parseNobitex(nobR.data);
  const idx = parseBrsIndex(idxR.data);
  const symbols = symR.data ? parseBrsSymbols(symR.data) : null;

  const usdR = tg.usd?.price ?? null; // rial
  const brsTether = gcR.data ? parseBrsTetherRial(gcR.data, usdR) : null;
  const usdtR = nb.usdtRls?.price ?? brsTether?.price ?? null;
  const usdtChangePct = nb.usdtRls?.changePct ?? brsTether?.changePct ?? null;
  const g18Intrinsic = isNum(ons) && isNum(usdR) ? (ons / OZ) * 0.75 * usdR : null;
  const coinIntrinsic = isNum(ons) && isNum(usdR) ? (ons / OZ) * COIN_PURE_GRAMS * usdR : null;
  const coinBubblePct = tg.coin && coinIntrinsic ? (tg.coin.price / coinIntrinsic - 1) * 100 : null;
  const g18BubblePct = tg.g18 && g18Intrinsic ? (tg.g18.price / g18Intrinsic - 1) * 100 : null;
  const usdtPremiumPct = isNum(usdtR) && isNum(usdR) ? (usdtR / usdR - 1) * 100 : null;
  const cgFind = (id: string) => cgR.data?.find((c) => c.id === id);
  const btcUsd = nb.btcUsdt?.price ?? cgFind('bitcoin')?.current_price ?? null;
  const ethUsd = nb.ethUsdt?.price ?? cgFind('ethereum')?.current_price ?? null;

  const items: BoardItem[] = [
    { key: 'usd', label: 'دلار آزاد', price: rialToToman(usdR) || null, unit: 'toman', changePct: tg.usd?.changePct ?? null },
    { key: 'usdt', label: 'تتر', price: rialToToman(usdtR) || null, unit: 'toman', changePct: usdtChangePct, note: isNum(usdtPremiumPct) ? `پرمیوم نسبت به دلار ${fmtPct(usdtPremiumPct)}` : undefined },
    { key: 'coin', label: 'سکه امامی', price: rialToToman(tg.coin?.price) || null, unit: 'toman', changePct: tg.coin?.changePct ?? null, note: isNum(coinBubblePct) ? `حباب ${fmtPct(coinBubblePct, 1, false)}` : undefined },
    { key: 'g18', label: 'طلای ۱۸ عیار (گرم)', price: rialToToman(tg.g18?.price) || null, unit: 'toman', changePct: tg.g18?.changePct ?? null, note: isNum(g18BubblePct) ? `حباب ${fmtPct(g18BubblePct, 1, false)}` : undefined },
    { key: 'ons', label: 'انس جهانی طلا', price: ons, unit: 'usd', changePct: tg.ons?.changePct ?? null },
    { key: 'btc', label: 'بیت‌کوین', price: btcUsd, unit: 'usd', changePct: nb.btcUsdt?.changePct ?? cgFind('bitcoin')?.price_change_percentage_24h_in_currency ?? null },
    { key: 'eth', label: 'اتریوم', price: ethUsd, unit: 'usd', changePct: nb.ethUsdt?.changePct ?? cgFind('ethereum')?.price_change_percentage_24h_in_currency ?? null },
    { key: 'tse', label: 'شاخص کل بورس', price: idx?.value ?? null, unit: 'point', changePct: idx?.changePct ?? null },
    { key: 'oilBrent', label: 'نفت برنت', price: tg.oilBrent?.price ?? null, unit: 'usd', changePct: tg.oilBrent?.changePct ?? null },
    { key: 'dxy', label: 'قدرت دلار (DXY)', price: tg.dxy?.price ?? null, unit: 'point', changePct: tg.dxy?.changePct ?? null },
  ];

  // ── rolling history (daily every 10 min at most, TSE symbols every 20 min, intraday every 10 min) ──
  const today = tehranDate(now);
  const livePoint = {
    usd: usdR, usdt: usdtR, g18: tg.g18?.price, coin: tg.coin?.price, ons, btc: btcUsd, eth: ethUsd,
    tse: isTseTradingDay(now) ? idx?.value : null,
  };
  upsertDailyPoint(daily, today, livePoint);
  const lastDailyWrite = (await kv.get<number>('hist:daily:lastWrite')) ?? 0;
  if (Date.now() - lastDailyWrite > 10 * 60 * 1000) {
    await saveDaily(daily);
    await kv.set('hist:daily:lastWrite', Date.now());
  }
  await recordIntraday(now.getTime(), { ...livePoint, tse: isTseSessionOpen(now) ? idx?.value : null });

  const tseStore = await loadTse();
  if (symbols && isTseTradingDay(now)) {
    const lastTseWrite = (await kv.get<number>('hist:tse:lastWrite')) ?? 0;
    if (Date.now() - lastTseWrite > 20 * 60 * 1000 && upsertTseDay(tseStore, today, symbols)) {
      await saveTse(tseStore);
      await kv.set('hist:tse:lastWrite', Date.now());
    }
  }

  // ── long histories + risk ──
  const inputs = await loadSeriesInputs(daily);
  const defs: { key: RiskAssetKey; label: string; unit: AssetRisk['unit']; price: number | null; addOn?: number; hidden?: boolean }[] = [
    { key: 'usd', label: 'دلار آزاد', unit: 'toman', price: rialToToman(usdR) || null },
    { key: 'usdt', label: 'تتر', unit: 'toman', price: rialToToman(usdtR) || null },
    { key: 'g18', label: 'طلای ۱۸', unit: 'toman', price: rialToToman(tg.g18?.price) || null, addOn: isNum(g18BubblePct) ? clamp(g18BubblePct * 1.5, -8, 12) : 0 },
    { key: 'coin', label: 'سکه امامی', unit: 'toman', price: rialToToman(tg.coin?.price) || null, addOn: isNum(coinBubblePct) ? clamp(coinBubblePct * 1.5, -10, 15) : 0 },
    { key: 'ons', label: 'انس جهانی', unit: 'usd', price: ons },
    { key: 'btc', label: 'بیت‌کوین', unit: 'usd', price: btcUsd },
    { key: 'eth', label: 'اتریوم', unit: 'usd', price: ethUsd },
    { key: 'tse', label: 'شاخص کل بورس', unit: 'point', price: idx?.value ?? null },
    { key: 'btc_irt', label: 'بیت‌کوین (تومانی)', unit: 'toman', price: null, hidden: true },
  ];
  const seriesByKey = new Map(defs.map((d) => [d.key, buildSeries(inputs, d.key)]));
  const risk: AssetRisk[] = defs.map((d) => {
    const { dates, prices, basis } = seriesByKey.get(d.key)!;
    const { horizons, annualVolPct } = computeRisk(dates, prices, d.addOn ?? 0);
    return { key: d.key, label: d.label, unit: d.unit, price: d.price, points: prices.length, firstDate: dates[0] ?? null, annualVolPct, horizons, hidden: d.hidden, basis };
  });

  // ── crypto screen ──
  const cands = candidateSymbols(cgR.data, memeR.data);
  const tradR = cands.length
    ? await cachedSource<string[]>('nobitexScreen', 1800, () => fetchNobitexTradable(cands), 3 * 24 * 3600)
    : { data: null, status: null };
  const crypto = screenCrypto(cgR.data, memeR.data, tradR.data ? new Set(tradR.data) : null);

  // ── TSE screen ──
  const tseSeries = seriesByKey.get('tse')!;
  const stocks = screenTse(symbols, tseStore, tseSeries.prices);

  // ── scenarios ──
  const scenarios = await buildScenarios({ inputs, seriesByKey, defs, crypto: crypto.coins, symbols, usdR, usdtPremiumPct, coinBubblePct, g18BubblePct, g18Intrinsic, coinIntrinsic });

  const defaultProfile = (['conservative', 'balanced', 'aggressive'].includes(process.env.DEFAULT_RISK_PROFILE ?? '')
    ? process.env.DEFAULT_RISK_PROFILE
    : 'balanced') as Profile;

  const sources: SourceStatus[] = [tgjuR, goldR, nobR, idxR, symR, gcR, cgR, memeR].map((r) => r.status);
  sources.push(...inputs.statuses);
  if (tradR.status) sources.push(tradR.status);

  return {
    version: 2,
    generatedAt: now.toISOString(),
    storeMode,
    sources,
    live: { items, coinBubblePct, g18BubblePct, usdtPremiumPct },
    risk,
    crypto: {
      ...crypto,
      note: 'غربال مومنتوم و توجه بازار در ۷ روز اخیر، نه پیش‌بینی قیمت. قدرت پیش‌بینی چنین رتبه‌بندی‌هایی به‌ویژه برای میم‌کوین‌ها ضعیف و ناپایدار است.',
    },
    stocks,
    scenarios: {
      assets: scenarios,
      note: 'بدترین سناریو یعنی فقط در ۵٪ حالت‌ها قیمت از آن پایین‌تر می‌رود و بهترین سناریو یعنی فقط در ۵٪ حالت‌ها بالاتر. رویدادهای کاملاً پیش‌بینی‌نشده (جنگ، تغییر ناگهانی سیاست ارزی) می‌توانند قیمت را بیرون از این بازه ببرند.',
    },
    portfolios: buildPortfolios(risk, { items, coinBubblePct, g18BubblePct, usdtPremiumPct }, crypto.coins),
    defaultProfile,
  };
}

interface ScenarioCtx {
  inputs: SeriesInputs;
  seriesByKey: Map<RiskAssetKey, ReturnType<typeof buildSeries>>;
  defs: { key: RiskAssetKey; label: string; unit: AssetRisk['unit']; price: number | null }[];
  crypto: CryptoRow[];
  symbols: TseSymbol[] | null;
  usdR: number | null;
  usdtPremiumPct: number | null;
  coinBubblePct: number | null;
  g18BubblePct: number | null;
  g18Intrinsic: number | null;
  coinIntrinsic: number | null;
}

const mapOf = (s: { dates: string[]; prices: number[] }) => new Map(s.dates.map((d, i) => [d, s.prices[i]]));

async function buildScenarios(c: ScenarioCtx): Promise<AssetScenario[]> {
  const S = (k: RiskAssetKey) => c.seriesByKey.get(k)!;
  const def = (k: RiskAssetKey) => c.defs.find((d) => d.key === k)!;
  const corr = (a: RiskAssetKey, b: RiskAssetKey) => returnCorrelation(mapOf(S(a)), mapOf(S(b)), 20);
  const corrTxt = (r: number | null, what: string) =>
    isNum(r) ? `همبستگی بازده ماهانه با ${what}: ${fmtPct(r * 100, 0)} (۱۰۰٪ یعنی کاملاً هم‌جهت، صفر یعنی بی‌ارتباط).` : null;
  const lines = (...xs: (string | null | false | undefined)[]) => xs.filter((x): x is string => !!x);

  const out: AssetScenario[] = [];
  const core = (key: RiskAssetKey, group: AssetScenario['group'], context: string[], bubblePct?: number | null) => {
    const s = S(key);
    const d = def(key);
    out.push(buildScenario({ key, label: d.label, unit: d.unit, group, price: d.price, dates: s.dates, prices: s.prices, basis: s.basis, reconstructed: s.reconstructed, bubblePct, context }));
  };

  core('usd', 'fx', lines(
    'دلار آزاد به اخبار سیاسی، مذاکرات و انتظار تورمی حساس است و معمولاً «پله‌ای» جهش می‌کند؛ اصلاح دُم پهن برای همین است.',
    isNum(c.usdtPremiumPct) && `فاصله تتر با دلار آزاد ${fmtPct(c.usdtPremiumPct)} است؛ پرمیوم مثبت معمولاً نشانه تقاضای بیشتر برای ارز است.`,
  ));
  core('g18', 'gold', lines(
    'قیمت طلای ۱۸ عیار ≈ انس جهانی × دلار آزاد × ۰٫۷۵ ÷ ۳۱٫۱؛ پس سناریوی آن ترکیبی از سناریوی انس و دلار است.',
    isNum(c.g18Intrinsic) && `ارزش ذاتی امروز بر همین پایه: ${fmtPrice(rialToToman(c.g18Intrinsic))} تومان (حباب ${fmtPct(c.g18BubblePct, 1)}).`,
    corrTxt(corr('g18', 'usd'), 'دلار'),
  ), c.g18BubblePct);
  core('coin', 'gold', lines(
    isNum(c.coinIntrinsic) && `ارزش ذاتی سکه (۷٫۳۲ گرم طلای خالص): ${fmtPrice(rialToToman(c.coinIntrinsic))} تومان؛ حباب ${fmtPct(c.coinBubblePct, 1)}. حباب بالا در بازار آرام معمولاً کم می‌شود.`,
  ), c.coinBubblePct);
  core('ons', 'gold', lines(
    'انس جهانی دلاری است و به نرخ بهره آمریکا، قدرت دلار جهانی و خرید بانک‌های مرکزی حساس است؛ نوسانش معمولاً از دارایی‌های ریالی و کریپتو کمتر است.',
  ));

  const btcS = S('btc');
  const btcRet = btcS.prices.slice(-366);
  let bigDays = 0;
  for (let i = 1; i < btcRet.length; i++) if (Math.abs(btcRet[i] / btcRet[i - 1] - 1) > 0.05) bigDays++;
  core('btc', 'crypto', lines(
    btcRet.length > 100 && `در سال گذشته ${fmtInt(bigDays)} روز حرکت روزانه بیش از ۵٪ داشته؛ کریپتو ۲۴ ساعته و بدون دامنه نوسان معامله می‌شود.`,
    'بیت‌کوین با اشتهای ریسک جهانی و ورود/خروج صندوق‌های ETF هم‌جهت است.',
  ));

  // TSE — breadth, flows, valuation and sectors from today's full symbol list
  const liquid = (c.symbols ?? []).filter((s) => s.tno > 0 && s.tval >= Number(process.env.TSE_MIN_TVAL || 5e9));
  const breadth = liquid.length ? (liquid.filter((s) => (s.lastChgPct ?? s.chgPct ?? 0) > 0).length / liquid.length) * 100 : null;
  const flowToman = liquid.some((s) => s.netRealFlow !== null) ? liquid.reduce((a, s) => a + (s.netRealFlow ?? 0), 0) / 10 : null;
  const pes = liquid.map((s) => s.pe).filter((p): p is number => isNum(p) && p > 0 && p < 200);
  const sectorVal = new Map<string, number>();
  for (const s of liquid) if (s.sector) sectorVal.set(s.sector, (sectorVal.get(s.sector) ?? 0) + s.tval);
  const topSectors = [...sectorVal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
  core('tse', 'tse', lines(
    isNum(breadth) && `عرض بازار: در آخرین جلسه ${fmtPct(breadth, 0, false)} نمادهای پرمعامله مثبت بودند (بالای ۶۰٪ = بازار همه‌جانبه صعودی، زیر ۴۰٪ = فشار فروش گسترده).`,
    isNum(flowToman) && `برآیند پول حقیقی: ${flowToman >= 0 ? 'ورود' : 'خروج'} ${fmtPrice(Math.abs(flowToman) / 1e9)} میلیارد تومان؛ خروج پایدار پول حقیقی معمولاً پیش‌درآمد ضعف شاخص است.`,
    pes.length >= 20 && `میانه P/E نمادهای پرمعامله ${fmtNum(median(pes), 1)} است؛ P/E پایین‌تر یعنی سهام نسبت به سودشان ارزان‌ترند و فضای افت محدودتر است.`,
    topSectors.length > 0 && `بیشترین ارزش معاملات در صنایع: ${topSectors.join('، ')}.`,
    corrTxt(corr('tse', 'usd'), 'دلار آزاد'),
    'بورس تهران دامنه نوسان روزانه و صف خرید/فروش دارد؛ به همین دلیل حرکت‌ها چندروزه ادامه پیدا می‌کند و در افق‌های بلند نوسان بزرگ‌تر محاسبه شده.',
  ));

  // three strongest altcoins from the weekly screen
  const btcMap = mapOf(btcS);
  const alts = c.crypto.filter((x) => !['BTC', 'ETH', 'WBTC', 'STETH'].includes(x.symbol) && x.mcap >= 1e9).slice(0, 3);
  const altSeries = await Promise.all(alts.map((a) => coinSeries(a.id).catch(() => null)));
  alts.forEach((a, i) => {
    const s = altSeries[i];
    const bv = s ? betaVs(new Map(s.dates.map((d, j) => [d, s.prices[j]])), btcMap) : null;
    out.push(
      buildScenario({
        key: `alt:${a.id}`,
        label: a.name,
        symbol: a.symbol,
        unit: 'usd',
        group: 'alt',
        price: a.price,
        dates: s?.dates ?? [],
        prices: s?.prices ?? [],
        basis: 'CoinGecko',
        context: lines(
          `رتبه ${fmtInt(a.rank)} در غربال هفتگی کوین‌ها با امتیاز ${fmtInt(a.score)}: ${a.reasons.join('؛ ')}.`,
          bv && `بتای روزانه نسبت به بیت‌کوین ${fmtPrice(bv.beta)} و نوسانش ${fmtPrice(bv.volRatio)} برابر بیت‌کوین است؛ یعنی اگر بیت‌کوین ۱۰٪ افت کند، این کوین به‌طور میانگین حدود ${fmtPct(bv.beta * 10, 0, false)} افت می‌کند.`,
          'آلت‌کوین‌ها در بازار نزولی معمولاً سریع‌تر و عمیق‌تر از بیت‌کوین افت می‌کنند؛ حجم این بخش را کوچک نگه دارید.',
        ),
      }),
    );
  });
  return out;
}
