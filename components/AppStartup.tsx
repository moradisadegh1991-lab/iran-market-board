'use client';
import { useEffect, useRef } from 'react';
import { AUTO_TICK_MS, callLocal, loadLocalSession, tradeNote } from '@/lib/live-local';
import { autoReadOn, readInbox, smsPlugin } from '@/lib/finance/phone-sms';
import { queueSms } from '@/lib/finance/sources';
import { tehranDate } from '@/lib/num';
import { useFinance } from './finance/FinanceProvider';
import { useNotify } from './NotifyProvider';

/** how often the phone's SMS inbox is checked while the app is on screen */
export const SMS_POLL_MS = 30_000;
const ASKED_KEY = 'imf.perm.asked.v1';

/**
 * What happens when the app opens, comes back to the foreground, and while it stays open:
 *  - the first time inside the APK, the two permissions this needs are asked for once
 *    (notifications — Android 13+ — and reading SMS);
 *  - a running «معامله برخط من» session takes its next look at live prices — a device-local session
 *    only advances while the app runs (CLAUDE.md rule 13/15);
 *  - inside the APK, with the auto-read toggle on (the default), bank SMS that arrived go to the
 *    import queue — on opening and every 30 s while the app is on screen — and a notification
 *    says how many. Never amounts or bank names: it shows on the lock screen. A closed app
 *    cannot be woken by an SMS (rule 15); those are picked up the next time it opens.
 * Price alerts and moves are checked on every fresh board in NotifyProvider.
 */
export default function AppStartup() {
  const { data, update } = useFinance();
  const { notify, askPermission } = useNotify();
  const busy = useRef(false);
  const ready = !!data;

  useEffect(() => {
    if (!ready) return;

    const readSms = async () => {
      const plugin = smsPlugin();
      if (!plugin || !autoReadOn()) return;
      try {
        const r = await readInbox(plugin, tehranDate(), null, false);
        if (!r || !r.rows.length) return;
        let added = 0;
        let newSources = 0;
        update((d) => {
          ({ added, newSources } = queueSms(d, r.rows, Date.now()));
        });
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
          let asked = false;
          try {
            asked = localStorage.getItem(ASKED_KEY) === '1';
            if (!asked) localStorage.setItem(ASKED_KEY, '1');
          } catch {
            asked = true; // no storage: do not nag on every start
          }
          if (!asked) {
            await askPermission();
            await plugin.requestPermission().catch(() => undefined);
          }
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
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(poll);
    };
  }, [ready, update, notify, askPermission]);

  return null;
}
