import { kv, storeMode } from '@/lib/store';
import { errMsg } from '@/lib/http';
import { fmtPct, isNum, isTseSessionOpen, isTseTradingDay, rialToToman, tehranDate } from '@/lib/num';
import { cachedSource } from '@/lib/sources/cache';
import { fetchTgju, parseTgju } from '@/lib/sources/tgju';
import { fetchGoldApi, parseGoldApi } from '@/lib/sources/goldapi';
import { fetchNobitexDaily, fetchNobitexStats, fetchNobitexTradable, parseNobitex } from '@/lib/sources/nobitex';
import { fetchBrsIndex, fetchBrsSymbols, fetchBrsGoldCurrency, parseBrsIndex, parseBrsSymbols, parseBrsTetherRial } from '@/lib/sources/brsapi';
import { fetchCgDaily, fetchCgMarkets, type CgCoin } from '@/lib/sources/coingecko';
import { dailyMap, loadDaily, loadTse, pairsToMap, productMap, saveDaily, saveTse, spliceSeries, upsertDailyPoint, upsertTseDay } from '@/lib/history';
import { computeRisk } from '@/lib/engine/risk';
import { candidateSymbols, screenCrypto } from '@/lib/engine/crypto';
import { screenTse } from '@/lib/engine/tse';
import { buildPortfolios } from '@/lib/engine/portfolio';
import type { AssetRisk, BoardItem, Profile, RiskAssetKey, Snapshot, SourceStatus } from '@/lib/types';

