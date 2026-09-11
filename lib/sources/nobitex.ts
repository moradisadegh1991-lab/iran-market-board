import { fetchJson } from '@/lib/http';
import { num, isNum } from '@/lib/num';

const BASE = 'https://api.nobitex.ir';

export const fetchNobitexStats = () =>
  fetchJson(`${BASE}/market/stats?srcCurrency=usdt,btc,eth&dstCurrency=rls,usdt`, { timeoutMs: 12_000 });

export function parseNobitex(json: any) {
  const s = json?.stats ?? {};
  const q = (k: string) => {
    const it = s[k];
    if (!it || it.isClosed) return null;
    const latest = num(it.latest);
    const dc = num(it.dayChange);
    return isNum(latest) && latest > 0 ? { price: latest, changePct: isNum(dc) ? dc : null } : null;
  };
  return { usdtRls: q('usdt-rls'), btcUsdt: q('btc-usdt'), ethUsdt: q('eth-usdt') };
}

/** Which symbols have an open RLS market (for the screener's "tradable in Iran" flag) */
export async function fetchNobitexTradable(symbols: string[]): Promise<string[]> {
  const list = [...new Set(symbols.map((s) => s.toLowerCase()).filter((s) => /^[a-z0-9]+$/.test(s)))].slice(0, 80);
  if (!list.length) return [];
  const json = await fetchJson(`${BASE}/market/stats?srcCurrency=${list.join(',')}&dstCurrency=rls`, { timeoutMs: 12_000 });
  const stats = json?.stats ?? {};
  return Object.entries(stats)
    .filter(([, v]: [string, any]) => v && !v.isClosed && isNum(num(v.latest)))
    .map(([k]) => k.split('-')[0]);
}

/** Daily closes; Nobitex UDF returns { s, t[], c[] } */
export async function fetchNobitexDaily(symbol: string, days = 420): Promise<[number, number][]> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 86400;
  const json = await fetchJson(`${BASE}/market/udf/history?symbol=${symbol}&resolution=D&from=${from}&to=${to}`, {
    timeoutMs: 15_000,
  });
  if (json?.s !== 'ok' || !Array.isArray(json.t)) throw new Error(`UDF ${symbol}: ${json?.s ?? 'bad response'}`);
  return json.t.map((t: number, i: number) => [t * 1000, num(json.c[i])] as [number, number]).filter(([, c]: [number, number]) => isNum(c) && c > 0);
}
