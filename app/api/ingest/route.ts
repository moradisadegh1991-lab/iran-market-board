// Push data from a machine with an Iranian IP (n8n / cron / script) when a source blocks Vercel.
//   {"source":"tgju"|"goldapi"|"nobitex"|"brsIndex"|"brsSymbols", "data": <raw JSON of that API>}
//   {"kind":"daily", "asset":"usd|usdt|g18|coin|ons|btc|eth|tse", "points":[{"date":"2026-01-31","value":123}]}   (rial for IRR assets)
//   {"kind":"tse", "symbols":{"فولاد":[{"date":"2026-01-31","close":5230,"value":1.2e11}]}}
import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { ingestSource } from '@/lib/sources/cache';
import { ASSET_KEYS, loadDaily, loadTse, mergeTseBackfill, saveDaily, saveTse, upsertDailyPoint } from '@/lib/history';
import { kv } from '@/lib/store';
import type { AssetKey } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const SOURCES = new Set(['tgju', 'goldapi', 'nobitex', 'brsIndex', 'brsSymbols']);

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });

  if (body.source) {
    if (!SOURCES.has(body.source) || body.data === undefined) return NextResponse.json({ ok: false, error: 'unknown source or missing data' }, { status: 400 });
    await ingestSource(body.source, body.data);
    await kv.del('snapshot:v1');
    return NextResponse.json({ ok: true, source: body.source });
  }
  if (body.kind === 'daily') {
    if (!ASSET_KEYS.includes(body.asset) || !Array.isArray(body.points)) return NextResponse.json({ ok: false, error: 'bad asset/points' }, { status: 400 });
    const store = await loadDaily();
    let n = 0;
    for (const p of body.points) {
      if (typeof p?.date === 'string' && Number.isFinite(Number(p.value))) {
        upsertDailyPoint(store, p.date, { [body.asset as AssetKey]: Number(p.value) });
        n++;
      }
    }
    await saveDaily(store);
    await kv.del('snapshot:v1');
    return NextResponse.json({ ok: true, merged: n, days: store.dates.length });
  }
  if (body.kind === 'tse' && body.symbols && typeof body.symbols === 'object') {
    const store = await loadTse();
    const n = mergeTseBackfill(store, body.symbols);
    await saveTse(store);
    await kv.del('snapshot:v1');
    return NextResponse.json({ ok: true, merged: n, days: store.dates.length, symbols: Object.keys(store.sym).length });
  }
  return NextResponse.json({ ok: false, error: 'unsupported payload' }, { status: 400 });
}
