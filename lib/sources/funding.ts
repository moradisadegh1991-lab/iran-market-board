// Funding rates of USDT perpetuals, for the paper futures account and the leveraged backtest.
//  • OKX public API: the current rate and the last ~100 settlements (≈33 days at 8 h). Reachable from US
//    hosts (Binance's own futures API answers 451 there). Settlement times come from the exchange.
//  • Binance's public archive (data.binance.vision): one zip per coin per month since 2020 — the history the
//    leveraged backtest needs. Each zip holds one small CSV (calc_time, interval_hours, rate).
import { inflateRawSync } from 'node:zlib';
import { fetchJson } from '@/lib/http';
import { isNum } from '@/lib/num';

export interface FundingEvent { t: number; rate: number }

/** OKX instrument for a base symbol (OKX lists SHIB and PEPE per coin, like spot) */
const okxInst = (sym: string) => `${sym.toUpperCase()}-USDT-SWAP`;
/** Binance perpetual symbol for a base symbol */
export const binancePerp = (sym: string) => (['SHIB', 'PEPE'].includes(sym.toUpperCase()) ? `1000${sym.toUpperCase()}USDT` : `${sym.toUpperCase()}USDT`);

/** current rate and next settlement time; null when OKX does not list the coin */
export async function okxFundingNow(sym: string): Promise<{ rate: number; next: number | null } | null> {
  const inst = okxInst(sym);
  const j = await fetchJson<{ code: string; data: { instId: string; fundingRate: string; nextFundingTime?: string; fundingTime?: string }[] }>(
    `https://www.okx.com/api/v5/public/funding-rate?instId=${inst}`,
    { timeoutMs: 10_000, retries: 1 },
  );
  // an unknown instId makes OKX answer with some other instrument — check it is ours
  const d = j?.data?.find((x) => x.instId === inst);
  if (!d || !isNum(+d.fundingRate)) return null;
  return { rate: +d.fundingRate, next: d.fundingTime ? +d.fundingTime : null };
}

/** settlements since `from` (OKX keeps ~3 months; one page = 100 settlements) */
export async function okxFundingHistory(sym: string, from: number): Promise<FundingEvent[] | null> {
  const inst = okxInst(sym);
  const out: FundingEvent[] = [];
  let after = '';
  for (let page = 0; page < 3; page++) {
    const j = await fetchJson<{ code: string; data: { instId: string; realizedRate?: string; fundingRate: string; fundingTime: string }[] }>(
      `https://www.okx.com/api/v5/public/funding-rate-history?instId=${inst}&limit=100${after ? `&after=${after}` : ''}`,
      { timeoutMs: 10_000, retries: 1 },
    );
    const rows = (j?.data ?? []).filter((x) => x.instId === inst);
    if (!rows.length) break;
    for (const r of rows) {
      const rate = +(r.realizedRate ?? r.fundingRate);
      if (isNum(rate) && isNum(+r.fundingTime)) out.push({ t: +r.fundingTime, rate });
    }
    const oldest = Math.min(...rows.map((r) => +r.fundingTime));
    if (oldest <= from || rows.length < 100) break;
    after = String(oldest);
  }
  if (!out.length) return null;
  return out.filter((e) => e.t >= from).sort((a, b) => a.t - b.t);
}

/** the single file inside a Binance archive zip (local header carries the sizes; deflate or stored) */
export function unzipFirst(buf: Buffer): string {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('zip نامعتبر');
  const method = buf.readUInt16LE(8);
  const size = buf.readUInt32LE(18);
  const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  const body = buf.subarray(start, start + size);
  return (method === 8 ? inflateRawSync(body) : body).toString('utf8');
}

/** daily mean per-8h rate (sum of the day's settlements ÷ 3) for `months` ("YYYY-MM"); missing months skipped */
export async function binanceFundingDaily(sym: string, months: string[]): Promise<Map<number, number>> {
  const perp = binancePerp(sym);
  const acc = new Map<number, number>();
  const DAY = 86_400_000;
  await Promise.all(
    months.map(async (ym) => {
      try {
        const r = await fetch(`https://data.binance.vision/data/futures/um/monthly/fundingRate/${perp}/${perp}-fundingRate-${ym}.zip`, { signal: AbortSignal.timeout(15_000) });
        if (!r.ok) return;
        const csv = unzipFirst(Buffer.from(await r.arrayBuffer()));
        for (const line of csv.split('\n').slice(1)) {
          const [t, , rate] = line.split(',');
          if (!t || !isNum(+t) || !isNum(+rate)) continue;
          const d = Math.floor(+t / DAY) * DAY;
          acc.set(d, (acc.get(d) ?? 0) + +rate);
        }
      } catch {
        /* a missing month falls back to the base rate in the engine */
      }
    }),
  );
  return new Map([...acc].map(([d, s]) => [d, s / 3]));
}

/** "YYYY-MM" for each full month in [from, to) */
export function monthsBetween(from: number, to: number): string[] {
  const out: string[] = [];
  const d = new Date(from);
  d.setUTCDate(1);
  while (d.getTime() < to) {
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    if (next.getTime() <= to) out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    d.setTime(next.getTime());
  }
  return out;
}
