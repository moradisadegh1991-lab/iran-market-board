// Per-source cache: fresh data within TTL, last-good data on failure, ingest support for geo-blocked sources.
import { cacheKv, kv } from '@/lib/store';
import { errMsg } from '@/lib/http';
import type { SourceStatus } from '@/lib/types';

export interface CachedEntry<T> {
  at: number; // last attempt
  lastOkAt: number | null;
  data: T | null;
  ok: boolean;
  via: 'fetch' | 'ingest';
  error?: string;
}

export const SOURCE_LABELS: Record<string, string> = {
  tgju: 'TGJU (طلا، سکه، دلار)',
  goldapi: 'Gold API (انس جهانی)',
  nobitex: 'نوبیتکس (تتر، BTC)',
  brsIndex: 'BrsApi (شاخص کل)',
  brsSymbols: 'BrsApi (نمادها)',
  brsGoldCurrency: 'BrsApi (طلا و ارز، پشتیبان تتر)',
  cgMarkets: 'CoinGecko (بازار کریپتو)',
  cgMemes: 'CoinGecko (میم‌کوین‌ها)',
  nobitexScreen: 'نوبیتکس (نمادهای قابل معامله)',
  histPaxg: 'تاریخچه انس (PAXG)',
  histBtc: 'تاریخچه بیت‌کوین',
  histEth: 'تاریخچه اتریوم',
  histUsdt: 'تاریخچه تتر/ریال (نوبیتکس)',
  tgjuHistUsd: 'تاریخچه دلار (TGJU)',
  tgjuHistCoin: 'تاریخچه سکه (TGJU)',
  tgjuHistG18: 'تاریخچه طلای ۱۸ (TGJU)',
  tgjuHistOns: 'تاریخچه انس (TGJU)',
  tseIndexHist: 'تاریخچه شاخص کل بورس',
};

const ingestOnly = new Set(
  (process.env.INGEST_ONLY_SOURCES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

export const srcKey = (name: string) => `src:${name}`;

// In-process copy (per warm server instance). Every snapshot build used to read every source back from Redis even when
// it was fresh — ~2 MB a build (CoinGecko markets alone ~1 MB), which used up Upstash's free plan in six days (Mehr 1405).
// Now Redis is read only by an instance that has no copy yet, and written at most every 10 minutes per source (or six
// times its TTL — CoinGecko's markets, still ~0.5 MB trimmed, every 30 minutes).
const syncEvery = (ttlSec: number) => Math.max(10 * 60_000, ttlSec * 6000);
const g = globalThis as unknown as { __srcL1?: Map<string, CachedEntry<unknown>>; __srcSynced?: Map<string, number> };
const l1 = (g.__srcL1 ??= new Map());
const synced = (g.__srcSynced ??= new Map());
async function remember<T>(name: string, ttlSec: number, entry: CachedEntry<T>, prev: CachedEntry<T> | null) {
  l1.set(name, entry);
  const now = Date.now();
  // always write a change of health (ok ↔ failing) so other instances see it; otherwise at most every syncEvery
  if (now - (synced.get(name) ?? 0) < syncEvery(ttlSec) && prev && prev.ok === entry.ok) return;
  synced.set(name, now);
  await cacheKv.set(srcKey(name), entry, 7 * 24 * 3600);
}

export async function cachedSource<T>(
  name: string,
  ttlSec: number,
  fetcher: () => Promise<T>,
  maxStaleSec = 24 * 3600,
): Promise<{ data: T | null; status: SourceStatus }> {
  const now = Date.now();
  const prev = (l1.get(name) as CachedEntry<T> | undefined) ?? (await cacheKv.get<CachedEntry<T>>(srcKey(name)));
  if (prev && !l1.has(name)) l1.set(name, prev);
  const label = SOURCE_LABELS[name] ?? name;

  const statusOf = (e: CachedEntry<T> | null, stale: boolean): SourceStatus => ({
    name,
    label,
    ok: !!e?.ok,
    stale,
    ageSec: e?.lastOkAt ? Math.round((now - e.lastOkAt) / 1000) : null,
    via: e ? e.via : 'none',
    error: e?.error,
  });

  const usable = (e: CachedEntry<T> | null) => !!e?.data && !!e.lastOkAt && now - e.lastOkAt < maxStaleSec * 1000;

  // fresh cache (or ingest-only source): no network
  if (prev && (now - prev.at < ttlSec * 1000 || ingestOnly.has(name))) {
    const stale = !prev.lastOkAt || now - prev.lastOkAt > Math.max(ttlSec * 3, 300) * 1000;
    return { data: usable(prev) ? prev.data : null, status: statusOf(prev, stale) };
  }
  if (ingestOnly.has(name)) return { data: null, status: statusOf(null, true) };

  try {
    const data = await fetcher();
    const entry: CachedEntry<T> = { at: now, lastOkAt: now, data, ok: true, via: 'fetch' };
    await remember(name, ttlSec, entry, prev);
    return { data, status: statusOf(entry, false) };
  } catch (e) {
    const entry: CachedEntry<T> = {
      at: now,
      lastOkAt: prev?.lastOkAt ?? null,
      data: prev?.data ?? null,
      ok: false,
      via: prev?.via ?? 'fetch',
      error: errMsg(e).slice(0, 200),
    };
    await remember(name, ttlSec, entry, prev);
    return { data: usable(entry) ? entry.data : null, status: statusOf(entry, true) };
  }
}

export async function ingestSource(name: string, data: unknown): Promise<void> {
  const now = Date.now();
  const entry: CachedEntry<unknown> = { at: now, lastOkAt: now, data, ok: true, via: 'ingest' };
  l1.set(name, entry);
  synced.set(name, now);
  await kv.set(srcKey(name), entry, 7 * 24 * 3600);
}
