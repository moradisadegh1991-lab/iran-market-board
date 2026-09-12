import { NextResponse } from 'next/server';
import { errMsg } from '@/lib/http';
import { isNum } from '@/lib/num';
import { cachedSource } from '@/lib/sources/cache';
import { fetchCgHourly } from '@/lib/sources/coingecko';
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
    const screened = [...snap.crypto.coins, ...snap.crypto.memes]
      .filter((c) => !seen.has(c.id) && (seen.add(c.id), true))
      .slice(0, 16)
      .map((c) => ({ id: c.id, symbol: c.symbol.toUpperCase(), name: c.name }));
    return NextResponse.json({
      coins: [...majors, ...screened],
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
