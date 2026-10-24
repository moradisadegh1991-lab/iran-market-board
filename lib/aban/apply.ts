// The Abantether basis applied to a bot's prices (rule 102). Pure.
import { SIM_ASSETS, type SimAsset } from '@/lib/engine/simulator';
import { basisNote, halfSpreadPct, usdtMidToman, type AbanBasis } from './basis';

const SYMBOL: Partial<Record<SimAsset, string>> = { btc: 'BTC', eth: 'ETH', sol: 'SOL', xrp: 'XRP', ton: 'TON', doge: 'DOGE' };

/**
 * The daily engine's crypto at Abantether: each coin's live quote becomes the mid of Abantether's toman buy/sell (rial),
 * and its cost per side the fee plus half that coin's spread — so a buy fills at Abantether's buy price plus fee and a
 * sell at its sell price minus fee. A coin Abantether does not quote, or one more than 25% away from the board's own
 * quote, keeps the board's price and the engine's cost. Dollar, gold, coin and the bourse are not on Abantether: untouched.
 */
export function abanQuotes(quotes: Partial<Record<SimAsset, number>>, b: AbanBasis): { quotes: Partial<Record<SimAsset, number>>; costs: Partial<Record<SimAsset, number>>; used: SimAsset[] } {
  const out = { ...quotes };
  const costs: Partial<Record<SimAsset, number>> = {};
  const used: SimAsset[] = [];
  for (const a of SIM_ASSETS) {
    const sym = SYMBOL[a.key];
    const c = sym ? b.coins[sym] : undefined;
    if (!c) continue;
    const mid = ((c.buy + c.sell) / 2) * 10;
    const board = quotes[a.key];
    if (board && board > 0 && Math.abs(mid / board - 1) > 0.25) continue;
    out[a.key] = mid;
    costs[a.key] = (b.feePct + halfSpreadPct(c.buy, c.sell)) / 100;
    used.push(a.key);
  }
  return { quotes: out, costs, used };
}

/** the USDT rate (rial) a crypto bot converts at, from the basis */
export const abanUsdtRial = (b: AbanBasis) => usdtMidToman(b) * 10;

export { basisNote };
