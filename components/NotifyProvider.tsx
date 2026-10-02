'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ALERT_KEYS, checkBoard, normalizeAlerts, normalizePrefs, NOTIFY_CATS, sinceLastSeen, type NotifyCat, type NotifyPrefs, type PriceAlert, type SeenPrices } from '@/lib/alerts';
import { tehranDate } from '@/lib/num';
import { useSnapshot } from './SnapshotProvider';

/**
 * Every notification in the app goes through `notify()` (CLAUDE.md rule 14):
 *  1. Capacitor LocalNotifications inside the APK — channels are created once, before anything is
 *     posted, because Android 8+ silently drops a notification sent to a missing channel;
 *  2. the browser's Notification API on the website, when allowed;
 *  3. always an in-app toast, so an event is never swallowed when permission was refused.
 */

export interface LogEntry {
  at: number;
  title: string;
  body: string;
  cat: NotifyCat;
}
interface Ctx {
  notify: (title: string, body: string, cat: NotifyCat, route?: string) => void;
  /** notifications since the list was last opened — the badge on the bell */
  unread: number;
  markRead: () => void;
  prefs: NotifyPrefs;
  setPrefs: (p: NotifyPrefs) => void;
  alerts: PriceAlert[];
  setAlerts: (a: PriceAlert[]) => void;
  log: LogEntry[];
  askPermission: () => Promise<string>;
  native: boolean;
}
const NotifyCtx = createContext<Ctx | null>(null);
export function useNotify(): Ctx {
  const c = useContext(NotifyCtx);
  if (!c) throw new Error('useNotify outside NotifyProvider');
  return c;
}

function jget<T>(k: string, d: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? 'null');
    return v === null || v === undefined ? d : (v as T);
  } catch {
    return d;
  }
}
function jset(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // storage full: the notice is still shown, it just is not kept
  }
}

interface LocalNotifications {
  createChannel(o: { id: string; name: string; description: string; importance: number; visibility: number }): Promise<void>;
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  schedule(o: { notifications: { id: number; title: string; body: string; channelId: string; extra?: Record<string, string> }[] }): Promise<unknown>;
  addListener?(event: 'localNotificationActionPerformed', fn: (e: { notification?: { extra?: { route?: string } } }) => void): Promise<{ remove: () => void }> | { remove: () => void };
}
/** where a tap on each kind of notification lands */
const ROUTE: Record<NotifyCat, string> = { trade: '/live', alert: '/alerts', move: '/market', sms: '/import', data: '/bot' };
function plugin(): LocalNotifications | null {
  const c = (window as { Capacitor?: { Plugins?: { LocalNotifications?: LocalNotifications } } }).Capacitor;
  return c?.Plugins?.LocalNotifications ?? null;
}

let channelsReady: Promise<void> | null = null;
function ensureChannels(p: LocalNotifications) {
  channelsReady ??= Promise.all(
    NOTIFY_CATS.map((c) =>
      // importance 4 = heads-up: the notice slides over whatever is on the screen
      p.createChannel({ id: `imb-${c.k}`, name: c.t, description: c.d, importance: c.k === 'data' ? 3 : 4, visibility: 1 }).catch(() => undefined),
    ),
  ).then(() => undefined);
  return channelsReady;
}

interface Toast {
  id: number;
  title: string;
  body: string;
}

