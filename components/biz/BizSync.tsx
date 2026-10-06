'use client';
// «فروشگاه آنلاین» in the background, on every page while the app is open (rule 80):
//  - collects what customers sent (every 45 s while visible) into pending orders/bookings and says so;
//  - republishes the catalog a few seconds after the menu, hours or taken times change;
//  - tells the server (and so a Telegram customer) when the owner confirms, finishes or cancels.
// Everything fails quietly offline and tries again later; the book never waits on the network.
import { useCallback, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { tehranDate } from '@/lib/num';
import { catalogOf, type InboxItem } from '@/lib/biz/public';
import { applyInbox, type Applied } from '@/lib/biz/online';
import type { FinanceData } from '@/lib/finance/model';
import { useFinance } from '../finance/FinanceProvider';
import { useNotify } from '../NotifyProvider';

const POLL_MS = 45_000;

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(api(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
}

export const catalogHash = (d: FinanceData) => {
  if (!d.biz?.online) return '';
  const { publishedAt: _, ...rest } = catalogOf(d.biz, d.biz.online.slug, Date.now(), tehranDate());
  return JSON.stringify(rest);
};

/** publish now (the «انتشار» button and the automatic republish) */
export async function publishNow(d: FinanceData, update: (fn: (dr: FinanceData) => void) => void): Promise<{ bot: string | null }> {
  const b = d.biz;
  if (!b?.online) throw new Error('نامک تعیین نشده.');
  const catalog = catalogOf(b, b.online.slug, Date.now(), tehranDate());
  const hash = catalogHash(d);
  try {
    const r = await post<{ bot: string | null }>('/api/biz/publish', { slug: b.online.slug, token: b.online.token, catalog });
    update((dr) => {
      if (!dr.biz?.online) return;
      Object.assign(dr.biz.online, { publishedAt: Date.now(), error: null, hash });
    });
    return { bot: r.bot ?? null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    update((dr) => {
      if (dr.biz?.online) dr.biz.online.error = msg;
    });
    throw e;
  }
}

/** collect the inbox now; returns what was added */
export async function pullNow(getData: () => FinanceData | null, update: (fn: (dr: FinanceData) => void) => void): Promise<Applied | null> {
  const b = getData()?.biz;
  if (!b?.online?.publishedAt) return null;
  const { slug, token } = b.online;
  const { items } = await post<{ items: InboxItem[] }>('/api/biz/inbox', { slug, token, ack: [] });
  if (!items.length) {
    update((dr) => {
      if (dr.biz?.online) dr.biz.online.pulledAt = Date.now();
    });
    return { orders: 0, bookings: 0, ack: [], problems: [] };
  }
  let res: Applied = { orders: 0, bookings: 0, ack: [], problems: [] };
  update((dr) => {
    res = applyInbox(dr, items, Date.now());
  });
  // only after the book holds them are they deleted on the server
  await post('/api/biz/inbox', { slug, token, ack: res.ack }).catch(() => undefined);
  return res;
}

export default function BizSync() {
  const { data, update } = useFinance();
  const { notify } = useNotify();
  const dataRef = useRef<FinanceData | null>(null);
  dataRef.current = data;
  const busy = useRef(false);
  const online = !!data?.biz?.online?.publishedAt;

  const pull = useCallback(async () => {
    if (busy.current || document.visibilityState !== 'visible') return;
    busy.current = true;
    try {
      const r = await pullNow(() => dataRef.current, update);
      if (r && (r.orders || r.bookings || r.problems.length)) {
        const parts = [r.orders ? `${r.orders.toLocaleString('fa-IR')} سفارش` : '', r.bookings ? `${r.bookings.toLocaleString('fa-IR')} نوبت` : ''].filter(Boolean).join(' و ');
        notify('سفارش آنلاین تازه', `${parts || 'درخواستی'} از مشتری‌ها رسید و منتظر تأیید شماست.${r.problems.length ? ` ${r.problems.join(' ')}` : ''}`, 'biz', r.orders || !r.bookings ? '/biz/orders' : '/biz/booking');
      }
    } catch {
      // offline or the server is away: next time
    } finally {
      busy.current = false;
    }
  }, [update, notify]);

  useEffect(() => {
    if (!online) return;
    void pull();
    const t = setInterval(() => document.visibilityState === 'visible' && void pull(), POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void pull();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [online, pull]);

  // the menu, hours or taken times changed: republish a few seconds later
  const hash = data?.biz?.online?.publishedAt ? catalogHash(data) : '';
  const stored = data?.biz?.online?.hash ?? '';
  useEffect(() => {
    if (!hash || hash === stored) return;
    const t = setTimeout(() => {
      const d = dataRef.current;
      if (d) void publishNow(d, update).catch(() => undefined);
    }, 4000);
    return () => clearTimeout(t);
  }, [hash, stored, update]);

  // statuses to tell customers about
  const b = data?.biz;
  const due = online && b ? [...b.orders.map((o) => ({ kind: 'o' as const, id: o.id, ref: o.ref, st: o.status as string, sent: o.refSent })), ...b.bookings.map((x) => ({ kind: 'b' as const, id: x.id, ref: x.ref, st: x.status as string, sent: x.refSent }))].filter((x) => x.ref && x.st !== 'pending' && x.st !== x.sent) : [];
  const dueKey = due.map((x) => `${x.id}:${x.st}`).join(',');
  useEffect(() => {
    if (!dueKey || !b?.online) return;
    const { slug, token } = b.online;
    let gone = false;
    void (async () => {
      for (const x of due) {
        if (gone) return;
        try {
          await post('/api/biz/status', { slug, token, id: x.ref, status: x.st });
          update((dr) => {
            const t = x.kind === 'o' ? dr.biz?.orders.find((o) => o.id === x.id) : dr.biz?.bookings.find((o) => o.id === x.id);
            if (t) t.refSent = x.st;
          });
        } catch {
          return; // offline: the next change or open tries again
        }
      }
    })();
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueKey]);

  return null;
}
