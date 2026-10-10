'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { AUTO_TICK_MS, callLocal, loadLocalSession, tradeNote } from '@/lib/live-local';
import { askOn, autoReadOn, readInbox, smsPlugin } from '@/lib/finance/phone-sms';
import { applyAsked, type AskApplied } from '@/lib/finance/sms-ask';
import { queueSms } from '@/lib/finance/sources';
import { normalizeReminderState, reminderPlan, reminderStep } from '@/lib/finance/reminders';
import { tehranDate } from '@/lib/num';
import { useFinance } from './finance/FinanceProvider';
import { useNotify } from './NotifyProvider';

/** how often the phone's SMS inbox is checked while the app is on screen */
export const SMS_POLL_MS = 30_000;
const ASKED_KEY = 'imf.perm.asked.v1';
/** installs from before the «نوعش چیست؟» notification: RECEIVE_SMS is asked for once more */
const RECEIVE_ASKED_KEY = 'imf.perm.receive.v1';
/** what was reminded and what the phone holds scheduled (lib/finance/reminders.ts) */
export const REMIND_KEY = 'imf.due.remind.v1';

function once(key: string): boolean {
  try {
    if (localStorage.getItem(key) === '1') return false;
    localStorage.setItem(key, '1');
    return true;
  } catch {
    return false; // no storage: do not nag on every start
  }
}

/**
 * What happens when the app opens, comes back to the foreground, and while it stays open:
 *  - the first time inside the APK, the two permissions this needs are asked for once
 *    (notifications — Android 13+ — and reading SMS);
 *  - a running «معامله برخط من» session takes its next look at live prices — a device-local session
 *    only advances while the app runs (CLAUDE.md rule 13/15);
 *  - inside the APK, with the auto-read toggle on (the default), bank SMS that arrived go to the
 *    import queue — on opening and every 30 s while the app is on screen — and a notification
 *    says how many. Never amounts or bank names: it shows on the lock screen.
 *  - what the user answered in the «نوعش چیست؟» notification — posted by the phone itself the
 *    moment a bank SMS arrives, even with the app closed (android-app/native-plugin, SmsAsk) — is
 *    applied to the book (lib/finance/sms-ask.ts): on opening, every 30 s, and at once when a
 *    button is tapped while the app runs. SMS the phone already asked about get no second notice.
 *  - a notification that opened the app opens its page.
 * Price alerts and moves are checked on every fresh board in NotifyProvider.
 */
