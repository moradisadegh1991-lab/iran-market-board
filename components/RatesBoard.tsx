'use client';
import { useEffect, useRef, useState } from 'react';
import { fmtDateTimeFa, fmtPct, fmtPrice, isNum } from '@/lib/num';
import type { Snapshot } from '@/lib/types';

const UNIT: Record<string, string> = { toman: 'تومان', usd: 'دلار', point: 'واحد' };
const dirClass = (p: number | null) => (!isNum(p) || p === 0 ? '' : p > 0 ? 'up' : 'down');

export default function RatesBoard({ snap }: { snap: Snapshot }) {
  const prev = useRef<Record<string, number | null>>({});
  const [flash, setFlash] = useState<Record<string, 'flash-up' | 'flash-down'>>({});

  useEffect(() => {
    const next: Record<string, 'flash-up' | 'flash-down'> = {};
    for (const it of snap.live.items) {
      const before = prev.current[it.key];
      if (isNum(before) && isNum(it.price) && before !== it.price) next[it.key] = it.price > before ? 'flash-up' : 'flash-down';
      prev.current[it.key] = it.price;
    }
    if (Object.keys(next).length) {
      setFlash(next);
      const t = setTimeout(() => setFlash({}), 900);
      return () => clearTimeout(t);
    }
  }, [snap]);

  return (
    <header className="board" id="board">
      <div className="wrap">
        <div className="board-head">
          <h1 className="board-title">تابلوی بازار</h1>
          <div className="board-sub">آخرین به‌روزرسانی {fmtDateTimeFa(snap.generatedAt)}</div>
        </div>
        <div className="board-grid">
          {snap.live.items.map((it) => (
            <div className="rate" key={it.key}>
              <div className="rate-label">{it.label}</div>
              <div className={`rate-price num ${flash[it.key] ?? ''}`}>
                {fmtPrice(it.price)}
                <span className="rate-unit">{UNIT[it.unit]}</span>
              </div>
              <div className="rate-meta">
                <span>{it.note ?? ''}</span>
                <span className={`rate-chg num ${dirClass(it.changePct)}`}>
                  {isNum(it.changePct) ? `${it.changePct > 0 ? '▲' : it.changePct < 0 ? '▼' : ''} ${fmtPct(it.changePct)}` : '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="sources" aria-label="وضعیت منابع داده">
          {snap.sources.map((s) => (
            <span key={s.name} className={`src ${!s.ok && s.ageSec === null ? 'fail' : s.stale || !s.ok ? 'stale' : ''}`} title={s.error ?? ''}>
              <i aria-hidden="true" />
              {s.label}
              {s.via === 'ingest' ? ' (ارسال از ایران)' : ''}
            </span>
          ))}
        </div>
        {snap.storeMode === 'memory' ? (
          <p className="banner">Upstash Redis وصل نیست؛ تاریخچه و مشترکان ربات بعد از هر اجرا پاک می‌شوند.</p>
        ) : null}
      </div>
    </header>
  );
}
