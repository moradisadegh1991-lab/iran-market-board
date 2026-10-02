'use client';
import Link from 'next/link';
import { useState } from 'react';
import { compareWithSuggested } from '@/lib/finance/compare';
import type { AllocationLine } from '@/lib/types';
import { Toggle } from '../ui';
import { useFinance } from './FinanceProvider';
import { fmtDateFa, fmtPctFa, Money } from './kit';

const CLS_CLASS = { cash: 'c-cash', usd: 'c-usd', gold: 'c-gold', equity: 'c-equity', btc: 'c-btc', spec: 'c-spec' } as const;

/** The book's holdings, class by class, next to the suggested weights — and the toman that would close each gap. */
export default function PortfolioCompare({ lines, title }: { lines: AllocationLine[]; title: string }) {
  const { data, items } = useFinance();
  const [withAccounts, setWithAccounts] = useState(true);
  if (!data) return null;
  const c = compareWithSuggested(data, items, lines, { includeAccounts: withAccounts });
  const shown = c.rows.filter((r) => r.targetPct > 0 || r.mineRial > 0);
  return (
    <section className="panel pad fin-card" aria-labelledby="cmp-h">
      <h2 id="cmp-h">سبد من در برابر {title}</h2>
      {c.totalRial <= 0 ? (
        <p className="empty">
          هنوز دارایی یا حسابی با موجودی ثبت نکرده‌اید. از <Link href="/accounts">حساب و دارایی</Link> طلا، سکه، ارز و کریپتوی خود را وارد کنید تا با این سبد مقایسه شوند.
        </p>
      ) : (
        <>
          <Toggle checked={withAccounts} onChange={setWithAccounts}>
            موجودی حساب‌های بانکی و نقد را هم سهم «درآمد ثابت ریالی» حساب کن
          </Toggle>
          <p className="muted small">
            جمع سبد شما: <Money rial={c.totalRial} /> · برای رسیدن به وزن‌های پیشنهادی حدود {fmtPctFa(c.turnoverPct)} از سبد باید جابه‌جا شود.
          </p>
          <div className="cmp-bars" aria-hidden="true">
            <div className="alloc">
              {shown.map((r) => (r.minePct > 0 ? <div key={r.cls} className={CLS_CLASS[r.cls]} style={{ width: `${r.minePct}%` }} title={`${r.label} ${Math.round(r.minePct)}٪`} /> : null))}
            </div>
            <small>سبد من</small>
            <div className="alloc">
              {shown.map((r) => (r.targetPct > 0 ? <div key={r.cls} className={CLS_CLASS[r.cls]} style={{ width: `${r.targetPct}%` }} title={`${r.label} ${Math.round(r.targetPct)}٪`} /> : null))}
            </div>
            <small>پیشنهادی</small>
          </div>
          <div className="table-scroll">
            <table className="t cmp-table">
              <thead>
                <tr>
                  <th scope="col">دسته</th>
                  <th scope="col">سهم من ← پیشنهادی</th>
                  <th scope="col">برای رسیدن به پیشنهادی</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const near = Math.abs(r.gapPct) < 1;
                  return (
                    <tr key={r.cls}>
                      <th scope="row" className="sym">
                        <span className={`swatch ${CLS_CLASS[r.cls]}`} aria-hidden="true" />
                        {r.label}
                      </th>
                      <td>
                        <b>{fmtPctFa(r.minePct)}</b> ← {fmtPctFa(r.targetPct)}
                        <small className="muted">
                          <Money rial={r.mineRial} short />
                        </small>
                      </td>
                      <td className={near ? 'muted' : r.moveRial > 0 ? 'up' : 'down'}>
                        {near ? (
                          'نزدیک است'
                        ) : (
                          <span className="money">
                            {r.moveRial > 0 ? 'خرید ' : 'فروش '}
                            <Money rial={Math.abs(r.moveRial)} short />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="notes">
            {c.lastPriced.length ? <li>با آخرین قیمت ثبت‌شده (بازار بسته یا قیمت لحظه‌ای نرسید): {c.lastPriced.map((x) => `${x.name} (${fmtDateFa(x.asOf)})`).join('، ')}</li> : null}
            {c.excluded.length ? (
              <li>
                در مقایسه نیامده‌اند: {c.excluded.map((x) => `${x.name}${x.why === 'unpriced' ? ' (بدون قیمت)' : ''}`).join('، ')} — دارایی‌های با ارزش دستی (ملک، خودرو، رهن، سهام) دسته مشخصی در این سبد ندارند.
              </li>
            ) : null}
            <li>طلا = طلای ۱۸، سکه‌ها و نقره؛ دلار = دلار و تتر؛ بیت‌کوین/اتریوم = BTC و ETH. «خرید/فروش» یعنی همین جمع، با وزن‌های پیشنهادی. پیشنهاد است، نه دستور: کارمزد و حباب هر جابه‌جایی را هم در نظر بگیرید.</li>
          </ul>
        </>
      )}
    </section>
  );
}
