import { NextResponse } from 'next/server';
import { errMsg } from '@/lib/http';
import { isNum } from '@/lib/num';
import { cachedSource } from '@/lib/sources/cache';
import { fetchCgMarkets, type CgCoin } from '@/lib/sources/coingecko';
import { fetchNobitexTradable } from '@/lib/sources/nobitex';
import { dailyMap, loadDaily } from '@/lib/history';
import { getSnapshot } from '@/lib/snapshot';
import { SWING_PRESETS, runSwing, type SwingEngine, type SwingPreset } from '@/lib/engine/swing';
import { SWING_EVIDENCE, SWING_V2 } from '@/lib/engine/swing-v2';
import { marketContext, MAX_SWING_DAYS_V2, swingDataFor } from '@/lib/swing-data';
import { runSwingPortfolio } from '@/lib/engine/swing-portfolio';
import { scanSwing } from '@/lib/engine/swing-scan';
import { buildPriors, getSwingRuns, recordSwingRuns, type SwingRunRecord } from '@/lib/swing-history';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_DAYS = MAX_SWING_DAYS_V2;

/** v2 unless the caller explicitly asks for the original engine (kept for comparison). */
const engineOf = (body: any): SwingEngine => (body?.engine === 'v1' && body?.preset !== 'trend' ? 'v1' : 'v2');
const MAX_COINS = 8;
const MAX_SCAN = 14; // candidates screened per auto-scan; each is one hourly-history fetch // each coin is a separate hourly-history fetch; keep the request inside maxDuration

/** GET → the coin menu (majors + whatever the weekly screener currently likes) and preset metadata. */
export async function GET() {
  try {
    const snap = await getSnapshot();
    const majors = [
      { id: 'bitcoin', symbol: 'BTC', name: 'بیت‌کوین' },
      { id: 'ethereum', symbol: 'ETH', name: 'اتریوم' },
      { id: 'solana', symbol: 'SOL', name: 'سولانا' },
    ];
    const seen = new Set(majors.map((m) => m.id));
    const seenSymbols = new Set(majors.map((m) => m.symbol.toLowerCase()));
    // The whole tradable universe, not just this week's top picks: the backtest endpoint
    // already accepts any CoinGecko id, so the menu was the only thing limiting it.
    // Both lists come from the same cache the dashboard already fills — no extra network calls.
    const [marketsR, memesR] = await Promise.all([
      cachedSource<CgCoin[]>('cgMarkets', 300, () => fetchCgMarkets(undefined, 250), 6 * 3600),
      cachedSource<CgCoin[]>('cgMemes', 300, () => fetchCgMarkets('meme-token', 120), 6 * 3600),
    ]);
    const memeIds = new Set((memesR.data ?? []).map((c) => c.id));
    // Keep one entry per ticker: CoinGecko lists bridged/wrapped copies of the same coin under
    // separate ids, which would otherwise show up as duplicate "DOGE" rows in the menu.
    const bySymbol = new Map<string, CgCoin>();
    for (const c of [...(marketsR.data ?? []), ...(memesR.data ?? [])]) {
      if (!c?.id || seen.has(c.id)) continue;
      if (!isNum(c.current_price) || c.current_price <= 0) continue;
      const k = String(c.symbol ?? '').toLowerCase();
      if (!k || seenSymbols.has(k)) continue; // majors are already listed at the top
      const cur = bySymbol.get(k);
      if (!cur || (c.market_cap ?? 0) > (cur.market_cap ?? 0)) bySymbol.set(k, c);
    }
    const universe = [...bySymbol.values()]
      .sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0))
      .map((c) => ({ id: c.id, symbol: c.symbol.toUpperCase(), name: c.name, meme: memeIds.has(c.id) }));
    // this week's screener picks stay at the top of the list as a shortcut
    const picks = new Set([...snap.crypto.coins, ...snap.crypto.memes].map((c) => c.id));
    const ranked = [
      ...universe.filter((c) => picks.has(c.id)).map((c) => ({ ...c, picked: true })),
      ...universe.filter((c) => !picks.has(c.id)).map((c) => ({ ...c, picked: false })),
    ];
    const runs = await getSwingRuns();
    const priors = [...buildPriors(runs).values()].sort((a, b) => b.score - a.score);
    return NextResponse.json({
      history: { runs: runs.length, priors: priors.slice(0, 40), recent: runs.slice(0, 20) },
      coins: [...majors.map((m) => ({ ...m, meme: false, picked: false })), ...ranked],
      maxDays: MAX_DAYS,
      presets: Object.entries(SWING_PRESETS).map(([key, p]) => ({ key, label: p.label, note: p.note, minScore: SWING_V2[key as SwingPreset].minScore })),
      evidence: SWING_EVIDENCE,
      engines: [
        { key: 'v2', label: 'نسخه ۲ (پیش‌فرض)', note: 'کندل کامل صرافی، فیلتر روند ۲۰ و ۵۰ روزه و رژیم بیت‌کوین، امتیاز هم‌گرایی شواهد' },
        { key: 'v1', label: 'نسخه ۱ (قدیمی)', note: 'فقط برای مقایسه؛ در آزمون داده واقعی در بیشتر بازه‌ها زیان داد' },
      ],
      usdtRial: snap.live.items.find((i) => i.key === 'usdt')?.price ? snap.live.items.find((i) => i.key === 'usdt')!.price! * 10 : null,
    });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}

