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
  };
}
