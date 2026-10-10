/**
 * GET /api/forecast-news?asset=usd — the recent headlines for the forecast page's «چرا این پیش‌بینی؟» (rule 94).
 *
 * Read-only, holds no user data (the app may call it, middleware.ts). The headlines come from Google News RSS (English: the
 * Persian feeds return nothing to US hosts) and are scored by the same lexicon the trader uses (lib/news.ts). They explain a
 * forecast; they never change its numbers (lib/engine/forecast-why.ts).
 */
import { NextResponse } from 'next/server';
import { newsView, NEWS_ASSET } from '@/lib/engine/forecast-why';
import { FORECAST_ASSETS } from '@/lib/forecast-meta';
import { errMsg } from '@/lib/http';
import { loadNews } from '@/lib/news';
import { tehranDate } from '@/lib/num';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const DAY = 86_400_000;
const DAYS = 45;
/** the same answer for half an hour: the feeds change by the hour at most and each read is several requests */
const cache = new Map<string, { at: number; body: unknown }>();
const TTL = 30 * 60_000;
const BUDGET_MS = 14_000;

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('asset') ?? '';
  const meta = FORECAST_ASSETS.find((a) => a.key === key);
  const sim = NEWS_ASSET[key];
  if (!meta) return NextResponse.json({ error: 'دارایی نامعتبر است.' }, { status: 400 });
  if (!sim) return NextResponse.json({ asset: key, view: null, note: 'برای این دارایی منبع خبری تعریف نشده.' });
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return respond(hit.body);
  try {
    const today = tehranDate();
    const start = tehranDate(new Date(Date.now() - (DAYS + 2) * DAY));
    const load = await loadNews(start, today, [sim], Date.now() + BUDGET_MS, { langs: ['en'] });
    const body = {
      asset: key,
      label: meta.label,
      view: newsView(load.items, key, today, { days: DAYS }),
      sources: load.sources,
      reviewed: load.reviewed,
      chunks: { loaded: load.chunksLoaded, total: load.chunksTotal },
      // Persian headlines are not read: Google News answers US hosts with an empty feed
      persian: false,
      errors: load.errors.length,
      asOf: today,
    };
    // an empty answer because the sources were unreachable is not worth keeping for half an hour
    if (load.chunksLoaded > 0) cache.set(key, { at: Date.now(), body });
    return respond(body);
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}

const respond = (body: unknown) => NextResponse.json(body, { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' } });
