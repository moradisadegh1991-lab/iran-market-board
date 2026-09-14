import { NextResponse } from 'next/server';
import { errMsg } from '@/lib/http';
import { isNum } from '@/lib/num';
import { cachedSource } from '@/lib/sources/cache';
import { fetchCgHourly, fetchCgMarkets, type CgCoin } from '@/lib/sources/coingecko';
import { getSnapshot } from '@/lib/snapshot';
import { SWING_PRESETS, runSwing, type SwingPreset } from '@/lib/engine/swing';
import { runSwingPortfolio } from '@/lib/engine/swing-portfolio';
import { scanSwing } from '@/lib/engine/swing-scan';
import { buildPriors, getSwingRuns, recordSwingRuns, type SwingRunRecord } from '@/lib/swing-history';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_DAYS = 90;
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
      presets: Object.entries(SWING_PRESETS).map(([key, p]) => ({ key, label: p.label, note: p.note })),
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

/** Hourly bars for one coin, shared between visitors via the same cache key as the single run. */
async function barsFor(coinId: string, days: number) {
  const cached = await cachedSource(`swingBars:${coinId}:${days}`, 30 * 60, () => fetchCgHourly(coinId, days), 6 * 3600);
  if (!cached.data) throw new Error(cached.status.error ?? 'پاسخ خالی');
  return { bars: cached.data.map(([t, p]) => ({ t, p })), status: cached.status };
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
      const cands = [...bySym.values()]
        .sort((a, b) => (b.total_volume ?? 0) - (a.total_volume ?? 0))
        .slice(0, MAX_SCAN)
        .map((c) => ({ id: c.id, symbol: String(c.symbol).toUpperCase(), name: c.name, meme: memeIds.has(c.id) }));
      if (!cands.length) throw new Error('فهرست ارزها در دسترس نبود.');

      const snap = await getSnapshot();
      const usdtToman = snap.live.items.find((i) => i.key === 'usdt')?.price ?? null;
      const usdtRial = isNum(usdtToman) ? usdtToman * 10 : null;

      const inputs = await Promise.all(
        cands.map(async (coin) => {
          try {
            const { bars } = await barsFor(coin.id, days);
            return { coin, bars };
          } catch (e) {
            return { coin, bars: null, error: errMsg(e) };
          }
        }),
      );
      const priors = buildPriors(await getSwingRuns());
      const scan = scanSwing(inputs, { capitalToman, preset, feePct, usdtRial }, pick, priors);

      // and run the selected basket over the whole window, as a normal portfolio
      const selIds = new Set(scan.selected.map((c) => c.coin.id));
      const portfolio = runSwingPortfolio(
        inputs.filter((i) => selIds.has(i.coin.id)),
        { capitalToman, preset, feePct, usdtRial },
      );
      // remember what happened, so later scans have evidence to work from
      await recordSwingRuns(
        portfolio.sleeves
          .filter((sl) => sl.ok && sl.result)
          .map((sl) => toRecord('scan', sl.coin, preset, days, feePct, sl.result!)),
      );
      return NextResponse.json({ scan, portfolio, days, preset: SWING_PRESETS[preset], priorsUsed: priors.size }, { headers: { 'Cache-Control': 'no-store' } });
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

      const snap = await getSnapshot();
      const usdtToman = snap.live.items.find((i) => i.key === 'usdt')?.price ?? null;
      const usdtRial = isNum(usdtToman) ? usdtToman * 10 : null;

      const inputs = await Promise.all(
        unique.map(async (coin) => {
          try {
            const { bars } = await barsFor(coin.id, days);
            return { coin, bars };
          } catch (e) {
            return { coin, bars: null, error: errMsg(e) };
          }
        }),
      );
      const portfolio = runSwingPortfolio(inputs, { capitalToman, preset, feePct, usdtRial });
      if (!isNum(usdtRial)) portfolio.warnings.push('قیمت تتر در دسترس نبود؛ محاسبه‌ها بر پایه دلار انجام شد.');
      await recordSwingRuns(
        portfolio.sleeves.filter((sl) => sl.ok && sl.result).map((sl) => toRecord('basket', sl.coin, preset, days, feePct, sl.result!)),
      );
      return NextResponse.json({ portfolio, preset: SWING_PRESETS[preset], days }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const coinId = String(body?.coinId ?? '').trim();
    if (!isCoinId(coinId)) throw new Error('شناسه ارز نامعتبر است.');
    const days = Math.max(7, Math.min(MAX_DAYS, Math.round(Number(body?.days ?? 60))));
    const capitalToman = Math.round(Number(body?.capitalToman));
    if (!isNum(capitalToman) || capitalToman < 1_000_000 || capitalToman > 1e13) throw new Error('سرمایه باید بین ۱ میلیون تومان و ۱۰ هزار میلیارد تومان باشد.');
    const preset = (Object.keys(SWING_PRESETS).includes(body?.preset) ? body.preset : 'normal') as SwingPreset;
    const feePct = isNum(Number(body?.feePct)) ? Math.max(0, Math.min(2, Number(body.feePct))) : 0.4;

    const snap = await getSnapshot();
    const usdtToman = snap.live.items.find((i) => i.key === 'usdt')?.price ?? null;
    const usdtRial = isNum(usdtToman) ? usdtToman * 10 : null;

    // hourly history is heavy and shared between visitors → cache per coin+window
    const cached = await cachedSource(`swingBars:${coinId}:${days}`, 30 * 60, () => fetchCgHourly(coinId, days), 6 * 3600);
    if (!cached.data) throw new Error(`دریافت تاریخچه ساعتی این ارز ممکن نشد: ${cached.status.error ?? 'پاسخ خالی'}`);

    const bars = cached.data.map(([t, p]) => ({ t, p }));
    const result = runSwing(bars, { id: coinId, symbol: String(body?.symbol ?? coinId).toUpperCase(), name: String(body?.name ?? coinId) }, { capitalToman, preset, feePct, usdtRial });

    if (!isNum(usdtRial)) result.warnings.push('قیمت تتر در دسترس نبود؛ محاسبه‌ها بر پایه دلار انجام شد و تغییر نرخ تتر در بازده لحاظ نشده است.');
    if (cached.status.stale) result.warnings.push('تاریخچه از کش خوانده شد و ممکن است چند ساعت قدیمی باشد.');

    await recordSwingRuns([toRecord('single', { id: coinId, symbol: String(body?.symbol ?? coinId).toUpperCase() }, preset, days, feePct, result)]);
    return NextResponse.json({ ...result, dataVia: cached.status.via, dataAgeSec: cached.status.ageSec }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 400 });
  }
}
