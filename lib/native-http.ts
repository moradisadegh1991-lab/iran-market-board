// A request from the phone straight to a site in Iran (Abantether rule 101, Digikala rule 103): in the APK through
// Capacitor's native HTTP — no CORS, and the site sees the user's own Iranian connection, which foreign servers
// (ours on Vercel included) often don't get — in a browser with fetch, which the site may refuse. Sent once.

export interface NativeHttp {
  request(o: { url: string; method: string; headers?: Record<string, string>; data?: unknown; responseType?: string; connectTimeout?: number; readTimeout?: number }): Promise<{
    status: number;
    data: unknown;
  }>;
}

export function nativeHttp(): NativeHttp | null {
  if (typeof window === 'undefined') return null;
  const c = (window as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { CapacitorHttp?: NativeHttp } } }).Capacitor;
  return c?.isNativePlatform?.() && c.Plugins?.CapacitorHttp ? c.Plugins.CapacitorHttp : null;
}

/** One request; the body parsed as JSON when it is JSON. Throws on a lost connection (or a browser that refused). */
export async function sendJson(url: string, method: 'GET' | 'POST', headers: Record<string, string>, body?: unknown): Promise<{ status: number; json: unknown }> {
  const h = nativeHttp();
  const all = { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers };
  if (h) {
    const r = await h.request({ url, method, headers: all, data: body, responseType: 'json', connectTimeout: 15_000, readTimeout: 20_000 });
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
    const r = await fetch(url, { method, headers: all, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
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
