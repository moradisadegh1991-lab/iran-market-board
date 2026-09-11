import { fetchJson } from '@/lib/http';
import { num, isNum, normSymbol, pick } from '@/lib/num';

const base = () => (process.env.BRSAPI_BASE || 'https://Api.BrsApi.ir').replace(/\/$/, '');
const key = () => {
  const k = process.env.BRSAPI_KEY;
  if (!k) throw new Error('BRSAPI_KEY is not set');
  return k;
};

export const fetchBrsIndex = () =>
  fetchJson(`${base()}/Tsetmc/Index.php?key=${key()}&type=1`, { timeoutMs: 15_000 });

export const fetchBrsSymbols = () =>
  fetchJson(
    `${base()}/Tsetmc/AllSymbols.php?key=${key()}${process.env.BRSAPI_SYMBOLS_QUERY ? `&${process.env.BRSAPI_SYMBOLS_QUERY}` : ''}`,
    { timeoutMs: 25_000 },
  );

function asArray(json: any): any[] {
  if (Array.isArray(json)) return json;
  for (const k of ['data', 'symbols', 'result', 'items', 'index']) if (Array.isArray(json?.[k])) return json[k];
  return json && typeof json === 'object' ? [json] : [];
}

/** Total index (شاخص کل). Field names are matched defensively — check /api/diag output once. */
export function parseBrsIndex(json: any): { value: number; changePct: number | null } | null {
  const arr = asArray(json?.data && !Array.isArray(json.data) ? json.data : json);
  const nameOf = (o: any) => String(pick(o, ['name', 'l30', 'title', 'index_name', 'lVal30']) ?? '');
  const main =
    arr.find((o) => /شاخص\s*کل/.test(nameOf(o)) && !/هم\s*وزن|فرابورس/.test(nameOf(o))) ??
    arr.find((o) => isNum(num(pick(o, ['value', 'index_value', 'last_value', 'close'])))) ??
    arr[0];
  if (!main) return null;
  const value = num(pick(main, ['value', 'index_value', 'last_value', 'close', 'xNivInuClMresIbs', 'pl', 'pc']));
  const changePct = num(pick(main, ['change_percent', 'percent', 'change_pct', 'xVarIdxJRfV', 'plp', 'pcp']));
  if (!isNum(value) || value <= 0) return null;
  return { value, changePct: isNum(changePct) ? changePct : null };
}

export interface TseSymbol {
  symbol: string;
  name: string;
  last: number | null; // rial
  close: number | null; // rial (final)
  chgPct: number | null; // final change %
  lastChgPct: number | null;
  tno: number;
  tvol: number;
  tval: number; // rial
  mv: number | null;
  pe: number | null;
  eps: number | null;
  maxAllowed: number | null;
  netRealFlow: number | null; // rial, individuals buy - sell (if provided)
}

const EXCLUDE_NAME = /صندوق|اوراق|صکوک|اجاره|مرابحه|حق\s*تقدم|تسهیلات|گواهی|اختیار|آتی|سلف|منفعت|استصناع/;

export function parseBrsSymbols(json: any): TseSymbol[] {
  const arr = asArray(json);
  const out: TseSymbol[] = [];
  const bySymbol = new Set<string>();
  for (const s of arr) {
    const symbol = normSymbol(pick(s, ['l18', 'symbol', 'name']));
    if (!symbol) continue;
    bySymbol.add(symbol);
  }
  for (const s of arr) {
    const symbol = normSymbol(pick(s, ['l18', 'symbol']));
    const name = String(pick(s, ['l30', 'full_name', 'title']) ?? '').trim();
    if (!symbol || /[0-9۰-۹]/.test(symbol)) continue; // bonds/options carry digits
    if (EXCLUDE_NAME.test(name)) continue;
    if (symbol.endsWith('ح') && bySymbol.has(symbol.slice(0, -1))) continue; // rights issue
    const price = (k: string[]) => {
      const v = num(pick(s, k));
      return isNum(v) && v > 0 ? v : null;
    };
    const pct = (k: string[]) => {
      const v = num(pick(s, k));
      return isNum(v) ? v : null;
    };
    const buyI = num(pick(s, ['Buy_I_Value', 'buy_i_value', 'Buy_I_Volume', 'buy_i_volume']));
    const sellI = num(pick(s, ['Sell_I_Value', 'sell_i_value', 'Sell_I_Volume', 'sell_i_volume']));
    const isVolume = pick(s, ['Buy_I_Value', 'buy_i_value']) === undefined;
    const closeP = price(['pc', 'pClosing', 'close_price']);
    let flow: number | null = isNum(buyI) && isNum(sellI) ? buyI - sellI : null;
    if (flow !== null && isVolume && closeP) flow *= closeP;
    out.push({
      symbol,
      name,
      last: price(['pl', 'pDrCotVal', 'last_price']),
      close: closeP,
      chgPct: pct(['pcp', 'close_change_percent']),
      lastChgPct: pct(['plp', 'last_change_percent']),
      tno: num(pick(s, ['tno', 'zTotTran'])) || 0,
      tvol: num(pick(s, ['tvol', 'qTotTran5J'])) || 0,
      tval: num(pick(s, ['tval', 'qTotCap'])) || 0,
      mv: price(['mv', 'market_value']),
      pe: pct(['pe', 'P/E']),
      eps: pct(['eps']),
      maxAllowed: price(['tmax', 'psGelStaMax']),
      netRealFlow: flow,
    });
  }
  return out;
}