function toRecord(source: SwingRunRecord['source'], coin: { id: string; symbol: string }, preset: string, days: number, feePct: number, r: { metrics: any }): SwingRunRecord {
  const m = r.metrics;
  return {
    at: Date.now(), source, coinId: coin.id, symbol: coin.symbol, preset, days, feePct,
    returnPct: m.returnPct, buyHoldPct: m.buyHoldPct, trades: m.trades,
    winRatePct: m.winRatePct ?? null, maxDrawdownPct: m.maxDrawdownPct,
    from: m.from ?? null, to: m.to ?? null,
  };
}

const isCoinId = (v: string) => /^[a-z0-9][a-z0-9-]{1,60}$/.test(v);

/**
 * Everything the engine needs to report in real toman: the current tether rate for display,
 * the DAILY tether rate so each bar converts at its own day's price, and the fixed-income rate
 * the result has to beat to have been worth doing.
 */
async function fxContext() {
  const [snap, daily] = await Promise.all([getSnapshot(), loadDaily().catch(() => null)]);
  const usdtToman = snap.live.items.find((i) => i.key === 'usdt')?.price ?? null;
  const usdtRial = isNum(usdtToman) ? usdtToman * 10 : null;
  const usdtRialByDate = daily ? dailyMap(daily, 'usdt') : null;
  return {
    snap,
    usdtRial,
    usdtRialByDate: usdtRialByDate && usdtRialByDate.size >= 10 ? usdtRialByDate : null,
    riskFreeAnnual: Number(process.env.FIXED_INCOME_YIELD || 0.3),
  };
}

/** Bars (+ daily closes) for several coins in parallel; a coin that fails keeps its error. */
async function loadInputs(coins: { id: string; symbol: string; name: string }[], days: number, engine: SwingEngine) {
  return Promise.all(
    coins.map(async (coin) => {
      try {
        const d = await swingDataFor(coin, days, engine);
        return { coin, bars: d.bars, daily: d.daily, via: d.via };
      } catch (e) {
        return { coin, bars: null, daily: null, error: errMsg(e) };
      }
    }),
  );
}

/** The v2 extras shared by every coin in a request: BTC regime and the start of the tradable window. */
async function v2Context(engine: SwingEngine, days: number) {
  if (engine !== 'v2') return {};
  const { market, marketDaily } = await marketContext(days);
  return { engine, market, marketDaily, tradeFrom: Math.floor(Date.now() / 3_600_000) * 3_600_000 - days * 86_400_000 };
}

