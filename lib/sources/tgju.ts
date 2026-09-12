import { fetchJson } from '@/lib/http';
import { num, isNum } from '@/lib/num';

export const fetchTgju = () => fetchJson('https://call.tgju.org/ajax.json', { timeoutMs: 12_000 });

export interface Quote {
  price: number; // rial (ons: USD)
  changePct: number | null;
}

function quote(cur: any, slug: string): Quote | null {
  const it = cur?.[slug];
  if (!it) return null;
  const p = num(it.p);
  if (!isNum(p) || p <= 0) return null;
  const dp = num(it.dp);
  const dir = String(it.dt ?? '').toLowerCase() === 'low' ? -1 : 1;
  return { price: p, changePct: isNum(dp) ? Math.abs(dp) * dir : null };
}

export function parseTgju(json: any) {
  const cur = json?.current ?? {};
  return {
    usd: quote(cur, 'price_dollar_rl'),
    coin: quote(cur, 'sekee'),
    g18: quote(cur, 'geram18'),
    g24: quote(cur, 'geram24'),
    ons: quote(cur, 'ons'),
    // exact key unconfirmed — see /api/diag's tgju.matchedKeys; falls back gracefully to null
    oilBrent: firstQuote(cur, ['oil_brent', 'brent_oil', 'crude_oil_brent', 'oil-brent', 'energy_brent_oil', 'anrژی-نفت-برنت', 'oil_energy_brent', 'oil']),
    dxy: firstQuote(cur, ['dxy', 'usdx', 'dollar_index', 'us_dollar_index', 'usd_index', 'shakhes_dollar']),
  };
}

/** First matching key with a plausible quote, tried in order. */
function firstQuote(cur: any, slugs: string[]): Quote | null {
  for (const s of slugs) {
    const q = quote(cur, s);
    if (q) return q;
  }
  return null;
}

/** Keys in the live payload whose name hints at oil or the dollar index — for /api/diag calibration. */
export function findLikelyKeys(json: any, needles: string[]): string[] {
  const cur = json?.current ?? {};
  return Object.keys(cur).filter((k) => needles.some((n) => k.toLowerCase().includes(n)));
}
