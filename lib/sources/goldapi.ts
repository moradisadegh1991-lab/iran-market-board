import { fetchJson } from '@/lib/http';
import { num, isNum } from '@/lib/num';

export const fetchGoldApi = () => fetchJson('https://api.gold-api.com/price/XAU', { timeoutMs: 10_000 });

export function parseGoldApi(json: any): number | null {
  const p = num(json?.price);
  return isNum(p) && p > 0 ? p : null;
}
