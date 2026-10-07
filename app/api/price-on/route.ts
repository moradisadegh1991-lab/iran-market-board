/**
 * GET /api/price-on?asset=usd&dates=2019-05-01,2023-11-20 — the close of one asset on each date (or the last trading
 * day before it: never after, rule 4), from the longest history the source has. For the asset page: what a purchase
 * cost in dollars on its own day. Read-only, no user data in or out beyond the dates asked (middleware.ts lets the
 * app call it).
 */
import { NextResponse } from 'next/server';
import { errMsg } from '@/lib/http';
import { closeOnOrBefore, LONG_UNIT, longHistory } from '@/lib/long-history';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const asset = u.searchParams.get('asset') ?? 'usd';
  const dates = (u.searchParams.get('dates') ?? '')
    .split(',')
    .map((d) => d.trim())
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .slice(0, 50);
  if (!LONG_UNIT[asset]) return NextResponse.json({ error: 'unknown asset' }, { status: 400 });
  if (!dates.length) return NextResponse.json({ error: 'dates=YYYY-MM-DD,…' }, { status: 400 });
  try {
    const series = await longHistory(asset);
    if (!series?.length) return NextResponse.json({ error: 'history unavailable' }, { status: 503 });
    const prices = Object.fromEntries(dates.map((d) => [d, closeOnOrBefore(series, d)]));
    return NextResponse.json(
      { asset, unit: LONG_UNIT[asset], from: series[0][0], to: series[series.length - 1][0], prices },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
    );
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}
