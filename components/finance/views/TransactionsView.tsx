'use client';
import { LEND_LABEL, type LendKind } from '@/lib/finance/lending';
import { useMemo, useState } from 'react';
import { monthBounds, monthLabel, monthOf, monthTotals, shiftMonth, type JMonth } from '@/lib/finance/calc';
import { deleteTxn, txnsCsv } from '@/lib/finance/actions';
import type { FinanceData, TxnKind } from '@/lib/finance/model';
import { Chips, Empty, PageHead, Search } from '../../ui';
import { useFinance, WithBook } from '../FinanceProvider';
import { Bar, Card, confirmDelete, Disclosure, fmtDateFa, fmtPctFa, Money } from '../kit';
import TxnForm from '../TxnForm';

type KindFilter = 'all' | TxnKind;

interface NativeFiles {
  Filesystem?: { writeFile(o: { path: string; data: string; directory: string; encoding: string }): Promise<{ uri: string }> };
  Share?: { share(o: { title?: string; url?: string; files?: string[]; dialogTitle?: string }): Promise<unknown> };
}

/**
 * Saves a file the user asked for (backup, CSV). Android's WebView ignores `blob:` downloads, so
 * inside the APK the file is written to the app's cache and handed to the share sheet (save to
 * Files / Drive, send to Telegram…) through the official Capacitor plugins.
 */
