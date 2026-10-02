// «معامله برخط من»: a live paper-trading session that belongs to this device (CLAUDE.md rule 13).
// The session lives in localStorage; `/api/live/local` is stateless — it takes the session,
// applies live prices with the same engine the website uses, and hands it back. Two devices never
// see each other's run and nothing about it is stored on the server. Same keys as the earlier
// Android app, so a running session there continues here.
import type { LiveSession, LiveTrade } from '@/lib/engine/live';
import { api } from './api';

export const LIVE_KEY = 'imb.live.session.v1';
export const LIVE_PREF_KEY = 'imb.trade.prefs.v1';
/** a device-local session only advances while the app is open; this is how often it may */
export const AUTO_TICK_MS = 5 * 60_000;

export interface LivePrefs {
  capital: number;
  profile: 'conservative' | 'balanced' | 'aggressive';
  liveAssets: string[];
  liveDays: number;
  activity: 'calm' | 'normal' | 'active';
}
export const DEFAULT_LIVE_PREFS: LivePrefs = { capital: 100e6, profile: 'balanced', liveAssets: ['usd', 'g18', 'coin', 'btc'], liveDays: 30, activity: 'normal' };

export function loadLocalSession(): LiveSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(LIVE_KEY) ?? 'null');
    return s && typeof s === 'object' && s.config && s.status ? (s as LiveSession) : null;
  } catch {
    return null;
  }
}
export function saveLocalSession(s: LiveSession) {
  try {
    localStorage.setItem(LIVE_KEY, JSON.stringify(s));
  } catch {
    // a full storage loses the update; the next tick replays from the stored copy
  }
}
export function loadLivePrefs(): LivePrefs {
  try {
    const p = JSON.parse(localStorage.getItem(LIVE_PREF_KEY) ?? '{}') ?? {};
    return {
      capital: Number(p.capital) > 0 ? Number(p.capital) : DEFAULT_LIVE_PREFS.capital,
      profile: ['conservative', 'balanced', 'aggressive'].includes(p.profile) ? p.profile : DEFAULT_LIVE_PREFS.profile,
      liveAssets: Array.isArray(p.liveAssets) && p.liveAssets.length ? p.liveAssets.map(String) : DEFAULT_LIVE_PREFS.liveAssets,
      liveDays: [7, 30, 60, 90].includes(Number(p.liveDays)) ? Number(p.liveDays) : DEFAULT_LIVE_PREFS.liveDays,
      activity: ['calm', 'normal', 'active'].includes(p.activity) ? p.activity : DEFAULT_LIVE_PREFS.activity,
    };
  } catch {
    return { ...DEFAULT_LIVE_PREFS };
  }
}
export function saveLivePrefs(p: LivePrefs) {
  try {
    localStorage.setItem(LIVE_PREF_KEY, JSON.stringify(p));
  } catch {
    // preference only
  }
}

export interface LiveReply {
  session: LiveSession;
  newTrades: LiveTrade[];
  finished: boolean;
}

/** `startHoldings`: start from the user's own holdings (paper only — the book is not touched). */
export async function callLocal(action: 'start' | 'tick' | 'stop', prefs?: LivePrefs, session?: LiveSession | null, startHoldings?: { asset: string; qty: number }[]): Promise<LiveReply> {
  const body =
    action === 'start'
      ? {
          action,
          config: {
            capitalToman: prefs!.capital, profile: prefs!.profile, assets: prefs!.liveAssets, days: prefs!.liveDays, activity: prefs!.activity, useNews: true,
            ...(startHoldings?.length ? { startHoldings } : {}),
          },
        }
      : { action, session };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 70_000);
  try {
    const r = await fetch(api('/api/live/local'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    saveLocalSession(j.session);
    return { session: j.session, newTrades: j.newTrades ?? [], finished: !!j.finished };
  } catch (e) {
    throw new Error((e as Error)?.name === 'AbortError' ? 'زمان انتظار تمام شد؛ دوباره تلاش کنید.' : (e as Error)?.message || 'خطای نامشخص');
  } finally {
    clearTimeout(timer);
  }
}

/** Engine asset keys are English ('g18'); nobody wants to read that in a notification. */
export const ASSET_LABEL: Record<string, string> = {
  usd: 'دلار', g18: 'طلای ۱۸', coin: 'سکه امامی', tse: 'صندوق شاخصی', btc: 'بیت‌کوین', eth: 'اتریوم',
  sol: 'سولانا', xrp: 'ریپل', ton: 'تون‌کوین', doge: 'دوج‌کوین', usdt: 'تتر', silver: 'نقره',
};
export const assetLabel = (k: string) => ASSET_LABEL[k] ?? k;

export function tradeNote(t: LiveTrade): { title: string; body: string } {
  const value = `${Math.round(t.valueToman).toLocaleString('fa-IR')} تومان`;
  const res = typeof t.realizedPct === 'number' ? ` · نتیجه ${t.realizedPct > 0 ? '+' : ''}${t.realizedPct.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪` : '';
  return { title: `${t.side === 'buy' ? 'خرید' : 'فروش'} ${assetLabel(t.asset)}`, body: value + res };
}
