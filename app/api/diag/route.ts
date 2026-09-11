// Connectivity + schema check from Vercel's IP. Open once after deploy: /api/diag?secret=ADMIN_SECRET
import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { storeMode, kv } from '@/lib/store';
import { errMsg, fetchJson } from '@/lib/http';
import { fetchTgju, parseTgju } from '@/lib/sources/tgju';
import { fetchGoldApi, parseGoldApi } from '@/lib/sources/goldapi';
import { fetchNobitexDaily, fetchNobitexStats, parseNobitex } from '@/lib/sources/nobitex';
import { fetchBrsIndex, fetchBrsSymbols, fetchBrsGoldCurrency, parseBrsIndex, parseBrsSymbols, parseBrsTetherRial } from '@/lib/sources/brsapi';
import { fetchCgMarkets } from '@/lib/sources/coingecko';

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
      return p.usd || p.coin || p.g18 ? p : null;
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
    probe('coingecko', () => fetchCgMarkets(undefined, 5), (j) => (Array.isArray(j) ? j.map((c: any) => c.symbol) : null)),
    probe('telegram', () => fetchJson(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`), (j) => j?.result?.username ?? null),
  ]);
  return NextResponse.json({ ok: results.every((r) => r.ok) && storeOk, storeMode, storeOk, results });
}
