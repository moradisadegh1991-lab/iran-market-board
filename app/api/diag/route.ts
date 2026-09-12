// Connectivity + schema check from Vercel's IP. Open once after deploy: /api/diag?secret=ADMIN_SECRET
import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { storeMode, kv } from '@/lib/store';
import { errMsg, fetchJson } from '@/lib/http';
import { fetchTgju, findLikelyKeys, parseTgju } from '@/lib/sources/tgju';
import { fetchGoldApi, parseGoldApi } from '@/lib/sources/goldapi';
import { fetchNobitexDaily, fetchNobitexStats, parseNobitex } from '@/lib/sources/nobitex';
import { fetchBrsIndex, fetchBrsSymbols, fetchBrsGoldCurrency, parseBrsIndex, parseBrsMarketBook, parseBrsSymbols, parseBrsTetherRial } from '@/lib/sources/brsapi';
import { fetchCgMarkets } from '@/lib/sources/coingecko';
import { fetchGdeltNews, fetchGoogleNews } from '@/lib/sources/news';
import { TGJU_SLUGS, fetchTgjuHistory, fetchTseIndexHistory } from '@/lib/sources/history';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function probe(name: string, run: () => Promise<any>, check: (json: any) => unknown) {
  const t = Date.now();
  try {
    const json = await run();
    const parsed = check(json);
    const first = Array.isArray(json) ? json[0] : Array.isArray(json?.data) ? json.data[0] : json;
    return {
      name,
      ok: parsed !== null && parsed !== undefined && !(Array.isArray(parsed) && parsed.length === 0),
      ms: Date.now() - t,
      parsed,
      rawKeys: first && typeof first === 'object' ? Object.keys(first).slice(0, 60) : null,
      sample: JSON.stringify(first).slice(0, 400),
    };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t, error: errMsg(e) };
  }
}

/** first day of the month n months ago, YYYY-MM-DD */
const monthAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
};

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  let storeOk = false;
  try {
    await kv.set('diag:ping', Date.now(), 60);
    storeOk = !!(await kv.get('diag:ping'));
  } catch {}
  const results = await Promise.all([
    probe('tgju', fetchTgju, (j) => {
      const p = parseTgju(j);
      return p.usd || p.coin || p.g18
        ? {
            ...p,
            // نفت برنت و DXY هنوز حدسی‌اند؛ اگر null ماندند، این دو فهرست را برای من بفرستید تا کلید درست را پیدا کنم
            oilLikelyKeys: findLikelyKeys(j, ['oil', 'brent', 'crude', 'naft', 'نفت']),
            dollarIndexLikelyKeys: findLikelyKeys(j, ['dxy', 'usdx', 'dollar_index', 'dollar-index', 'usd_index']),
          }
        : null;
    }),
    probe('goldapi', fetchGoldApi, parseGoldApi),
    probe('nobitex', fetchNobitexStats, (j) => {
      const p = parseNobitex(j);
      return p.usdtRls ? p : null;
    }),
    probe('nobitexUdf', () => fetchNobitexDaily('USDTIRT', 10), (j) => (Array.isArray(j) ? j.length : null)),
    probe('brsIndex', fetchBrsIndex, parseBrsIndex),
    probe('brsSymbols', fetchBrsSymbols, (j) => {
      const rows = parseBrsSymbols(j);
      return rows.length ? { count: rows.length, first: rows[0], withFlow: rows.filter((r) => r.netRealFlow !== null).length } : null;
    }),
    // sanity check skipped here (no usdRial in scope) — shows the raw match so you can eyeball the unit/field names
    probe('brsGoldCurrency', fetchBrsGoldCurrency, (j) => parseBrsTetherRial(j, null)),
    // symbols + units behind مدیریت دارایی واقعی — confirm the IR_GOLD_* / IR_COIN_* / currency keys here
    probe('brsMarketBook', fetchBrsGoldCurrency, (j) => {
      const items = parseBrsMarketBook(j);
      return items.length ? { count: items.length, symbols: items.map((i) => i.symbol).slice(0, 40), units: [...new Set(items.map((i) => i.unit))], sample: items.slice(0, 3) } : null;
    }),
    // long daily history used when Nobitex is blocked: dollar/coin/18k from TGJU, TEDPIX from TSETMC or BrsApi
    probe('tgjuHistUsd', () => fetchTgjuHistory(TGJU_SLUGS.usd), (p: any) => (Array.isArray(p) && p.length ? { days: p.length, first: p[0], last: p[p.length - 1] } : null)),
    probe('tgjuHistCoin', () => fetchTgjuHistory(TGJU_SLUGS.coin), (p: any) => (Array.isArray(p) && p.length ? { days: p.length, last: p[p.length - 1] } : null)),
    probe('tseIndexHist', fetchTseIndexHistory, (r: any) => (r?.pairs?.length ? { via: r.via, days: r.pairs.length, last: r.pairs[r.pairs.length - 1] } : null)),
    probe('coingecko', () => fetchCgMarkets(undefined, 5), (j) => (Array.isArray(j) ? j.map((c: any) => c.symbol) : null)),
    probe('telegram', () => fetchJson(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`), (j) => j?.result?.username ?? null),
    // news for the simulator: a finished month, so results must be dated inside it
    probe('googleNewsFa', () => fetchGoogleNews('قیمت دلار', monthAgo(2), monthAgo(1), 'fa'), (items) => (items.length ? { count: items.length, first: items[0], inRange: items.filter((i: any) => i.ms >= Date.parse(`${monthAgo(2)}T00:00:00Z`) - 2 * 86400000 && i.ms < Date.parse(`${monthAgo(1)}T00:00:00Z`) + 2 * 86400000).length } : null)),
    probe('googleNewsEn', () => fetchGoogleNews('bitcoin price', monthAgo(2), monthAgo(1), 'en'), (items) => (items.length ? { count: items.length, first: items[0] } : null)),
    probe('gdeltNews', () => fetchGdeltNews('(bitcoin price)', monthAgo(2), monthAgo(1)), (items) => (items.length ? { count: items.length, first: items[0] } : null)),
    probe('telegramWebhook', () => fetchJson(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`), (j) => {
      const r = j?.result;
      if (!r) return null;
      // ok means "a webhook URL is registered and Telegram reports no delivery error" — run /api/telegram/setup if this is null/empty/erroring
      return r.url ? { url: r.url, pending_update_count: r.pending_update_count, last_error_date: r.last_error_date ?? null, last_error_message: r.last_error_message ?? null } : null;
    }),
  ]);
  return NextResponse.json({ ok: results.every((r) => r.ok) && storeOk, storeMode, storeOk, results });
}
