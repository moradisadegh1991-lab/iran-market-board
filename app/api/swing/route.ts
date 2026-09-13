import { NextResponse } from 'next/server';
import { errMsg } from '@/lib/http';
import { isNum } from '@/lib/num';
import { cachedSource } from '@/lib/sources/cache';
import { fetchCgHourly, fetchCgMarkets, type CgCoin } from '@/lib/sources/coingecko';
import { getSnapshot } from '@/lib/snapshot';
import { SWING_PRESETS, runSwing, type SwingPreset } from '@/lib/engine/swing';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_DAYS = 90;

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
    return NextResponse.json({
      coins: [...majors.map((m) => ({ ...m, meme: false, picked: false })), ...ranked],
      maxDays: MAX_DAYS,
      presets: Object.entries(SWING_PRESETS).map(([key, p]) => ({ key, label: p.label, note: p.note })),
      usdtRial: snap.live.items.find((i) => i.key === 'usdt')?.price ? snap.live.items.find((i) => i.key === 'usdt')!.price! * 10 : null,
    });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}

/** POST {coinId, symbol, name, days, capitalToman, preset, feePct} → one swing backtest. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const coinId = String(body?.coinId ?? '').trim();
    if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(coinId)) throw new Error('شناسه ارز نامعتبر است.');
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

    return NextResponse.json({ ...result, dataVia: cached.status.via, dataAgeSec: cached.status.ageSec }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 400 });
  }
}
