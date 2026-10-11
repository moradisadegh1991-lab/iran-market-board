/**
 * «فیوچرز» (rule 95), read-only: the leverage menu and limits for a coin, its last price and funding rate
 * (for the calculator), and the trend rider's backtest on its perpetual at every leverage step.
 * GET ?sym=BTC&mode=long|longshort[&backtest=1]
 */
import { NextResponse } from 'next/server';
import { errMsg } from '@/lib/http';
import { futuresBacktest, lastPrices } from '@/lib/futures-data';
import { okxFundingNow } from '@/lib/sources/funding';
import { BASE_FUNDING, FUTURES_EVIDENCE, LEVERAGES, maxLeverage, mmrOf, TAKER_FEE } from '@/lib/engine/futures';
import { PICK_UNIVERSE } from '@/lib/engine/coin-pick';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const sym = (u.searchParams.get('sym') ?? 'BTC').toUpperCase();
    if (!PICK_UNIVERSE.some((c) => c.sym === sym)) throw new Error('این ارز در فهرست فیوچرز نیست.');
    const mode = u.searchParams.get('mode') === 'longshort' ? 'longshort' : 'long';
    const [prices, funding, backtest] = await Promise.all([
      lastPrices([sym]),
      okxFundingNow(sym).catch(() => null),
      u.searchParams.get('backtest') === '1' ? futuresBacktest(sym, mode).catch((e) => ({ error: errMsg(e) })) : Promise.resolve(null),
    ]);
    return NextResponse.json(
      {
        sym, mode, price: prices[sym] ?? null,
        funding: funding ? { rate: funding.rate, next: funding.next, via: 'okx' } : { rate: BASE_FUNDING, next: null, via: 'assumed' },
        leverages: LEVERAGES.filter((l) => l <= maxLeverage(sym)), maxLeverage: maxLeverage(sym), mmr: mmrOf(sym), takerFee: TAKER_FEE,
        coins: PICK_UNIVERSE.map((c) => ({ sym: c.sym, name: c.name, maxLeverage: maxLeverage(c.sym) })),
        evidence: FUTURES_EVIDENCE,
        backtest,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } },
    );
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 400 });
  }
}
