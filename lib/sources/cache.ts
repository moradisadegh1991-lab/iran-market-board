// Per-source cache: fresh data within TTL, last-good data on failure, ingest support for geo-blocked sources.
import { kv } from '@/lib/store';
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

export async function cachedSource<T>(
  name: string,
  ttlSec: number,
  fetcher: () => Promise<T>,
  maxStaleSec = 24 * 3600,
): Promise<{ data: T | null; status: SourceStatus }> {
  const now = Date.now();
  const prev = await kv.get<CachedEntry<T>>(srcKey(name));
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
    await kv.set(srcKey(name), entry, 7 * 24 * 3600);
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
    await kv.set(srcKey(name), entry, 7 * 24 * 3600);
    return { data: usable(entry) ? entry.data : null, status: statusOf(entry, true) };
  }
}

export async function ingestSource(name: string, data: unknown): Promise<void> {
  const now = Date.now();
  const entry: CachedEntry<unknown> = { at: now, lastOkAt: now, data, ok: true, via: 'ingest' };
  await kv.set(srcKey(name), entry, 7 * 24 * 3600);
}