export default function NotifyProvider({ children }: { children: React.ReactNode }) {
  const { snap } = useSnapshot();
  const [prefs, setPrefsState] = useState<NotifyPrefs>(() => normalizePrefs(null));
  const [alerts, setAlertsState] = useState<PriceAlert[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [native, setNative] = useState(false);
  const [readAt, setReadAt] = useState(0);
  const router = useRouter();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    setPrefsState(normalizePrefs(jget(ALERT_KEYS.prefs, null)));
    setAlertsState(normalizeAlerts(jget(ALERT_KEYS.alerts, [])));
    setLog(jget<LogEntry[]>(ALERT_KEYS.log, []).filter((e) => e && typeof e.title === 'string'));
    setNative(!!plugin());
    setReadAt(jget<number>(ALERT_KEYS.readAt, 0));
  }, []);

  // a tap on a notification in the phone's shade opens the page it is about
  useEffect(() => {
    const plug = plugin();
    if (!plug?.addListener) return;
    let handle: { remove: () => void } | null = null;
    let gone = false;
    Promise.resolve(plug.addListener('localNotificationActionPerformed', (e) => {
      const route = e?.notification?.extra?.route;
      if (route && route.startsWith('/')) router.push(route);
    }))
      .then((h) => {
        handle = h;
        if (gone) h.remove();
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      handle?.remove();
    };
  }, [router]);

  const markRead = useCallback(() => {
    const now = Date.now();
    setReadAt(now);
    jset(ALERT_KEYS.readAt, now);
  }, []);

  const setPrefs = useCallback((p: NotifyPrefs) => {
    setPrefsState(p);
    jset(ALERT_KEYS.prefs, p);
  }, []);
  const setAlerts = useCallback((a: PriceAlert[]) => {
    const list = a.slice(0, 40);
    setAlertsState(list);
    jset(ALERT_KEYS.alerts, list);
  }, []);

  const notify = useCallback((title: string, body: string, cat: NotifyCat, route?: string) => {
    const p = prefsRef.current;
    if (!p.on || p[cat] === false) return;
    const entry = { at: Date.now(), title, body, cat };
    setLog((l) => {
      const next = [entry, ...l].slice(0, 60);
      jset(ALERT_KEYS.log, next);
      return next;
    });
    const id = Math.floor(Math.random() * 2_000_000_000);
    setToasts((t) => [...t.slice(-2), { id, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4800);

    const plug = plugin();
    if (plug) {
      ensureChannels(plug)
        .then(() => plug.checkPermissions())
        .then((perm) => (perm?.display === 'granted' ? perm : plug.requestPermissions()))
        .then((perm) => {
          if (perm?.display === 'granted') return plug.schedule({ notifications: [{ id, title, body, channelId: `imb-${cat}`, extra: { route: route ?? ROUTE[cat] } }] });
        })
        .catch(() => undefined); // a failed notification must never break what triggered it
      return;
    }
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body });
    } catch {
      // ignore
    }
  }, []);

  const askPermission = useCallback(async () => {
    const plug = plugin();
    try {
      if (plug) {
        await ensureChannels(plug);
        const r = await plug.requestPermissions();
        return r?.display ?? 'unknown';
      }
      if (typeof Notification === 'undefined') return 'unsupported';
      return await Notification.requestPermission();
    } catch {
      return 'error';
    }
  }, []);

  // every fresh board: price alerts and big moves
  const lastBoard = useRef<string | null>(null);
  useEffect(() => {
    if (!snap || snap.generatedAt === lastBoard.current) return;
    lastBoard.current = snap.generatedAt;
    const p = normalizePrefs(jget(ALERT_KEYS.prefs, null));
    const current = normalizeAlerts(jget(ALERT_KEYS.alerts, []));
    const r = checkBoard(snap.live.items, p, current, jget(ALERT_KEYS.seen, null), tehranDate(), Date.now());
    if (r.notes.length) setAlerts(r.alerts);
    if (r.seen) jset(ALERT_KEYS.seen, r.seen);
    r.notes.forEach((n) => notify(n.title, n.body, n.cat));
    // back after being away: how the main prices moved since the last board seen
    const v = sinceLastSeen(snap.live.items, jget<SeenPrices | null>(ALERT_KEYS.lastPrices, null), p, Date.now());
    if (v.note) notify(v.note.title, v.note.body, v.note.cat);
    if (Object.keys(v.seen.prices).length) jset(ALERT_KEYS.lastPrices, v.seen);
  }, [snap, notify, setAlerts]);

  return (
    <NotifyCtx.Provider value={{ notify, unread: log.filter((e) => e.at > readAt).length, markRead, prefs, setPrefs, alerts, setAlerts, log, askPermission, native }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" role="status">
            <b>{t.title}</b>
            {t.body ? <span>{t.body}</span> : null}
          </div>
        ))}
      </div>
    </NotifyCtx.Provider>
  );
}