/**
 * POST {coinId,…} → one swing backtest.
 * POST {coins:[{id,symbol,name},…]} → the same engine on several coins at once, each with an
 * equal sleeve of the capital, plus a combined portfolio curve.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    // ── auto scan: find swing-worthy coins from real market data ──
    if (body?.auto) {
      const days = Math.max(30, Math.min(MAX_DAYS, Math.round(Number(body?.days ?? 90))));
      const capitalToman = Math.round(Number(body?.capitalToman));
      if (!isNum(capitalToman) || capitalToman < 1_000_000 || capitalToman > 1e13) throw new Error('سرمایه باید بین ۱ میلیون تومان و ۱۰ هزار میلیارد تومان باشد.');
      const preset = (Object.keys(SWING_PRESETS).includes(body?.preset) ? body.preset : 'normal') as SwingPreset;
      const feePct = isNum(Number(body?.feePct)) ? Math.max(0, Math.min(2, Number(body.feePct))) : 0.4;
      const pick = Math.max(1, Math.min(MAX_COINS, Math.round(Number(body?.count ?? 4))));
      const includeMemes = body?.includeMemes !== false;

      const [marketsR, memesR] = await Promise.all([
        cachedSource<CgCoin[]>('cgMarkets', 300, () => fetchCgMarkets(undefined, 250), 6 * 3600),
        cachedSource<CgCoin[]>('cgMemes', 300, () => fetchCgMarkets('meme-token', 120), 6 * 3600),
      ]);
      const memeIds = new Set((memesR.data ?? []).map((c) => c.id));
      const stable = /^(usdt|usdc|dai|fdusd|tusd|usde|pyusd|busd)$/i;
      // Candidates are chosen by liquidity only — never by recent performance, or the scan
      // would be ranking coins it had already pre-filtered for being winners.
      const pool = [...(marketsR.data ?? []), ...(includeMemes ? (memesR.data ?? []) : [])]
        .filter((c) => c?.id && isNum(c.total_volume) && !stable.test(String(c.symbol ?? '')))
        .filter((c) => isNum(c.current_price) && c.current_price > 0);
      const bySym = new Map<string, CgCoin>();
      for (const c of pool) {
        const k = String(c.symbol ?? '').toLowerCase();
        const cur = bySym.get(k);
        if (!cur || (c.total_volume ?? 0) > (cur.total_volume ?? 0)) bySym.set(k, c);
      }
      const ranked = [...bySym.values()].sort((a, b) => (b.total_volume ?? 0) - (a.total_volume ?? 0));

      // A coin the user cannot buy in Iran is not a candidate, however good its backtest looks.
      // The screen was ranking on global CoinGecko volume alone, so the scan could spend its
      // whole history budget on names with no open rial market on Nobitex.
      const scanNotes: string[] = [];
      const tradable = await cachedSource<string[]>(
        'nobitexSwingScan',
        1800,
        () => fetchNobitexTradable(ranked.slice(0, 80).map((c) => String(c.symbol))),
        3 * 24 * 3600,
      ).catch(() => ({ data: null as string[] | null }));
      const tradableSet = tradable.data?.length ? new Set(tradable.data) : null;
      const eligible = tradableSet ? ranked.filter((c) => tradableSet.has(String(c.symbol ?? '').toLowerCase())) : ranked;
      if (!tradableSet) {
        scanNotes.push('فهرست بازارهای نوبیتکس در دسترس نبود؛ ممکن است بعضی ارزهای این فهرست در ایران قابل معامله نباشند.');
      } else {
        scanNotes.push(`فقط ارزهایی بررسی شدند که بازار ریالی باز روی نوبیتکس دارند (${eligible.length.toLocaleString('fa-IR')} ارز از ${ranked.length.toLocaleString('fa-IR')}).`);
      }

      const cands = (eligible.length ? eligible : ranked)
        .slice(0, MAX_SCAN)
        .map((c) => ({ id: c.id, symbol: String(c.symbol).toUpperCase(), name: c.name, meme: memeIds.has(c.id) }));
      if (!cands.length) throw new Error('فهرست ارزها در دسترس نبود.');

      const engine = engineOf(body);
      const [{ usdtRial, usdtRialByDate, riskFreeAnnual }, extra] = await Promise.all([fxContext(), v2Context(engine, days)]);
      const swingCfg = { capitalToman, preset, feePct, usdtRial, usdtRialByDate, riskFreeAnnual, ...extra };
      const inputs = await loadInputs(cands, days, engine);
      const priors = buildPriors(await getSwingRuns());
      const scan = scanSwing(inputs, swingCfg, pick, priors);
      scan.warnings.unshift(...scanNotes);

      // and run the selected basket over the whole window, as a normal portfolio
      const selIds = new Set(scan.selected.map((c) => c.coin.id));
      const portfolio = runSwingPortfolio(inputs.filter((i) => selIds.has(i.coin.id)), swingCfg);
      // remember what happened, so later scans have evidence to work from
      await recordSwingRuns(
        portfolio.sleeves
          .filter((sl) => sl.ok && sl.result)
          .map((sl) => toRecord('scan', sl.coin, preset, days, feePct, sl.result!)),
      );
      return NextResponse.json({ scan, portfolio, days, engine, preset: SWING_PRESETS[preset], priorsUsed: priors.size }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (Array.isArray(body?.coins) && body.coins.length) {
      const days = Math.max(7, Math.min(MAX_DAYS, Math.round(Number(body?.days ?? 60))));
      const capitalToman = Math.round(Number(body?.capitalToman));
      if (!isNum(capitalToman) || capitalToman < 1_000_000 || capitalToman > 1e13) throw new Error('سرمایه باید بین ۱ میلیون تومان و ۱۰ هزار میلیارد تومان باشد.');
      const preset = (Object.keys(SWING_PRESETS).includes(body?.preset) ? body.preset : 'normal') as SwingPreset;
      const feePct = isNum(Number(body?.feePct)) ? Math.max(0, Math.min(2, Number(body.feePct))) : 0.4;

      const picked = body.coins
        .map((c: any) => ({ id: String(c?.id ?? '').trim(), symbol: String(c?.symbol ?? c?.id ?? '').toUpperCase(), name: String(c?.name ?? c?.id ?? '') }))
        .filter((c: any) => isCoinId(c.id));
      const unique = [...new Map(picked.map((c: any) => [c.id, c])).values()] as { id: string; symbol: string; name: string }[];
      if (!unique.length) throw new Error('شناسه ارزها نامعتبر است.');
      if (unique.length > MAX_COINS) throw new Error(`حداکثر ${MAX_COINS.toLocaleString('fa-IR')} ارز همزمان قابل محاسبه است.`);

      const engine = engineOf(body);
      const [{ usdtRial, usdtRialByDate, riskFreeAnnual }, extra] = await Promise.all([fxContext(), v2Context(engine, days)]);
      const inputs = await loadInputs(unique, days, engine);
      const portfolio = runSwingPortfolio(inputs, { capitalToman, preset, feePct, usdtRial, usdtRialByDate, riskFreeAnnual, ...extra });
      if (!isNum(usdtRial)) portfolio.warnings.push('قیمت تتر در دسترس نبود؛ محاسبه‌ها بر پایه دلار انجام شد.');
      await recordSwingRuns(
        portfolio.sleeves.filter((sl) => sl.ok && sl.result).map((sl) => toRecord('basket', sl.coin, preset, days, feePct, sl.result!)),
      );
      return NextResponse.json({ portfolio, engine, preset: SWING_PRESETS[preset], days }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const coinId = String(body?.coinId ?? '').trim();
    if (!isCoinId(coinId)) throw new Error('شناسه ارز نامعتبر است.');
    const days = Math.max(7, Math.min(MAX_DAYS, Math.round(Number(body?.days ?? 60))));
    const capitalToman = Math.round(Number(body?.capitalToman));
    if (!isNum(capitalToman) || capitalToman < 1_000_000 || capitalToman > 1e13) throw new Error('سرمایه باید بین ۱ میلیون تومان و ۱۰ هزار میلیارد تومان باشد.');
    const preset = (Object.keys(SWING_PRESETS).includes(body?.preset) ? body.preset : 'normal') as SwingPreset;
    const feePct = isNum(Number(body?.feePct)) ? Math.max(0, Math.min(2, Number(body.feePct))) : 0.4;

    const engine = engineOf(body);
    const coin = { id: coinId, symbol: String(body?.symbol ?? coinId).toUpperCase(), name: String(body?.name ?? coinId) };
    const [{ usdtRial, usdtRialByDate, riskFreeAnnual }, extra, data] = await Promise.all([fxContext(), v2Context(engine, days), swingDataFor(coin, days, engine)]);
    const result = runSwing(data.bars, coin, {
      capitalToman, preset, feePct, usdtRial, usdtRialByDate, riskFreeAnnual, ...extra,
      ...(coin.id === 'bitcoin' ? { market: null, marketDaily: null } : {}),
      daily: data.daily,
      tradeFrom: engine === 'v2' ? data.tradeFrom : null,
    });

    if (!isNum(usdtRial)) result.warnings.push('قیمت تتر در دسترس نبود؛ محاسبه‌ها بر پایه دلار انجام شد و تغییر نرخ تتر در بازده لحاظ نشده است.');
    if (data.stale) result.warnings.push('تاریخچه از کش خوانده شد و ممکن است چند ساعت قدیمی باشد.');
    if (data.via === 'coingecko') result.warnings.push('این ارز در صرافی‌های مرجع کندل کامل نداشت؛ از قیمت ساعتی CoinGecko استفاده شد (بدون سقف/کف/حجم).');
    if (data.days < days) result.warnings.push(`فقط ${data.days.toLocaleString('fa-IR')} روز تاریخچه قابل معامله در دسترس بود.`);

    await recordSwingRuns([toRecord('single', coin, preset, days, feePct, result)]);
    return NextResponse.json({ ...result, engine, dataVia: data.via }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 400 });
  }
}
