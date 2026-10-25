// آبان‌تتر — talking to the exchange (rule 101). From the phone straight to api.abantether.com: in the APK through
// Capacitor's native HTTP (no CORS, and the exchange sees the user's own Iranian connection), in a browser with fetch
// (the exchange may refuse it — the page says so). Our server never sees the key or the orders (rule 7), and the key
// is kept in this device's storage only, outside the book and its backups.
//
// Endpoints, headers and bodies follow the API reference (docs.abantether.com): «Authorization: <api key>», no prefix.
// A request is never sent twice: an answer of any kind, or a lost connection, ends the call.

import { nativeHttp, sendJson } from '../native-http';

export const ABAN_API = 'https://api.abantether.com';
const KEY_STORE = 'imf.aban.key.v1';

export interface AbanResult {
  ok: boolean;
  status: number;
  url: string;
  json: unknown;
  /** the error to show, in Persian */
  error?: string;
}

/** true inside the APK: requests do not depend on the exchange allowing a browser */
export const nativeTransport = () => !!nativeHttp();

export function loadKey(): string {
  try {
    return localStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
}
export function saveKey(k: string) {
  try {
    if (k.trim()) localStorage.setItem(KEY_STORE, k.trim());
    else localStorage.removeItem(KEY_STORE);
  } catch {
    // without storage the key lives only while the page is open
  }
}

const send = (url: string, method: 'GET' | 'POST', headers: Record<string, string>, body?: unknown) => sendJson(url, method, headers, body);

function errorText(status: number, json: unknown): string {
  const msg = (() => {
    if (typeof json === 'string') return json.slice(0, 200);
    if (json && typeof json === 'object') {
      const o = json as Record<string, unknown>;
      const m = o.message ?? o.detail ?? o.error ?? o.msg ?? (o.errors ? JSON.stringify(o.errors) : null);
      return typeof m === 'string' ? m.slice(0, 200) : m ? JSON.stringify(m).slice(0, 200) : '';
    }
    return '';
  })();
  const what =
    status === 401 || status === 403
      ? 'کلید API پذیرفته نشد (یا این کار برای کلید شما مجاز نیست).'
      : status === 404
        ? 'این مسیر در API صرافی پیدا نشد.'
        : status === 429
          ? 'تعداد درخواست‌ها زیاد بود؛ کمی بعد دوباره امتحان کنید.'
          : status >= 500
            ? 'صرافی خطای داخلی داد.'
            : `صرافی درخواست را نپذیرفت (کد ${status}).`;
  return msg ? `${what} پیام صرافی: ${msg}` : what;
}

/**
 * One request, sent once. `auth` 'required' refuses to send without a key; 'optional' sends it when there is one
 * (the docs show the header on public lists too). Network failures (no connection, a browser refused, a foreign
 * address) come back as status 0.
 */
export async function call(path: string, method: 'GET' | 'POST', opts: { auth: 'required' | 'optional' | 'none'; body?: unknown; key?: string } = { auth: 'required' }): Promise<AbanResult> {
  const key = opts.key ?? loadKey();
  const url = path.startsWith('http') ? path : `${ABAN_API}${path}`;
  if (opts.auth === 'required' && !key) return { ok: false, status: 0, url, json: null, error: 'اول کلید API آبان‌تتر را وارد کنید.' };
  const headers: Record<string, string> = opts.auth !== 'none' && key ? { Authorization: key } : {};
  try {
    const r = await send(url, method, headers, opts.body);
    const ok = r.status >= 200 && r.status < 300;
    return ok ? { ok, status: r.status, url, json: r.json } : { ok, status: r.status, url, json: r.json, error: errorText(r.status, r.json) };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 0,
      url,
      json: null,
      error: nativeHttp()
        ? `به صرافی وصل نشد (${why}). اینترنت را بررسی کنید؛ آبان‌تتر ممکن است اتصال از بیرون ایران (VPN) را نپذیرد.`
        : `مرورگر نتوانست به صرافی وصل شود (${why}). معمولاً صرافی اجازه درخواست از سایت دیگری را نمی‌دهد — از اپ اندروید «مالی من» استفاده کنید.`,
    };
  }
}

const q = encodeURIComponent;
export type WalletType = 'spot' | 'credit' | 'collateral';
export type AccountType = 'spot' | 'credit' | 'collateral' | 'investment';

export const abanApi = {
  /** public: buy/sell price of every coin against IRT ({data:{markets:{BTCIRT:{…}}}}) */
  ticker: (coin?: string) => call(`/api/v1/manager/otc/ticker${coin ? `?coin=${q(coin)}` : ''}`, 'GET', { auth: 'none' }),
  /** every coin with its USDT price, buy/sell and type (COIN, or FUND — the investment boxes) */
  coins: () => call('/api/v2/manager/coins', 'GET', { auth: 'optional' }),
  /** min/max trade and fees of one coin for one side */
  coinInfo: (symbol: string, side: 'buy' | 'sell') => call(`/api/v1/feecalculator/coin-info?side=${side}&symbol=${q(symbol)}`, 'GET', { auth: 'optional' }),
  balances: (type: WalletType = 'spot', key?: string) => call(`/api/v1/accounting/balances?type=${type}`, 'GET', { auth: 'required', key }),
  orders: (page = 1, perPage = 20) => call(`/api/v1/order_handler/orders/otc?page=${page}&per_page=${perPage}`, 'GET', { auth: 'required' }),
  order: (id: string) => call(`/api/v1/order_handler/orders/otc/${q(id)}/`, 'GET', { auth: 'required' }),
  place: (kind: 'market' | 'limit', body: Record<string, string>) => call(`/api/v1/order_handler/orders/otc/${kind}`, 'POST', { auth: 'required', body }),
  cancel: (id: string) => call(`/api/v1/order_handler/orders/otc/${q(id)}/cancel`, 'POST', { auth: 'required' }),
  /** read-only: deposits or withdrawals on the blockchain */
  transfers: (type: 'DEPOSIT' | 'WITHDRAWAL', page = 1) => call(`/transaction_bc/list?type=${type}&category=BLOCKCHAIN&per_page=20&page=${page}`, 'GET', { auth: 'required' }),
};
