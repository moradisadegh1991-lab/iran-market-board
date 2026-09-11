const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';

export async function fetchJson<T = any>(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...opts.headers },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
        cache: 'no-store',
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`Non-JSON response: ${text.slice(0, 160)}`);
      }
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
