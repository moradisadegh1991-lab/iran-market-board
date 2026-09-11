'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Snapshot } from '@/lib/types';

const POLL_MS = 60_000;

interface Ctx {
  snap: Snapshot | null;
  busy: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}
const SnapshotCtx = createContext<Ctx>({ snap: null, busy: false, error: null, refresh: async () => {} });
export const useSnapshot = () => useContext(SnapshotCtx);

export default function SnapshotProvider({ initial, children }: { initial: Snapshot | null; children: React.ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/snapshot', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setSnap(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!initial) refresh();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [initial, refresh]);

  return <SnapshotCtx.Provider value={{ snap, busy, error, refresh }}>{children}</SnapshotCtx.Provider>;
}

/** Renders children only once a snapshot exists; otherwise a loading / error state that says what to do. */
export function WithSnapshot({ children }: { children: (snap: Snapshot) => React.ReactNode }) {
  const { snap, error, refresh, busy } = useSnapshot();
  if (snap) return <>{children(snap)}</>;
  return (
    <div className="state">
      {error ? (
        <>
          <p>داده‌ها دریافت نشد: {error}</p>
          <p className="muted">اتصال منابع را در صفحه «ربات و منابع» بررسی کنید.</p>
          <button className="btn" onClick={refresh} disabled={busy}>
            {busy ? 'در حال تلاش…' : 'تلاش دوباره'}
          </button>
        </>
      ) : (
        <p className="muted">در حال دریافت داده‌ها…</p>
      )}
    </div>
  );
}