export default function AppStartup() {
  const { data, update } = useFinance();
  const { notify, askPermission, prefs, scheduleAt, cancelScheduled, canSchedule } = useNotify();
  const router = useRouter();
  const busy = useRef(false);
  const ready = !!data;

  useEffect(() => {
    if (!ready) return;

    const readSms = async () => {
      const plugin = smsPlugin();
      if (!plugin) return;
      try {
        const r = autoReadOn() ? await readInbox(plugin, tehranDate(), null, false) : null;
        const items = plugin.asked ? ((await plugin.asked().catch(() => null))?.items ?? []) : [];
        if (!r?.rows.length && !items.length) return;
        const now = Date.now();
        let added = 0;
        let newSources = 0;
        let applied = null as AskApplied | null;
        update((d) => {
          // answers first: an inbox row the phone already asked about then finds its twin queued or booked
          if (items.length) applied = applyAsked(d, items, tehranDate(), now);
          if (r?.rows.length) {
            const asked = applied?.announced ?? new Set<string>();
            ({ added, newSources } = queueSms(d, r.rows.filter((x) => !x.smsKey || !asked.has(x.smsKey)), now));
            queueSms(d, r.rows.filter((x) => x.smsKey && asked.has(x.smsKey)), now);
          }
        });
        const a = applied as AskApplied | null;
        if (a?.done.length) await plugin.clearAsked?.({ keys: a.done }).catch(() => undefined);
        if (a && (a.booked || a.queued))
          notify(
            'ثبت از اعلان پیامک',
            [a.booked ? `${a.booked.toLocaleString('fa-IR')} تراکنش با نوعی که گفتید در دفتر ثبت شد` : '', a.queued ? `${a.queued.toLocaleString('fa-IR')} تراکنش با نوع انتخاب‌شده در صف «ورود از بانک» منتظر حساب یا بررسی است` : '']
              .filter(Boolean)
              .join('؛ ') + '.',
            'sms',
            a.queued ? '/import' : '/transactions',
            true, // the phone already showed its own notification
          );
        if (added)
          notify(
            added === 1 ? 'پیامک بانکی تازه' : 'پیامک‌های بانکی تازه',
            `${added.toLocaleString('fa-IR')} تراکنش منتظر تأیید شماست${newSources ? `؛ ${newSources.toLocaleString('fa-IR')} کارت/حساب تازه شناسایی شد` : ''}.`,
            'sms',
          );
      } catch {
        // permission revoked or plugin failure: the button on the import page explains it
      }
    };

    const run = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        // first start inside the APK: ask once for what notifications and SMS reading need
        const plugin = smsPlugin();
        if (plugin) {
          if (once(ASKED_KEY)) {
            once(RECEIVE_ASKED_KEY);
            await askPermission();
            await plugin.requestPermission().catch(() => undefined);
          } else if (askOn() && plugin.asked) {
            // reading SMS was allowed before this version: the same permission group, so Android
            // usually grants «receive» without a dialog — asked once
            const p = await plugin.checkPermission().catch(() => null);
            if (p?.granted && p.receive === false && once(RECEIVE_ASKED_KEY)) await plugin.requestPermission().catch(() => undefined);
          }
          void plugin.setAsk?.({ on: askOn() }).catch(() => undefined);
        }

        const s = loadLocalSession();
        if (s && s.status === 'running' && Date.now() - (s.lastTickAt || 0) >= AUTO_TICK_MS) {
          try {
            const r = await callLocal('tick', undefined, s);
            r.newTrades.forEach((t) => {
              const n = tradeNote(t);
              notify(n.title, n.body, 'trade');
            });
            if (r.finished) notify('معامله برخط پایان یافت', 'گزارش نهایی در «معامله برخط» آماده است.', 'trade');
          } catch {
            // offline: the session simply waits for the next open
          }
        }
        await readSms();
      } finally {
        busy.current = false;
      }
    };

    void run();
    const onVisible = () => document.visibilityState === 'visible' && void run();
    document.addEventListener('visibilitychange', onVisible);
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible' && !busy.current) void readSms();
    }, SMS_POLL_MS);

    // a notification button tapped while the app runs, or a notification that opened the app
    const plugin = smsPlugin();
    const handles: { remove(): void }[] = [];
    let gone = false;
    const listen = (event: 'smsChoice' | 'route', fn: (e: { route?: string }) => void) => {
      const h = plugin?.addListener?.(event, fn);
      void Promise.resolve(h)
        .then((x) => (x && (gone ? x.remove() : handles.push(x))))
        .catch(() => undefined);
    };
    const go = (route?: string | null) => {
      if (route && route.startsWith('/')) router.push(route);
    };
    listen('smsChoice', () => {
      if (!busy.current) void readSms();
    });
    listen('route', (e) => go(e?.route));
    void plugin
      ?.launchRoute?.()
      .then((x) => go(x?.route))
      .catch(() => undefined);

    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(poll);
      handles.forEach((h) => h.remove());
    };
  }, [ready, update, notify, askPermission, router]);

  // reminders of installments, cheques, bills and loans (rule 90): on opening, after every change to the book or to the
  // reminder settings, and when the app comes back — what is due now is shown, what is ahead goes to the phone's alarm
  const remindBusy = useRef(false);
  const remindOn = prefs.on && prefs.due;
  useEffect(() => {
    if (!data) return;
    const pass = async () => {
      if (remindBusy.current) return;
      remindBusy.current = true;
      try {
        let prev = normalizeReminderState(null);
        try {
          prev = normalizeReminderState(JSON.parse(localStorage.getItem(REMIND_KEY) ?? 'null'));
        } catch {
          // a broken record: start over (at worst one reminder is shown twice)
        }
        const today = tehranDate();
        const native = await canSchedule();
        const step = reminderStep(reminderPlan(data, today), prev, Date.now(), today, native, remindOn);
        await cancelScheduled(step.cancel);
        // scheduling failed: forget those, so the next pass tries again rather than thinking the phone holds them
        if (step.schedule.length && !(await scheduleAt(step.schedule.map((x) => ({ ...x, cat: 'due' as const })))))
          for (const x of step.schedule) for (const [k, v] of Object.entries(step.state.sched)) if (v.id === x.id) delete step.state.sched[k];
        step.now.forEach((n) => notify(n.title, n.body, 'due'));
        try {
          localStorage.setItem(REMIND_KEY, JSON.stringify(step.state));
        } catch {
          // no storage: reminders are shown again next time rather than lost
        }
      } finally {
        remindBusy.current = false;
      }
    };
    const t = setTimeout(() => void pass(), 1500);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pass();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [data, remindOn, notify, scheduleAt, cancelScheduled, canSchedule]);

  return null;
}
