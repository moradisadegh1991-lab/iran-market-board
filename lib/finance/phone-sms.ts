// Reading bank SMS from the phone's inbox — only inside the APK, through the native plugin in
// android-app/native-plugin (CLAUDE.md §7: compiled in CI, never yet run on a real phone).
// Messages never leave the device; they are parsed here and queued for the user's review.
import { useEffect, useState } from 'react';
import { enqueue, rowsFromMessages, type SmsResult } from './importers';
import type { FinanceData, Iso } from './model';
import { smsParser } from './sms';

export interface SmsPlugin {
  checkPermission(): Promise<{ granted?: boolean }>;
  requestPermission(): Promise<{ granted?: boolean }>;
  read(o: { sinceMs: number; limit: number }): Promise<{ messages?: { body?: string; date?: number }[] }>;
}

export function smsPlugin(): SmsPlugin | null {
  if (typeof window === 'undefined') return null;
  const c = (window as { Capacitor?: { Plugins?: { SmsReader?: SmsPlugin } } }).Capacitor;
  return c?.Plugins?.SmsReader ?? null;
}

/** The bridge object does not exist during the static render, so it is looked up after mount. */
export function useSmsPlugin(): SmsPlugin | null {
  const [p, setP] = useState<SmsPlugin | null>(null);
  useEffect(() => setP(smsPlugin()), []);
  return p;
}

export const PHONE_READ_KEY = 'imf.smsread.v1';
export const SMS_AUTO_KEY = 'imf.smsauto.v1';
export const FIRST_READ_DAYS = 60;

export function lastPhoneRead(): number | null {
  try {
    const v = Number(localStorage.getItem(PHONE_READ_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function autoReadOn(): boolean {
  try {
    return localStorage.getItem(SMS_AUTO_KEY) === '1';
  } catch {
    return false;
  }
}
export function setAutoRead(on: boolean) {
  try {
    localStorage.setItem(SMS_AUTO_KEY, on ? '1' : '0');
  } catch {
    // the toggle just will not persist
  }
}

/**
 * Reads everything received since the last read (or the last 60 days the first time) and returns
 * the parsed rows; the caller queues them with `enqueue` inside its own book update.
 * `ask` = false never shows the permission dialog (used on app start).
 */
export async function readInbox(plugin: SmsPlugin, today: Iso, accountId: string | null, ask: boolean): Promise<SmsResult | null> {
  const perm = ask ? await plugin.requestPermission() : await plugin.checkPermission();
  if (!perm?.granted) {
    if (ask) throw new Error('اجازه خواندن پیامک داده نشد. از تنظیمات اندروید، مجوز «پیامک» را برای این اپ روشن کنید.');
    return null;
  }
  const since = lastPhoneRead() ?? Date.now() - FIRST_READ_DAYS * 86_400_000;
  const res = await plugin.read({ sinceMs: since, limit: 1000 });
  const msgs = (res?.messages ?? []).map((m) => ({ body: String(m.body ?? ''), at: Number(m.date) || undefined }));
  const out = rowsFromMessages(msgs, smsParser, today, { accountId });
  const newest = Math.max(since, ...msgs.map((m) => m.at ?? 0));
  try {
    localStorage.setItem(PHONE_READ_KEY, String(newest));
  } catch {
    // without it the next read starts from the same point; ids keep the queue free of repeats
  }
  return out;
}

export function queueRows(d: FinanceData, r: SmsResult): number {
  return enqueue(d, r.rows);
}
