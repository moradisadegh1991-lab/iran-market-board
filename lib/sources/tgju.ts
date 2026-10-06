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

const OIL_SLUGS = ['oil_brent', 'brent_oil', 'crude_oil_brent', 'oil-brent', 'energy_brent_oil', 'anrژی-نفت-برنت', 'oil_energy_brent', 'oil'];
const DXY_SLUGS = ['dxy', 'usdx', 'dollar_index', 'us_dollar_index', 'usd_index', 'shakhes_dollar'];
const BOARD_SLUGS = ['price_dollar_rl', 'sekee', 'nim', 'rob', 'geram18', 'geram24', 'ons', 'silver_999', 'silver', ...OIL_SLUGS, ...DXY_SLUGS];

/** The live reply is ~160 KB; the board reads a dozen quotes of it. What is cached is just those. */
export function slimTgju(json: any): { current: Record<string, unknown> } {
  const cur = json?.current ?? {};
  return { current: Object.fromEntries(BOARD_SLUGS.filter((k) => cur[k]).map((k) => [k, { p: cur[k].p, dp: cur[k].dp, dt: cur[k].dt }])) };
}
export const fetchTgjuSlim = () => fetchTgju().then(slimTgju);

export function parseTgju(json: any) {
  const cur = json?.current ?? {};
  return {
    usd: quote(cur, 'price_dollar_rl'),
    coin: quote(cur, 'sekee'),
    nim: quote(cur, 'nim'),
    rob: quote(cur, 'rob'),
    g18: quote(cur, 'geram18'),
    g24: quote(cur, 'geram24'),
    ons: quote(cur, 'ons'),
    // TGJU names these the other way round to how they read: `silver_999` is the rial price of a
    // gram of 999 silver, while the bare `silver` key is the global USD/ounce quote.
    silver: quote(cur, 'silver_999'),
    silverOns: quote(cur, 'silver'),
    // exact key unconfirmed — see /api/diag's tgju.matchedKeys; falls back gracefully to null
    oilBrent: firstQuote(cur, OIL_SLUGS),
    dxy: firstQuote(cur, DXY_SLUGS),
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
