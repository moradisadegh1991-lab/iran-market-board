// Price alerts and big-move notices — the pure half (no DOM, no storage), so it is testable.
// Ported from the earlier Android app (android-app/www/app-notify.js); the storage keys are the
// same, so alerts and preferences a user set there carry over by themselves.
//
// Honest limit (CLAUDE.md rule 15): this runs when the app is open and a fresh board arrives.
// Nothing here can wake a closed app for a price move.

export const ALERT_KEYS = {
  prefs: 'imb.notif.prefs.v2',
  alerts: 'imb.notif.alerts.v1',
  seen: 'imb.notif.seen.v1',
  log: 'imb.notif.log.v1',
} as const;

export type NotifyCat = 'trade' | 'alert' | 'move' | 'sms' | 'data';
export const NOTIFY_CATS: { k: NotifyCat; t: string; d: string }[] = [
  { k: 'trade', t: 'معاملات برخط', d: 'هر خرید و فروش معامله‌گر برخط و پایان جلسه' },
  { k: 'alert', t: 'هشدار قیمت', d: 'هشدارهایی که خودتان تعریف می‌کنید' },
  { k: 'move', t: 'جهش قیمت', d: 'وقتی دارایی بیش از حد تعیین‌شده در روز جابه‌جا شود' },
  { k: 'sms', t: 'پیامک بانکی', d: 'تراکنش تازه‌ای که از پیامک خوانده شد' },
  { k: 'data', t: 'وضعیت داده', d: 'قطع شدن داده یا کهنه شدن قیمت‌ها' },
];

export interface NotifyPrefs {
  on: boolean;
  trade: boolean;
  alert: boolean;
  move: boolean;
  sms: boolean;
  data: boolean;
  movePct: number;
}
export const DEFAULT_PREFS: NotifyPrefs = { on: true, trade: true, alert: true, move: true, sms: true, data: false, movePct: 2 };

export interface PriceAlert {
  asset: string;
  dir: 'above' | 'below';
  /** in the board item's own unit (toman, or dollars for BTC/ETH) */
  value: number;
  /** ms when it fired; a fired alert is disarmed */
  fired: number;
}
export interface Note {
  title: string;
  body: string;
  cat: NotifyCat;
}
export interface BoardItem {
  key: string;
  label: string;
  price: number | null;
  changePct?: number | null;
  unit?: string;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const fa = (n: number) => Math.round(n).toLocaleString('fa-IR');
const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪`;

export function normalizePrefs(raw: unknown): NotifyPrefs {
  const p = raw && typeof raw === 'object' ? (raw as Partial<NotifyPrefs>) : {};
  return {
    on: p.on !== false,
    trade: p.trade !== false,
    alert: p.alert !== false,
    move: p.move !== false,
    sms: p.sms !== false,
    data: p.data === true,
    movePct: isNum(p.movePct) && p.movePct > 0 ? p.movePct : DEFAULT_PREFS.movePct,
  };
}

export function normalizeAlerts(raw: unknown): PriceAlert[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((a) => a && typeof a.asset === 'string' && isNum(a.value) && a.value > 0)
    .map((a) => ({ asset: a.asset, dir: a.dir === 'below' ? 'below' : 'above', value: a.value, fired: isNum(a.fired) ? a.fired : 0 }));
}

export interface CheckResult {
  notes: Note[];
  alerts: PriceAlert[];
  /** null when nothing changed */
  seen: Record<string, 1> | null;
}

/**
 * Run after each fresh board. Alerts fire once and disarm, so a price hovering on its threshold
 * cannot produce a stream of identical notifications. Big daily moves are remembered per day and
 * asset; the very first run only records them (installing the app must not fire one notice per
 * asset), and past three in one run they are summarised.
 */
export function checkBoard(items: BoardItem[], prefs: NotifyPrefs, alerts: PriceAlert[], seenRaw: unknown, today: string, now: number): CheckResult {
  const notes: Note[] = [];
  const out = alerts.map((a) => ({ ...a }));
  if (!prefs.on || !items.length) return { notes, alerts: out, seen: null };
  const byKey = new Map(items.map((i) => [i.key, i]));

  if (prefs.alert) {
    for (const a of out) {
      if (a.fired) continue;
      const it = byKey.get(a.asset);
      if (!it || !isNum(it.price)) continue;
      if (a.dir === 'above' ? it.price < a.value : it.price > a.value) continue;
      a.fired = now;
      notes.push({ title: `هشدار: ${it.label}`, body: `قیمت به ${fa(it.price)} رسید (${a.dir === 'above' ? 'بالاتر از ' : 'پایین‌تر از '}${fa(a.value)})`, cat: 'alert' });
    }
  }

  let seen: Record<string, 1> | null = null;
  if (prefs.move) {
    const priming = !seenRaw || typeof seenRaw !== 'object';
    const s: Record<string, 1> = priming ? {} : { ...(seenRaw as Record<string, 1>) };
    const thr = Math.abs(prefs.movePct);
    let touched = false, sent = 0, skipped = 0;
    for (const it of items) {
      if (!isNum(it.changePct) || Math.abs(it.changePct) < thr || !isNum(it.price)) continue;
      const k = `${today}:${it.key}`;
      if (s[k]) continue;
      s[k] = 1;
      touched = true;
      if (priming) continue;
      if (sent >= 3) {
        skipped++;
        continue;
      }
      sent++;
      notes.push({ title: `${it.label} ${it.changePct > 0 ? 'جهش کرد' : 'افت کرد'}`, body: `تغییر امروز ${pct(it.changePct)} · قیمت ${fa(it.price)}`, cat: 'move' });
    }
    if (skipped) notes.push({ title: 'حرکت گسترده بازار', body: `${(skipped + sent).toLocaleString('fa-IR')} دارایی امروز بیش از ${thr.toLocaleString('fa-IR')}٪ جابه‌جا شدند.`, cat: 'move' });
    if (touched || priming) {
      // keep only today's marks, or this grows forever
      seen = Object.fromEntries(Object.keys(s).filter((k) => k.startsWith(`${today}:`)).map((k) => [k, 1 as const]));
    }
  }
  return { notes, alerts: out, seen };
}
