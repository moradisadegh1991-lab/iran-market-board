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
  /** prices at the last board seen, for the «since you were last here» notice on opening the app */
  lastPrices: 'imf.notif.lastprices.v1',
  /** when the notification list was last opened — newer entries show as a badge on the bell */
  readAt: 'imf.notif.readat.v1',
} as const;

export type NotifyCat = 'trade' | 'alert' | 'move' | 'sms' | 'biz' | 'data';
export const NOTIFY_CATS: { k: NotifyCat; t: string; d: string }[] = [
  { k: 'trade', t: 'معاملات برخط', d: 'هر خرید و فروش معامله‌گر برخط و پایان جلسه' },
  { k: 'alert', t: 'هشدار قیمت', d: 'هشدارهایی که خودتان تعریف می‌کنید' },
  { k: 'move', t: 'جهش قیمت', d: 'وقتی دارایی بیش از حد تعیین‌شده در روز جابه‌جا شود' },
  { k: 'sms', t: 'پیامک بانکی', d: 'تراکنش تازه‌ای که از پیامک خوانده شد' },
  { k: 'biz', t: 'سفارش آنلاین', d: 'سفارش یا نوبتی که مشتری از صفحه آنلاین یا تلگرام کسب‌وکار شما فرستاد' },
  { k: 'data', t: 'وضعیت داده', d: 'قطع شدن داده یا کهنه شدن قیمت‌ها' },
];

export interface NotifyPrefs {
  on: boolean;
  trade: boolean;
  alert: boolean;
  move: boolean;
  sms: boolean;
  biz: boolean;
  data: boolean;
  movePct: number;
}
export const DEFAULT_PREFS: NotifyPrefs = { on: true, trade: true, alert: true, move: true, sms: true, biz: true, data: false, movePct: 2 };

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
    biz: p.biz !== false,
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

export interface SeenPrices {
  at: number;
  prices: Record<string, number>;
}
/** the board items worth a «since you were last here» line, in the order they are listed */
const VISIT_KEYS = ['usd', 'usdt', 'g18', 'coin', 'btc', 'eth', 'tse'];
/** below this gap the app was not really «away»: boards arrive every minute while it is open */
export const AWAY_MS = 30 * 60_000;

/**
 * On opening the app (the first board after being away ≥ 30 min): how the main prices moved
 * since the board the user last saw. Only moves of at least half the daily-move threshold are
 * listed, three at most; nothing when nothing moved that much.
 */
export function sinceLastSeen(items: BoardItem[], last: SeenPrices | null, prefs: NotifyPrefs, now: number): { note: Note | null; seen: SeenPrices } {
  const prices: Record<string, number> = {};
  for (const it of items) if (VISIT_KEYS.includes(it.key) && isNum(it.price) && it.price > 0) prices[it.key] = it.price;
  const seen = { at: now, prices };
  if (!prefs.on || !prefs.move || !last || now - last.at < AWAY_MS) return { note: null, seen };
  const thr = Math.abs(prefs.movePct) / 2;
  const moves = VISIT_KEYS.filter((k) => prices[k] && last.prices[k])
    .map((k) => ({ k, label: items.find((i) => i.key === k)!.label, pct: (prices[k] / last.prices[k] - 1) * 100 }))
    .filter((m) => Math.abs(m.pct) >= thr)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 3);
  if (!moves.length) return { note: null, seen };
  const hours = (now - last.at) / 3_600_000;
  const since = hours >= 48 ? `${Math.round(hours / 24).toLocaleString('fa-IR')} روز پیش` : hours >= 1 ? `${Math.round(hours).toLocaleString('fa-IR')} ساعت پیش` : 'نیم ساعت پیش';
  return {
    note: { title: `قیمت‌ها از آخرین بازدید (${since})`, body: moves.map((m) => `${m.label} ${pct(m.pct)}`).join(' · '), cat: 'move' },
    seen,
  };
}
