// «نوسان‌گیری برخط من»: a live swing session that belongs to this device (rule 97, the rule-13 pattern). The
// session lives in localStorage; /api/swing-live/local advances it with the same engine as the shared server
// session and hands it back. Because every tick replays the backtester from the session's anchor, a tick
// after the app was closed for days catches up exactly.
import type { SwingLiveFill, SwingLiveSession } from '@/lib/engine/swing-live';
import { api } from './api';

export const SWING_KEY = 'imf.swing.session.v1';
export const SWING_PREF_KEY = 'imf.swing.prefs.v1';
export const SWING_TICK_MS = 5 * 60_000;

export interface SwingPrefs { capital: number; preset: 'trend' | 'calm' | 'normal' | 'aggressive'; hours: number }
export const DEFAULT_SWING_PREFS: SwingPrefs = { capital: 100e6, preset: 'trend', hours: 720 };

export function loadSwingSession(): SwingLiveSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(SWING_KEY) ?? 'null');
    return s && typeof s === 'object' && s.config && s.status ? (s as SwingLiveSession) : null;
  } catch {
    return null;
  }
}
export function saveSwingSession(s: SwingLiveSession | null) {
  try {
    if (s) localStorage.setItem(SWING_KEY, JSON.stringify(s));
    else localStorage.removeItem(SWING_KEY);
  } catch {
    // a full storage loses this update; the next tick replays from the stored copy
  }
}
export function loadSwingPrefs(): SwingPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(SWING_PREF_KEY) ?? '{}') ?? {};
    return {
      capital: Number(p.capital) >= 1e6 ? Number(p.capital) : DEFAULT_SWING_PREFS.capital,
      preset: ['trend', 'calm', 'normal', 'aggressive'].includes(p.preset) ? p.preset : DEFAULT_SWING_PREFS.preset,
      hours: [24, 72, 168, 336, 720].includes(Number(p.hours)) ? Number(p.hours) : DEFAULT_SWING_PREFS.hours,
    };
  } catch {
    return { ...DEFAULT_SWING_PREFS };
  }
}
export function saveSwingPrefs(p: SwingPrefs) {
  try {
    localStorage.setItem(SWING_PREF_KEY, JSON.stringify(p));
  } catch {
    /* preference only */
  }
}

export async function callSwingLocal(
  action: 'start' | 'tick' | 'stop',
  arg: { config?: { coins: { id: string; symbol: string; name: string }[]; capitalToman: number; preset: string; hours: number; feePct?: number }; session?: SwingLiveSession | null },
): Promise<{ session: SwingLiveSession; newFills: SwingLiveFill[] }> {
  const body = action === 'start' ? { action, config: { ...arg.config, feePct: arg.config?.feePct ?? 0.4, engine: 'v2' } } : { action, session: arg.session };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 70_000);
  try {
    const r = await fetch(api('/api/swing-live/local'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    saveSwingSession(j.session);
    return { session: j.session, newFills: j.newFills ?? [] };
  } catch (e) {
    throw new Error((e as Error)?.name === 'AbortError' ? 'زمان انتظار تمام شد؛ دوباره تلاش کنید.' : (e as Error)?.message || 'خطای نامشخص');
  } finally {
    clearTimeout(timer);
  }
}

export function swingFillNote(f: SwingLiveFill): { title: string; body: string } {
  const pct = `${f.netPct > 0 ? '+' : ''}${f.netPct.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪`;
  return { title: `نوسان‌گیری: ${f.symbol} بسته شد`, body: `نتیجه ${pct} (${Math.round(f.pnlToman).toLocaleString('fa-IR')} تومان)` };
}
