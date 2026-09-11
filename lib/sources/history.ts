// Long daily histories that are reachable from Vercel (Nobitex UDF is blocked there).
//  • TGJU "summary-table-data": rows [open, low, high, close, change, change%, 'YYYY/MM/DD', jalali], newest first, rial (ons: USD)
//  • TSE total index: TSETMC CDN first, BrsApi History as fallback
import { fetchJson } from '@/lib/http';
import { isNum, num, pick } from '@/lib/num';

export type DatedPairs = [string, number][]; // ['YYYY-MM-DD', value] ascending

const KEEP_DAYS = 460;

function tidy(pairs: DatedPairs): DatedPairs {
  const m = new Map<string, number>();
  for (const [d, v] of pairs) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && isNum(v) && v > 0) m.set(d, v);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-KEEP_DAYS);
}

export const TGJU_SLUGS = { usd: 'price_dollar_rl', coin: 'sekee', g18: 'geram18', ons: 'ons' } as const;

export async function fetchTgjuHistory(slug: string): Promise<DatedPairs> {
  const json = await fetchJson(`https://api.tgju.org/v1/market/indicator/summary-table-data/${slug}`, { timeoutMs: 20_000 });
  const rows: unknown[] = Array.isArray(json?.data) ? json.data : [];
  const out: DatedPairs = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 7) continue;
    const close = num(String(row[3]).replace(/<[^>]+>/g, ''));
    const g = String(row[6]).replace(/<[^>]+>/g, '').trim(); // 2023/12/14
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(g);
    if (!m || !isNum(close)) continue;
    out.push([`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, close]);
  }
  if (out.length < 10) throw new Error(`TGJU ${slug}: ${out.length} rows`);
  return tidy(out);
}

const dEvenToIso = (d: unknown) => {
  const s = String(d ?? '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
};

/** Total index (TEDPIX) daily closes. Tries TSETMC CDN, then BrsApi History (free tier: 10 req/day — cached 12h). */
export async function fetchTseIndexHistory(): Promise<{ pairs: DatedPairs; via: string }> {
  const errors: string[] = [];
  try {
    const json = await fetchJson('https://cdn.tsetmc.com/api/Index/GetIndexB2History/32097828799138957', { timeoutMs: 15_000, retries: 0 });
    const rows: any[] = Array.isArray(json?.indexB2) ? json.indexB2 : [];
    const pairs = tidy(rows.map((r) => [dEvenToIso(r.dEven), num(r.xNivInuClMresIbs)] as [string, number]));
    if (pairs.length >= 10) return { pairs, via: 'TSETMC' };
    errors.push(`TSETMC: ${pairs.length} rows`);
  } catch (e) {
    errors.push(`TSETMC: ${e instanceof Error ? e.message : e}`);
  }
  const key = process.env.BRSAPI_KEY;
  if (key) {
    const base = (process.env.BRSAPI_BASE || 'https://Api.BrsApi.ir').replace(/\/$/, '');
    try {
      const json = await fetchJson(`${base}/Tsetmc/History.php?key=${key}&type=0&l18=${encodeURIComponent('شاخص کل')}`, { timeoutMs: 20_000, retries: 0 });
      const rows: any[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.history) ? json.history : [];
      const pairs = tidy(
        rows.map((r) => {
          const rawDate = String(pick(r, ['date_miladi', 'gregorian_date', 'date_en', 'date']) ?? '');
          const iso = dEvenToIso(rawDate.replace(/\D/g, '').slice(0, 8)) || rawDate.slice(0, 10).replace(/\//g, '-');
          return [iso, num(pick(r, ['pc', 'close', 'pClosing', 'value', 'index']))] as [string, number];
        }),
      );
      if (pairs.length >= 10) return { pairs, via: 'BrsApi' };
      errors.push(`BrsApi: ${pairs.length} rows`);
    } catch (e) {
      errors.push(`BrsApi: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error(errors.join(' | '));
}

export function pairsFromDated(p: DatedPairs | null | undefined): Map<string, number> {
  return new Map((p ?? []).filter(([, v]) => isNum(v) && v > 0));
}
