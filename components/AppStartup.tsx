'use client';
import { useEffect, useRef } from 'react';
import { AUTO_TICK_MS, callLocal, loadLocalSession, tradeNote } from '@/lib/live-local';
import { autoReadOn, queueRows, readInbox, smsPlugin } from '@/lib/finance/phone-sms';
import { tehranDate } from '@/lib/num';
import { useFinance } from './finance/FinanceProvider';
import { useNotify } from './NotifyProvider';

/**
 * What happens once each time the app opens (and again when it comes back to the foreground):
 *  - a running «معامله برخط من» session takes its next look at live prices — a device-local session
 *    only advances while the app runs (CLAUDE.md rule 13/15);
 *  - inside the APK, with the user's toggle on, bank SMS received since the last read go to the
 *    import queue. The permission dialog is never shown here — only from the button on «ورود از
 *    بانک». The notification says how many, never amounts or bank names: it shows on the lock screen.
 */
export default function AppStartup() {
  const { data, update } = useFinance();
  const { notify } = useNotify();
  const busy = useRef(false);
  const ready = !!data;

  useEffect(() => {
    if (!ready) return;
    const run = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
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
        const plugin = smsPlugin();
        if (plugin && autoReadOn()) {
          try {
            const r = await readInbox(plugin, tehranDate(), null, false);
            if (r && r.rows.length) {
              let added = 0;
              update((d) => {
                added = queueRows(d, r);
              });
              if (added) notify('پیامک‌های بانکی تازه', `${added.toLocaleString('fa-IR')} تراکنش در «ورود از بانک» منتظر تأیید شماست.`, 'sms');
            }
          } catch {
            // permission revoked or plugin failure: the button on the import page explains it
          }
        }
      } finally {
        busy.current = false;
      }
    };
    void run();
    const onVisible = () => document.visibilityState === 'visible' && void run();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [ready, update, notify]);

  return null;
}
