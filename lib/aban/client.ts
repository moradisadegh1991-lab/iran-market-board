// آبان‌تتر — talking to the exchange (rule 101). From the phone straight to api.abantether.com: in the APK through
// Capacitor's native HTTP (no CORS, and the exchange sees the user's own Iranian connection), in a browser with fetch
// (the exchange may refuse it — the page says so). Our server never sees the key or the orders (rule 7), and the key
// is kept in this device's storage only, outside the book and its backups.
//
// Paths: the docs' (/api/v1/…) first; a 404 — no such path, so nothing was done — tries the SDK's older path.
// Auth: «Authorization: Token <key>» (docs); a 401/403 — refused, nothing was done — tries the bare key (SDK).
// Neither retry can place an order twice: both mean the first request was rejected before it did anything.

export const ABAN_API = 'https://api.abantether.com';
const KEY_STORE = 'imf.aban.key.v1';
const AUTH_STORE = 'imf.aban.auth.v1';

export interface AbanResult {
  ok: boolean;
  status: number;
  url: string;
  json: unknown;
  /** the error to show, in Persian */
  error?: string;
}

interface NativeHttp {
  request(o: { url: string; method: string; headers?: Record<string, string>; data?: unknown; responseType?: string; connectTimeout?: number; readTimeout?: number }): Promise<{
    status: number;
    data: unknown;
  }>;
}

function nativeHttp(): NativeHttp | null {
  if (typeof window === 'undefined') return null;
  const c = (window as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { CapacitorHttp?: NativeHttp } } }).Capacitor;
  return c?.isNativePlatform?.() && c.Plugins?.CapacitorHttp ? c.Plugins.CapacitorHttp : null;
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
    localStorage.removeItem(AUTH_STORE);
  } catch {
    // without storage the key lives only while the page is open
  }
}
const authStyle = (): 'token' | 'bare' => {
  try {
    return localStorage.getItem(AUTH_STORE) === 'bare' ? 'bare' : 'token';
  } catch {
    return 'token';
  }
};
const setAuthStyle = (s: 'token' | 'bare') => {
  try {
    localStorage.setItem(AUTH_STORE, s);
  } catch {
    /* re-learned next time */
  }
};

async function send(url: string, method: 'GET' | 'POST', headers: Record<string, string>, body?: unknown): Promise<{ status: number; json: unknown }> {
  const h = nativeHttp();
  if (h) {
    const r = await h.request({ url, method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, data: body, responseType: 'json', connectTimeout: 15_000, readTimeout: 20_000 });
    let json = r.data;
    if (typeof json === 'string') {
      try {
        json = JSON.parse(json);
      } catch {
        /* keep the text */
      }
    }
    return { status: r.status, json };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const r = await fetch(url, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    const text = await r.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: r.status, json };
  } finally {
    clearTimeout(timer);
  }
}

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
            : status === 0
              ? 'به صرافی وصل نشد.'
              : `صرافی درخواست را نپذیرفت (کد ${status}).`;
  return msg ? `${what} پیام صرافی: ${msg}` : what;
}

/**
 * One call. `paths` are tried in order, moving on only after a 404; `auth` adds the key (and its 401/403 fallback).
 * Network failures (no connection, the exchange refusing a browser, a foreign address) come back as status 0.
 */
export async function call(paths: string[], method: 'GET' | 'POST', opts: { auth: boolean; body?: unknown; key?: string } = { auth: true }): Promise<AbanResult> {
  const key = opts.key ?? loadKey();
  if (opts.auth && !key) return { ok: false, status: 0, url: '', json: null, error: 'اول کلید API آبان‌تتر را وارد کنید.' };
  let last: AbanResult = { ok: false, status: 0, url: '', json: null, error: 'به صرافی وصل نشد.' };
  for (const p of paths) {
    const url = p.startsWith('http') ? p : `${ABAN_API}${p}`;
    const styles: ('token' | 'bare' | 'none')[] = !opts.auth ? ['none'] : authStyle() === 'bare' ? ['bare', 'token'] : ['token', 'bare'];
    let notFound = false;
    for (const st of styles) {
      const headers: Record<string, string> = st === 'token' ? { Authorization: `Token ${key}` } : st === 'bare' ? { Authorization: key } : {};
      let r: { status: number; json: unknown };
      try {
        r = await send(url, method, headers, opts.body);
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
      last = { ok: r.status >= 200 && r.status < 300, status: r.status, url, json: r.json };
      if (last.ok) {
        if (st !== 'none') setAuthStyle(st);
        return last;
      }
      if (r.status === 404) {
        notFound = true;
        break; // this path does not exist: the next one, the same auth
      }
      if (r.status !== 401 && r.status !== 403) break; // a real answer: no other auth form will change it
    }
    if (!notFound) break;
  }
  return { ...last, error: errorText(last.status, last.json) };
}

export const abanApi = {
  ticker: () => call(['/api/v1/manager/otc/ticker'], 'GET', { auth: false }),
  coinInfo: (symbol: string, side: 'buy' | 'sell') => call([`/api/v1/feecalculator/coin-info?symbol=${encodeURIComponent(symbol)}&side=${side}`], 'GET', { auth: false }),
  balances: (key?: string) => call(['/api/v1/accounting/balances?type=spot', 'https://mono.abantether.com/portfolio/portfolio-balance/'], 'GET', { auth: true, key }),
  orders: () => call(['/api/v1/order_handler/orders/otc?per_page=20&page=1', '/order_handler/orders/otc?per_page=20&page=1'], 'GET', { auth: true }),
  place: (kind: 'market' | 'limit', body: Record<string, string>) =>
    call([`/api/v1/order_handler/orders/otc/${kind}`, `/order_handler/orders/otc/${kind}`], 'POST', { auth: true, body }),
  cancel: (id: string) => call([`/api/v1/order_handler/orders/otc/${encodeURIComponent(id)}/cancel`, '/otc/orders/cancel'], 'POST', { auth: true, body: { id } }),
};
