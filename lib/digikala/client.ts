// دیجی‌کالا from the phone (rule 103): the search and product calls go straight from the device to api.digikala.com —
// in the APK through native HTTP (Digikala's CDN challenges foreign connections, our Vercel server's among them),
// in a browser with fetch, which Digikala may refuse; then the site's own search link is the way. Only what the user
// asked about (the item's name, or a product id) is sent, only on a tap, and never to our server (rule 7).
import { nativeHttp, sendJson } from '../native-http';
import { parseProductPage, parseSearch, productApiUrl, searchApiUrl, type DkProduct, type DkSort } from './parse';

export interface DkResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

function why(status: number, json: unknown): string {
  if (status === 429) return 'دیجی‌کالا گفت درخواست‌ها زیاد است؛ کمی بعد دوباره امتحان کنید.';
  if (status === 403 || (typeof json === 'string' && /<html|captcha|challenge/i.test(json)))
    return 'دیجی‌کالا به‌جای جواب، صفحه بررسی ربات داد (معمولاً با VPN یا اتصال خارج از ایران). بدون VPN دوباره امتحان کنید، یا از «جست‌وجو در سایت دیجی‌کالا» استفاده کنید.';
  if (status >= 500) return 'دیجی‌کالا خطای داخلی داد؛ کمی بعد دوباره امتحان کنید.';
  return `جواب دیجی‌کالا خوانده نشد (کد ${status}). از «جست‌وجو در سایت دیجی‌کالا» استفاده کنید.`;
}

async function get<T>(url: string, read: (json: unknown) => T | null): Promise<DkResult<T>> {
  try {
    const r = await sendJson(url, 'GET', {});
    const v = r.status >= 200 && r.status < 300 ? read(r.json) : null;
    return v !== null ? { ok: true, value: v } : { ok: false, error: why(r.status, r.json) };
  } catch {
    return {
      ok: false,
      error: nativeHttp()
        ? 'به دیجی‌کالا وصل نشد. اینترنت را بررسی کنید (دیجی‌کالا ممکن است اتصال با VPN را نپذیرد).'
        : 'مرورگر نتوانست مستقیم از دیجی‌کالا قیمت بگیرد (دیجی‌کالا اجازه درخواست از سایت دیگری را نمی‌دهد). در اپ اندروید «مالی من» کار می‌کند؛ این‌جا «جست‌وجو در سایت دیجی‌کالا» را بزنید.',
    };
  }
}

export const dkSearch = (q: string, sort: DkSort = 'relevant') => get(searchApiUrl(q, sort), parseSearch);
export const dkProduct = (id: number) => get<DkProduct>(productApiUrl(id), parseProductPage);