const SNAP_KEY = 'snapshot:v1';
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
  // BrsApi free tier (TSETMC_AllSymbols / TSETMC_Index) caps at 100 req/day each.
  // 240s in-session + 3600s off-session ≈ 80 req/day worst case — stays under the cap
  // even with continuous visitor traffic. Override via env if you're on a paid plan.
  const tseSessionTtl = Number(process.env.TSE_SESSION_TTL_SEC || 240);
  const tseOffHoursTtl = Number(process.env.TSE_OFFHOURS_TTL_SEC || 3600);
  const tseTtl = isTseSessionOpen(now) ? tseSessionTtl : tseOffHoursTtl;

  const [tgjuR, goldR, nobR, idxR, symR, gcR, cgR, memeR, hPaxg, hBtc, hEth, hUsdt] = await Promise.all([
    cachedSource('tgju', 60, fetchTgju),
    cachedSource('goldapi', 60, fetchGoldApi),
    cachedSource('nobitex', 60, fetchNobitexStats),
    cachedSource('brsIndex', tseTtl, fetchBrsIndex, 4 * 24 * 3600),
    cachedSource('brsSymbols', tseTtl, fetchBrsSymbols, 4 * 24 * 3600),
    cachedSource('brsGoldCurrency', 120, fetchBrsGoldCurrency, 4 * 24 * 3600), // fallback for USDT if Nobitex is blocked
    cachedSource<CgCoin[]>('cgMarkets', 300, () => fetchCgMarkets(undefined, 250), 6 * 3600),
    cachedSource<CgCoin[]>('cgMemes', 300, () => fetchCgMarkets('meme-token', 120), 6 * 3600),
    cachedSource('histPaxg', 12 * 3600, () => fetchCgDaily('pax-gold'), 10 * 24 * 3600),
    cachedSource('histBtc', 12 * 3600, () => fetchCgDaily('bitcoin'), 10 * 24 * 3600),
    cachedSource('histEth', 12 * 3600, () => fetchCgDaily('ethereum'), 10 * 24 * 3600),
    cachedSource('histUsdt', 12 * 3600, () => fetchNobitexDaily('USDTIRT'), 10 * 24 * 3600),
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
  const btcUsd = nb.btcUsdt?.price ?? cgR.data?.find((c) => c.id === 'bitcoin')?.current_price ?? null;
  const ethUsd = nb.ethUsdt?.price ?? cgR.data?.find((c) => c.id === 'ethereum')?.current_price ?? null;
  const cgChange = (id: string) => cgR.data?.find((c) => c.id === id)?.price_change_percentage_24h_in_currency ?? null;

  const items: BoardItem[] = [
    { key: 'usd', label: 'دلار آزاد', price: rialToToman(usdR) || null, unit: 'toman', changePct: tg.usd?.changePct ?? null },
    { key: 'usdt', label: 'تتر', price: rialToToman(usdtR) || null, unit: 'toman', changePct: usdtChangePct, note: isNum(usdtPremiumPct) ? `پرمیوم نسبت به دلار ${fmtPct(usdtPremiumPct)}` : undefined },
    { key: 'coin', label: 'سکه امامی', price: rialToToman(tg.coin?.price) || null, unit: 'toman', changePct: tg.coin?.changePct ?? null, note: isNum(coinBubblePct) ? `حباب ${fmtPct(coinBubblePct, 1, false)}` : undefined },
    { key: 'g18', label: 'طلای ۱۸ عیار (گرم)', price: rialToToman(tg.g18?.price) || null, unit: 'toman', changePct: tg.g18?.changePct ?? null, note: isNum(g18BubblePct) ? `حباب ${fmtPct(g18BubblePct, 1, false)}` : undefined },
    { key: 'ons', label: 'انس جهانی طلا', price: ons, unit: 'usd', changePct: tg.ons?.changePct ?? null },
    { key: 'btc', label: 'بیت‌کوین', price: btcUsd, unit: 'usd', changePct: nb.btcUsdt?.changePct ?? cgChange('bitcoin') },
    { key: 'eth', label: 'اتریوم', price: ethUsd, unit: 'usd', changePct: nb.ethUsdt?.changePct ?? cgChange('ethereum') },
    { key: 'tse', label: 'شاخص کل بورس', price: idx?.value ?? null, unit: 'point', changePct: idx?.changePct ?? null },
  ];

  // ── rolling history (write at most every 10 min / TSE every 20 min) ──
  const today = tehranDate(now);
  const daily = await loadDaily();
  const lastDailyWrite = (await kv.get<number>('hist:daily:lastWrite')) ?? 0;
  upsertDailyPoint(daily, today, {
    usd: usdR, usdt: usdtR, g18: tg.g18?.price, coin: tg.coin?.price, ons, btc: btcUsd, eth: ethUsd,
    tse: isTseTradingDay(now) ? idx?.value : null,
  });
  if (Date.now() - lastDailyWrite > 10 * 60 * 1000) {
    await saveDaily(daily);
    await kv.set('hist:daily:lastWrite', Date.now());
  }

  const tseStore = await loadTse();
  if (symbols && isTseTradingDay(now)) {
    const lastTseWrite = (await kv.get<number>('hist:tse:lastWrite')) ?? 0;
    if (Date.now() - lastTseWrite > 20 * 60 * 1000 && upsertTseDay(tseStore, today, symbols)) {
      await saveTse(tseStore);
      await kv.set('hist:tse:lastWrite', Date.now());
    }
  }

  // ── risk ──
  const paxg = pairsToMap(hPaxg.data);
  const usdtUdf = pairsToMap(hUsdt.data);
  const btcP = pairsToMap(hBtc.data);
  const ethP = pairsToMap(hEth.data);
  const goldIrrProxy = productMap(paxg, usdtUdf);

  const defs: { key: RiskAssetKey; label: string; unit: AssetRisk['unit']; actual: Map<string, number>; proxy: Map<string, number>; price: number | null; addOn?: number; hidden?: boolean }[] = [
    { key: 'usd', label: 'دلار آزاد', unit: 'toman', actual: dailyMap(daily, 'usd'), proxy: usdtUdf, price: rialToToman(usdR) || null },
    { key: 'usdt', label: 'تتر', unit: 'toman', actual: dailyMap(daily, 'usdt'), proxy: usdtUdf, price: rialToToman(usdtR) || null },
    { key: 'g18', label: 'طلای ۱۸', unit: 'toman', actual: dailyMap(daily, 'g18'), proxy: goldIrrProxy, price: rialToToman(tg.g18?.price) || null, addOn: isNum(g18BubblePct) ? Math.max(-8, Math.min(12, g18BubblePct * 1.5)) : 0 },
    { key: 'coin', label: 'سکه امامی', unit: 'toman', actual: dailyMap(daily, 'coin'), proxy: goldIrrProxy, price: rialToToman(tg.coin?.price) || null, addOn: isNum(coinBubblePct) ? Math.max(-10, Math.min(15, coinBubblePct * 1.5)) : 0 },
    { key: 'ons', label: 'انس جهانی', unit: 'usd', actual: dailyMap(daily, 'ons'), proxy: paxg, price: ons },
    { key: 'btc', label: 'بیت‌کوین', unit: 'usd', actual: dailyMap(daily, 'btc'), proxy: btcP, price: btcUsd },
    { key: 'eth', label: 'اتریوم', unit: 'usd', actual: dailyMap(daily, 'eth'), proxy: ethP, price: ethUsd },
    { key: 'tse', label: 'شاخص کل بورس', unit: 'point', actual: dailyMap(daily, 'tse'), proxy: new Map(), price: idx?.value ?? null },
    { key: 'btc_irt', label: 'بیت‌کوین (تومانی)', unit: 'toman', actual: productMap(dailyMap(daily, 'btc'), dailyMap(daily, 'usdt')), proxy: productMap(btcP, usdtUdf), price: null, hidden: true },
  ];

  const risk: AssetRisk[] = defs.map((d) => {
    const { dates, prices } = spliceSeries(d.actual, d.proxy);
    const { horizons, annualVolPct } = computeRisk(dates, prices, d.addOn ?? 0);
    return { key: d.key, label: d.label, unit: d.unit, price: d.price, points: prices.length, firstDate: dates[0] ?? null, annualVolPct, horizons, hidden: d.hidden };
  });

  // ── crypto screen ──
  const cands = candidateSymbols(cgR.data, memeR.data);
  const tradR = cands.length
    ? await cachedSource<string[]>('nobitexScreen', 1800, () => fetchNobitexTradable(cands), 3 * 24 * 3600)
    : { data: null, status: null };
  const crypto = screenCrypto(cgR.data, memeR.data, tradR.data ? new Set(tradR.data) : null);

  // ── TSE screen ──
  const tseIdx = spliceSeries(dailyMap(daily, 'tse'), new Map()).prices;
  const stocks = screenTse(symbols, tseStore, tseIdx);

  const defaultProfile = (['conservative', 'balanced', 'aggressive'].includes(process.env.DEFAULT_RISK_PROFILE ?? '')
    ? process.env.DEFAULT_RISK_PROFILE
    : 'balanced') as Profile;

  const sources: SourceStatus[] = [tgjuR, goldR, nobR, idxR, symR, gcR, cgR, memeR].map((r) => r.status);
  const hist = [hPaxg, hBtc, hEth, hUsdt];
  sources.push({
    name: 'history',
    label: 'تاریخچه پایه ریسک',
    ok: hist.every((h) => h.status.ok),
    stale: hist.some((h) => h.status.stale),
    ageSec: Math.max(...hist.map((h) => h.status.ageSec ?? 0)),
    via: 'fetch',
    error: hist.map((h) => h.status.error).filter(Boolean).join(' | ') || undefined,
  });
  if (tradR.status) sources.push(tradR.status);

  return {
    version: 1,
    generatedAt: now.toISOString(),
    storeMode,
    sources,
    live: { items, coinBubblePct, g18BubblePct, usdtPremiumPct },
    risk,
    crypto: {
      ...crypto,
      note: 'غربال مومنتوم و توجه بازار در ۷ روز اخیر — نه پیش‌بینی قیمت. قدرت پیش‌بینی چنین رتبه‌بندی‌هایی به‌ویژه برای میم‌کوین‌ها ضعیف و ناپایدار است.',
    },
    stocks,
    portfolios: buildPortfolios(risk, { items, coinBubblePct, g18BubblePct, usdtPremiumPct }, crypto.coins),
    defaultProfile,
  };
}
