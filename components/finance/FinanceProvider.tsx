'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { emptyData, normalizeData, type FinanceData } from '@/lib/finance/model';
import type { PriceItem } from '@/lib/finance/calc';
import { normalizeMemo, PRICE_MEMO_KEY, rememberPrices, withLastPrices, type PriceMemo } from '@/lib/finance/prices';
import { tehranDate } from '@/lib/num';
import { useSnapshot } from '../SnapshotProvider';

/**
 * The whole personal-finance book lives in this browser's localStorage under one key.
 * It is never sent to the server (CLAUDE.md rule 7); backups are files the user downloads.
 */
export const STORAGE_KEY = 'imf.finance.v1';

interface Ctx {
  /** null until the browser copy has been read (first client render) */
  data: FinanceData | null;
  today: string;
  items: PriceItem[];
  /** mutate a copy and persist it. Runs synchronously, so values the callback sets are readable right after. */
  update: (fn: (draft: FinanceData) => void) => void;
  replace: (d: FinanceData) => void;
  saveError: string | null;
}

const FinanceCtx = createContext<Ctx | null>(null);

export function useFinance(): Ctx {
  const c = useContext(FinanceCtx);
  if (!c) throw new Error('useFinance outside FinanceProvider');
  return c;
}

function read(today: string): FinanceData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeData(JSON.parse(raw), today);
  } catch {
    // a corrupt entry must not take the page down; fall through to a fresh book
  }
  return emptyData(today);
}

export default function FinanceProvider({ children }: { children: React.ReactNode }) {
  const { snap } = useSnapshot();
  const [data, setData] = useState<FinanceData | null>(null);
  const [today, setToday] = useState(() => tehranDate());
  const [saveError, setSaveError] = useState<string | null>(null);
  // the latest book, read synchronously by `update` (a state updater would run later, during render)
  const ref = useRef<FinanceData | null>(null);
  ref.current = data;

  useEffect(() => {
    const t = tehranDate();
    setToday(t);
    ref.current = read(t);
    setData(ref.current);
    // another tab edited the book → follow it
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        ref.current = read(tehranDate());
        setData(ref.current);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const persist = useCallback((d: FinanceData) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
      setSaveError(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'ذخیره در حافظه مرورگر ناموفق بود.');
    }
  }, []);

  const update = useCallback(
    (fn: (draft: FinanceData) => void) => {
      if (!ref.current) return;
      const draft = structuredClone(ref.current);
      const known = new Set(ref.current.txns.map((t) => t.id));
      fn(draft);
      // when each new row was booked: orders a same-day row without a time against the bank's balance (balance.ts)
      const now = Date.now();
      for (const t of draft.txns) if (!known.has(t.id) && !t.time && t.addedAt == null) t.addedAt = now;
      ref.current = draft;
      persist(draft);
      setData(draft);
    },
    [persist],
  );

  const replace = useCallback(
    (d: FinanceData) => {
      ref.current = d;
      persist(d);
      setData(d);
    },
    [persist],
  );

  // the last price of each item, for a board that lacks one (holiday, feed down, offline start)
  const [memo, setMemo] = useState<PriceMemo>({});
  useEffect(() => {
    try {
      setMemo(normalizeMemo(JSON.parse(localStorage.getItem(PRICE_MEMO_KEY) ?? 'null')));
    } catch {
      // no memory yet
    }
  }, []);
  const board = snap?.live.items;
  useEffect(() => {
    if (!board?.length) return;
    setMemo((m) => {
      const next = rememberPrices(m, board, tehranDate());
      try {
        localStorage.setItem(PRICE_MEMO_KEY, JSON.stringify(next));
      } catch {
        // memory only
      }
      return next;
    });
  }, [board]);
  const items: PriceItem[] = useMemo(() => withLastPrices(board ?? [], memo), [board, memo]);
  return <FinanceCtx.Provider value={{ data, today, items, update, replace, saveError }}>{children}</FinanceCtx.Provider>;
}

/** Renders children only once the local book is loaded (it cannot exist during SSR). */
export function WithBook({ children }: { children: (d: FinanceData) => React.ReactNode }) {
  const { data, saveError } = useFinance();
  if (!data) return <p className="muted state">در حال بارگذاری دفتر مالی…</p>;
  return (
    <>
      {saveError ? (
        <p className="banner warn" role="alert">
          ذخیره ناموفق بود ({saveError}). حافظه مرورگر پر است یا در حالت خصوصی هستید؛ از صفحه «حساب‌ها و کارت‌ها» پشتیبان بگیرید.
        </p>
      ) : null}
      {children(data)}
    </>
  );
}