export async function download(name: string, text: string, type: string) {
  const plugins = (window as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: NativeFiles } }).Capacitor;
  const fs = plugins?.Plugins?.Filesystem;
  const share = plugins?.Plugins?.Share;
  if (plugins?.isNativePlatform?.() && fs && share) {
    try {
      const { uri } = await fs.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
      await share.share({ title: name, files: [uri], dialogTitle: 'ذخیره یا ارسال فایل' }).catch(() => share.share({ title: name, url: uri, dialogTitle: 'ذخیره یا ارسال فایل' }));
    } catch (e) {
      // closing the share sheet is not an error worth showing
      if (!/cancel/i.test(String(e))) alert(`ذخیره فایل ممکن نشد: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MonthNav({ m, setM, max }: { m: JMonth; setM: (m: JMonth) => void; max: JMonth }) {
  const atMax = m.jy * 12 + m.jm >= max.jy * 12 + max.jm;
  return (
    <div className="fin-monthnav">
      <button className="fin-mini" onClick={() => setM(shiftMonth(m, -1))} aria-label="ماه قبل">
        ‹ قبلی
      </button>
      <b>{monthLabel(m)}</b>
      <button className="fin-mini" onClick={() => setM(shiftMonth(m, 1))} disabled={atMax} aria-label="ماه بعد">
        بعدی ›
      </button>
    </div>
  );
}

function Transactions({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const [m, setM] = useState<JMonth>(monthOf(today));
  const [kind, setKind] = useState<KindFilter>('all');
  const [q, setQ] = useState('');
  const { from, to } = monthBounds(m);
  const acc = useMemo(() => new Map(d.accounts.map((a) => [a.id, a.name])), [d.accounts]);
  const cat = useMemo(() => new Map(d.categories.map((c) => [c.id, c])), [d.categories]);
  const totals = monthTotals(d, m);

  const rows = d.txns
    .filter((t) => t.date >= from && t.date <= to)
    .filter((t) => kind === 'all' || t.kind === kind)
    .filter((t) => {
      if (!q.trim()) return true;
      const c = t.categoryId ? cat.get(t.categoryId)?.name ?? '' : '';
      return `${t.note ?? ''} ${c} ${acc.get(t.accountId) ?? ''}`.includes(q.trim());
    })
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));

  return (
    <>
      <PageHead title="تراکنش‌ها">هر خرج، درآمد و جابه‌جایی پول. انتقال بین حساب‌های خودتان جزو خرج یا درآمد حساب نمی‌شود.</PageHead>

      <Disclosure label="+ تراکنش تازه" defaultOpen={!d.txns.length}>
        {() => <TxnForm data={d} />}
      </Disclosure>

      <div className="fin-cols">
        <Card title={`خلاصه ${monthLabel(m)}`}>
          <MonthNav m={m} setM={setM} max={monthOf(today)} />
          <dl className="fin-kpis tight">
            <div className="fin-stat">
              <dt>درآمد</dt>
              <dd>
                <Money rial={totals.incomeRial} short />
              </dd>
            </div>
            <div className="fin-stat">
              <dt>خرج</dt>
              <dd>
                <Money rial={totals.expenseRial} short />
              </dd>
            </div>
            <div className="fin-stat">
              <dt>مانده</dt>
              <dd>
                <Money rial={totals.netRial} short signed />
              </dd>
            </div>
          </dl>
        </Card>
        <Card title="خرج به تفکیک دسته">
          {totals.byCategory.length ? (
            <ul className="fin-budget">
              {totals.byCategory.map((c) => {
                const k = c.categoryId ? cat.get(c.categoryId) : null;
                const pct = totals.expenseRial ? (c.rial / totals.expenseRial) * 100 : 0;
                return (
                  <li key={c.categoryId ?? '_'}>
                    <span>
                      {k ? `${k.emoji} ${k.name}` : 'بدون دسته'} <small className="muted">{fmtPctFa(pct)}</small>
                    </span>
                    <Bar pct={pct} />
                    <small>
                      <Money rial={c.rial} short />
                    </small>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>این ماه خرجی ثبت نشده.</Empty>
          )}
        </Card>
      </div>

      <div className="filterbar">
        <Chips<KindFilter>
          label="نوع"
          options={[
            { key: 'all', label: 'همه' },
            { key: 'expense', label: 'هزینه' },
            { key: 'income', label: 'درآمد' },
            { key: 'transfer', label: 'انتقال' },
          ]}
          value={kind}
          onChange={setKind}
        />
        <Search value={q} onChange={setQ} placeholder="جست‌وجو در توضیح، دسته یا حساب" />
        <button className="fin-mini" onClick={() => void download(`transactions-${today}.csv`, txnsCsv(d, fmtDateFa), 'text/csv;charset=utf-8')} disabled={!d.txns.length}>
          خروجی CSV (اکسل / Power BI)
        </button>
      </div>

      <div className="panel">
        {rows.length ? (
          <ul className="fin-list">
            {rows.map((t) => {
              const c = t.categoryId ? cat.get(t.categoryId) : null;
              const lend = t.link?.type === 'lend' ? (t.link.mk as LendKind | undefined) : undefined;
              const title = lend
                ? `🤝 ${LEND_LABEL[lend] ?? 'قرض'}: ${acc.get(t.link!.id) ?? '?'}`
                : t.kind === 'transfer'
                  ? `انتقال: ${acc.get(t.accountId) ?? '?'} ← ${acc.get(t.toAccountId ?? '') ?? '?'}`
                  : c
                    ? `${c.emoji} ${c.name}`
                    : 'بدون دسته';
              return (
                <li key={t.id}>
                  <span className="fin-list-main">
                    <b>{title}</b>
                    <small>
                      {fmtDateFa(t.date)}
                      {t.kind !== 'transfer' ? ` · ${acc.get(t.accountId) ?? ''}` : ''}
                      {t.note ? ` · ${t.note}` : ''}
                    </small>
                  </span>
                  <Money rial={t.kind === 'expense' ? -t.amountRial : t.kind === 'income' ? t.amountRial : t.amountRial} signed={t.kind !== 'transfer'} />
                  <button
                    className="fin-mini ghost"
                    aria-label="حذف"
                    onClick={() => {
                      if (confirmDelete(t.link ? 'این تراکنش (و ثبت پرداخت قسط/قبض/چک مربوطش)' : 'این تراکنش')) update((dr) => deleteTxn(dr, t.id));
                    }}
                  >
                    حذف
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>{d.txns.length ? 'با این فیلتر چیزی پیدا نشد.' : 'هنوز تراکنشی ثبت نشده.'}</Empty>
        )}
      </div>
    </>
  );
}

export default function TransactionsView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Transactions d={d} />}</WithBook>
    </div>
  );
}
