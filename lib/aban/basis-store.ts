// The Abantether basis on the device (rule 102): read from the exchange's public ticker — no key needed — straight from
// the phone (lib/aban/client.ts), kept in this device's storage, and sent along with the bots' requests so the server
// prices them as Abantether would. On by default; off, or unreadable (a browser the exchange refuses), the bots run on
// the board's prices and the page says so.
import { abanApi } from './client';
import { basisFrom, type AbanBasis } from './basis';

const KEY = 'imf.aban.basis.v1';
const ON_KEY = 'imf.aban.basis.on.v1';
const FRESH_MS = 5 * 60_000;
const MAX_AGE_MS = 6 * 3_600_000;
const FEE_EVERY_MS = 24 * 3_600_000;
// unreachable (no internet, or a browser the exchange refuses): don't ask again on every bot tick
const RETRY_AFTER_FAIL_MS = 30 * 60_000;
let failedAt = 0;

interface Stored extends AbanBasis {
  feeAt?: number;
}

export function basisOn(): boolean {
  try {
    return localStorage.getItem(ON_KEY) !== '0';
  } catch {
    return true;
  }
}
export function setBasisOn(on: boolean) {
  try {
    localStorage.setItem(ON_KEY, on ? '1' : '0');
  } catch {
    /* a preference only */
  }
}

function load(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

/** the last basis read, if not too old (6 hours) */
export function cachedBasis(now = Date.now()): AbanBasis | null {
  const b = load();
  return b && now - b.at <= MAX_AGE_MS ? b : null;
}

/**
 * The basis to send with a bot's request: null when the user turned it off; otherwise refreshed if older than five
 * minutes (the fee once a day), falling back to the last one read within six hours. After the exchange could not be
 * reached, the next automatic read waits half an hour; `force` (the page's own button) reads now.
 */
export async function currentBasis(now = Date.now(), force = false): Promise<AbanBasis | null> {
  if (!basisOn()) return null;
  const prev = load();
  if (prev && now - prev.at < FRESH_MS) return prev;
  const fallback = prev && now - prev.at <= MAX_AGE_MS ? prev : null;
  if (!force && now - failedAt < RETRY_AFTER_FAIL_MS) return fallback;
  const t = await abanApi.ticker();
  failedAt = t.status === 0 ? now : 0;
  const needFee = !prev?.feeAt || now - prev.feeAt > FEE_EVERY_MS;
  const info = t.ok && needFee ? await abanApi.coinInfo('BTC', 'buy') : null;
  let b = t.ok ? basisFrom(t.json, now, info?.ok ? info.json : undefined) : null;
  if (t.ok && !b) {
    // the ticker without USDTIRT: the coin list has the USDT price too
    const c = await abanApi.coins();
    if (c.ok) b = basisFrom(t.json, now, info?.ok ? info.json : undefined, c.json);
  }
  if (!b) return fallback;
  const stored: Stored = { ...b, feePct: info?.ok ? b.feePct : (prev?.feePct ?? b.feePct), feeAt: info?.ok ? now : prev?.feeAt };
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    /* used once, read again next time */
  }
  return stored;
}
