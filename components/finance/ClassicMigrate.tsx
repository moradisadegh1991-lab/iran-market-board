'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { classicCount, MIGRATED_KEY, migrateClassic, parseClassic, type ClassicData, type MigrateResult } from '@/lib/finance/migrate';
import type { FinanceData } from '@/lib/finance/model';
import { useFinance } from './FinanceProvider';
import { Card, SelectBox } from './kit';

const faN = (n: number) => n.toLocaleString('fa-IR');

/**
 * Offers to bring the earlier Android app's expenses and holdings into this book. `always` shows
 * it even after it was done or dismissed (the accounts page); on the dashboard it appears once.
 */
export default function ClassicMigrate({ d, always = false }: { d: FinanceData; always?: boolean }) {
  const { update } = useFinance();
  const [c, setC] = useState<ClassicData | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(() => d.accounts.find((a) => a.kind === 'bank')?.id ?? '');
  const [done, setDone] = useState<MigrateResult | null>(null);

  useEffect(() => {
    try {
      setC(parseClassic((k) => localStorage.getItem(k)));
      setState(localStorage.getItem(MIGRATED_KEY));
    } catch {
      setC(null);
    }
  }, []);

  if (!c || !classicCount(c)) return null;
  if (state && !always && !done) return null;

  const mark = (v: string) => {
    try {
      localStorage.setItem(MIGRATED_KEY, v);
    } catch {
      // the card will just appear again
    }
    setState(v);
  };

  return (
    <Card title="داده‌های نسخه قبلی اپ" className="migrate-card">
      {done ? (
        <p role="status">
          {faN(done.queued)} تراکنش به <Link href="/import">صف بررسی «ورود از بانک»</Link> رفت{done.assets ? ` و ${faN(done.assets)} دارایی به «حساب و دارایی» اضافه شد` : ''}.
          {done.queued ? ' آن‌هایی که جهت و دسته‌شان را قبلاً تعیین کرده بودید با یک دکمه ثبت می‌شوند.' : ''}
        </p>
      ) : (
        <>
          <p>
            در این گوشی {c.tx.length ? `${faN(c.tx.length)} تراکنش هزینه` : ''}
            {c.pending.length ? `${c.tx.length ? '، ' : ''}${faN(c.pending.length)} پیامک منتظر تأیید` : ''}
            {c.holdings.length ? `${c.tx.length || c.pending.length ? ' و ' : ''}${faN(c.holdings.length)} دارایی` : ''} از نسخه قبلی اپ هست. همه را به همین دفتر بیاورید تا یک‌جا
            ببینید. چیزی پاک نمی‌شود و تکرار انتقال، ردیف تکراری نمی‌سازد.
          </p>
          {c.tx.length || c.pending.length ? (
            <div className="fin-grid">
              <SelectBox
                label="تراکنش‌ها مال کدام حساب‌اند؟"
                value={accountId}
                onChange={setAccountId}
                options={[{ key: '', label: '— بعداً در صف انتخاب می‌کنم —' }, ...d.accounts.filter((a) => !a.archived).map((a) => ({ key: a.id, label: a.name }))]}
              />
            </div>
          ) : null}
          <div className="fin-actions" style={{ marginTop: 10 }}>
            <button
              className="btn run"
              onClick={() => {
                let r: MigrateResult = { queued: 0, assets: 0 };
                update((dr) => {
                  r = migrateClassic(dr, c, accountId || null, Date.now());
                });
                setDone(r);
                mark(String(Date.now()));
              }}
            >
              انتقال به دفتر
            </button>
            {!always ? (
              <button className="fin-mini ghost" onClick={() => mark('skipped')}>
                لازم نیست
              </button>
            ) : null}
          </div>
        </>
      )}
    </Card>
  );
}
