// «فیوچرز من»: the paper futures account of this device (rule 95). Kept in localStorage; every action goes
// through the stateless /api/futures/local, which first walks the account up to now (liquidation, stop,
// target, funding) and then applies the order. No order ever reaches an exchange.
import type { FuturesAccount, FuturesAuto, OpenOrder } from '@/lib/engine/futures-account';
import type { FuturesFill } from '@/lib/engine/futures';
import { api } from './api';

export const FUT_KEY = 'imf.futures.v1';
export const FUT_TICK_MS = 5 * 60_000;

export function loadFutures(): FuturesAccount | null {
  try {
    const a = JSON.parse(localStorage.getItem(FUT_KEY) ?? 'null');
    return a && a.v === 1 ? (a as FuturesAccount) : null;
  } catch {
    return null;
  }
}
export function saveFutures(a: FuturesAccount | null) {
  try {
    if (a) localStorage.setItem(FUT_KEY, JSON.stringify(a));
    else localStorage.removeItem(FUT_KEY);
  } catch {
    /* the next tick replays from the stored copy */
  }
}

export type FutAction =
  | { action: 'create'; capital: number }
  | { action: 'tick' }
  | { action: 'open'; order: OpenOrder }
  | { action: 'close'; posId: string }
  | { action: 'auto'; auto: FuturesAuto | null }
  | { action: 'autoNow' };

export async function callFutures(a: FuturesAccount | null, req: FutAction): Promise<{ account: FuturesAccount; newFills: FuturesFill[] }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 70_000);
  try {
    const r = await fetch(api('/api/futures/local'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...req, account: a }), signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    saveFutures(j.account);
    return { account: j.account, newFills: j.newFills ?? [] };
  } catch (e) {
    throw new Error((e as Error)?.name === 'AbortError' ? 'زمان انتظار تمام شد؛ دوباره تلاش کنید.' : (e as Error)?.message || 'خطای نامشخص');
  } finally {
    clearTimeout(timer);
  }
}

export function futFillNote(f: FuturesFill): { title: string; body: string } {
  const side = f.side === 'long' ? 'لانگ' : 'شورت';
  if (f.reason === 'liquidation') return { title: `فیوچرز: ${f.sym} ${side} لیکویید شد`, body: `وجه تضمین ${f.margin.toLocaleString('fa-IR', { maximumFractionDigits: 2 })} تتر از دست رفت (کاغذی).` };
  const why = f.reason === 'tp' ? 'حد سود' : f.reason === 'sl' ? 'حد ضرر' : f.reason === 'signal' ? 'سیگنال روندسوار' : 'بسته شد';
  return { title: `فیوچرز: ${f.sym} ${side} — ${why}`, body: `سود/زیان ${f.pnl >= 0 ? '+' : ''}${f.pnl.toLocaleString('fa-IR', { maximumFractionDigits: 2 })} تتر (کاغذی)` };
}
