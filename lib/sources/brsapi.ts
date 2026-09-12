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

/** Free "Gold_Currency" feed (package Market_CGCC) — includes a cryptocurrency block with Tether.
 *  Used only as a fallback for USDT/IRT when Nobitex is unreachable (e.g. blocked from Vercel's IP). */
export const fetchBrsGoldCurrency = () => fetchJson(`${base()}/Market/Gold_Currency.php?key=${key()}`, { timeoutMs: 15_000 });

export interface BrsMarketItem {
  symbol: string;
  name: string;
  price: number;
  unit: string | null; // as reported by the feed ("تومان", "دلار", …) — carried through, not guessed
  changePct: number | null;
  group: 'gold' | 'currency' | 'crypto' | 'other';
}

/**
 * Flattens the free Gold_Currency (Market_CGCC) feed into a price book keyed by symbol,
 * e.g. IR_GOLD_18K, IR_COIN_EMAMI, USD, USDT. The group comes from the containing array.
 * Field names are read defensively and the feed's own `unit` is preserved rather than assumed —
 * inspect /api/diag → brsMarketBook once after deploying to confirm symbols and units.
 */
export function parseBrsMarketBook(json: any): BrsMarketItem[] {
  const groupOf = (k: string): BrsMarketItem['group'] => (/gold/i.test(k) ? 'gold' : /crypto/i.test(k) ? 'crypto' : /currency/i.test(k) ? 'currency' : 'other');
  const out: BrsMarketItem[] = [];
  const seen = new Set<string>();
  const take = (o: any, group: BrsMarketItem['group']) => {
    if (!o || typeof o !== 'object') return;
    const symbol = String(pick(o, ['symbol', 'symbol_en', 'en_symbol', 'code']) ?? '').trim().toUpperCase();
    const price = num(pick(o, ['price', 'value', 'p', 'last_price', 'close_price']));
    if (!symbol || !isNum(price) || price <= 0 || seen.has(symbol)) return;
    seen.add(symbol);
    const unit = pick(o, ['unit']);
    out.push({
      symbol,
      name: String(pick(o, ['name', 'name_fa', 'title', 'name_en']) ?? symbol),
      price,
      unit: typeof unit === 'string' && unit.trim() ? unit.trim() : null,
      changePct: num(pick(o, ['change_percent', 'percent', 'dp'])),
      group,
    });
  };
  if (Array.isArray(json)) json.forEach((o) => take(o, 'other'));
  else if (json && typeof json === 'object') {
    for (const [k, v] of Object.entries(json)) if (Array.isArray(v)) v.forEach((o) => take(o, groupOf(k)));
  }
  return out;
}

export const brsPriceBook = (json: any): Record<string, BrsMarketItem> => Object.fromEntries(parseBrsMarketBook(json).map((i) => [i.symbol, i]));

/** Recursively collect every array found anywhere in the payload (grouping is unconfirmed — see /api/diag). */
function allArrays(json: any, depth = 0): any[][] {
  if (depth > 3 || !json || typeof json !== 'object') return [];
  if (Array.isArray(json)) return [json];
  return Object.values(json).flatMap((v) => allArrays(v, depth + 1));
}

/**
 * Tether/USDT price from the free Gold_Currency feed, in Rial. Field names AND the price unit
 * (Toman vs Rial) are unconfirmed — check /api/diag's `brsGoldCurrency` entry once deployed.
 * As a safety net, the result is discarded unless it's within 50%–160% of the known dollar
 * rate (usdRial): USDT tracks the dollar closely, so anything further off is a misread field,
 * not a real price — better to show "—" than a wrong number.
 */
export function parseBrsTetherRial(json: any, usdRial: number | null): { price: number; changePct: number | null } | null {
  const isTether = (o: any) => {
    const sym = String(pick(o, ['symbol', 'symbol_en', 'en_symbol', 'code']) ?? '').toLowerCase();
    const name = String(pick(o, ['name', 'name_fa', 'title', 'name_en']) ?? '');
    return sym === 'usdt' || sym === 'tether' || /تتر/.test(name) || /tether/i.test(name);
  };
  const item = allArrays(json)
    .flat()
    .find((o) => o && typeof o === 'object' && isTether(o));
  if (!item) return null;

  const raw = num(pick(item, ['price', 'price_toman', 'toman_price', 'price_irr', 'p', 'value', 'last_price', 'close_price']));
  if (!isNum(raw) || raw <= 0) return null;
  const changePct = num(pick(item, ['change_percent', 'percent', 'change', 'dp', 'change_value']));

  if (!isNum(usdRial) || usdRial <= 0) return { price: raw, changePct: isNum(changePct) ? changePct : null }; // can't sanity-check, best effort
  const candidates = [raw, raw * 10, raw / 10]; // unit could be Toman, Rial, or (unlikely) something else
  const best = candidates.find((c) => c >= usdRial * 0.5 && c <= usdRial * 1.6);
  return best ? { price: best, changePct: isNum(changePct) ? changePct : null } : null;
}

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
    arr.find((o) => isNum(num(pick(o, ['value', 'index_value', 'last_value', 'close', 'index'])))) ??
    arr[0];
  if (!main) return null;
  const value = num(pick(main, ['value', 'index_value', 'last_value', 'close', 'xNivInuClMresIbs', 'pl', 'pc', 'index']));
  if (!isNum(value) || value <= 0) return null;
  let changePct = num(pick(main, ['change_percent', 'percent', 'change_pct', 'xVarIdxJRfV', 'plp', 'pcp']));
  if (!isNum(changePct)) {
    // some BrsApi responses give only the absolute point change (e.g. "index_change"), not a percent
    const changeAbs = num(pick(main, ['index_change', 'change', 'change_value']));
    const prev = value - changeAbs;
    if (isNum(changeAbs) && prev !== 0) changePct = (changeAbs / prev) * 100;
  }
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
  sector: string | null;
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
      sector: String(pick(s, ['cs', 'sector', 'sector_name']) ?? '').trim() || null,
    });
  }
  return out;
}
