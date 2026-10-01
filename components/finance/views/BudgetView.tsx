'use client';
import { useState } from 'react';
import { budgetStatus, monthLabel, monthOf, monthTotals, shiftMonth, type JMonth } from '@/lib/finance/calc';
import { newId, tomanToRial, type CategoryKind, type FinanceData } from '@/lib/finance/model';
import { PageHead } from '../../ui';
import { useFinance, WithBook } from '../FinanceProvider';
import { Bar, Card, confirmDelete, fmtPctFa, fmtToman, Money, parseAmount, SelectBox, TextInput } from '../kit';
import { MonthNav } from './TransactionsView';

/** Average of the last three complete months per category, rounded up to a 100-thousand-toman step. */
function suggestion(d: FinanceData, today: string): Map<string, number> {
  const cur = monthOf(today);
  const sums = new Map<string, number>();
  for (let i = 1; i <= 3; i++) {
    for (const c of monthTotals(d, shiftMonth(cur, -i)).byCategory) if (c.categoryId) sums.set(c.categoryId, (sums.get(c.categoryId) ?? 0) + c.rial);
  }
  const step = tomanToRial(100_000);
  return new Map([...sums].map(([k, v]) => [k, Math.ceil(v / 3 / step) * step]));
}

function Budget({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const [m, setM] = useState<JMonth>(monthOf(today));
  const [draft, setDraft] = useState<Record<string, string>>({});
  const lines = new Map(budgetStatus(d, m, today).map((b) => [b.categoryId, b]));
  const spent = new Map(monthTotals(d, m).byCategory.map((c) => [c.categoryId, c.rial]));
  const limit = new Map(d.budgets.map((b) => [b.categoryId, b.monthlyRial]));
  const expenseCats = d.categories.filter((c) => c.kind === 'expense');
  const totalLimit = d.budgets.reduce((s, b) => s + b.monthlyRial, 0);
  const totalSpent = expenseCats.reduce((s, c) => s + (spent.get(c.id) ?? 0), 0);
  const sug = suggestion(d, today);

  function setLimit(categoryId: string, raw: string) {
    const t = parseAmount(raw);
    update((dr) => {
      dr.budgets = dr.budgets.filter((b) => b.categoryId !== categoryId);
      if (t > 0) dr.budgets.push({ categoryId, monthlyRial: tomanToRial(t) });
    });
    setDraft((x) => ({ ...x, [categoryId]: '' }));
  }

  const [catName, setCatName] = useState('');
  const [catEmoji, setCatEmoji] = useState('');
  const [catKind, setCatKind] = useState<CategoryKind>('expense');

  return (
    <>
      <PageHead title="بودجه ماهانه">
        برای هر دسته سقف ماهانه بگذارید. خط عمودی روی نوار نشان می‌دهد چند درصد از ماه گذشته؛ اگر خرج از آن جلو بزند، هشدار می‌گیرید.
      </PageHead>

      <Card>
        <MonthNav m={m} setM={setM} max={shiftMonth(monthOf(today), 1)} />
        <p className="muted small">
          جمع بودجه: <Money rial={totalLimit} /> · خرج {monthLabel(m)}: <Money rial={totalSpent} />
          {sug.size ? (
            <>
              {' · '}
              <button
                className="fin-mini"
                onClick={() =>
                  update((dr) => {
                    for (const [k, v] of sug) if (!dr.budgets.some((b) => b.categoryId === k)) dr.budgets.push({ categoryId: k, monthlyRial: v });
                  })
                }
              >
                پر کردن خانه‌های خالی با میانگین سه ماه گذشته
              </button>
            </>
          ) : null}
        </p>
        <div className="table-scroll">
          <table className="t fin-table">
            <thead>
              <tr>
                <th>دسته</th>
                <th>سقف ماهانه</th>
                <th>خرج شده</th>
                <th style={{ width: '32%' }}>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {expenseCats.map((c) => {
                const b = lines.get(c.id);
                const lim = limit.get(c.id);
                return (
                  <tr key={c.id}>
                    <th>
                      {c.emoji} {c.name}
                    </th>
                    <td>
                      <input
                        className="fin-input sm"
                        dir="ltr"
                        inputMode="numeric"
                        aria-label={`سقف ${c.name} به تومان`}
                        placeholder={lim ? String(lim / 10) : sug.get(c.id) ? `پیشنهاد ${sug.get(c.id)! / 10}` : 'تومان'}
                        value={draft[c.id] ?? ''}
                        onChange={(e) => setDraft((x) => ({ ...x, [c.id]: e.target.value }))}
                        onBlur={(e) => e.target.value && setLimit(c.id, e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                      {lim ? (
                        <small className="muted">
                          {fmtToman(lim)}{' '}
                          <button className="linkish" onClick={() => setLimit(c.id, '0')}>
                            برداشتن
                          </button>
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <Money rial={spent.get(c.id) ?? 0} short />
                    </td>
                    <td>
                      {b ? (
                        <>
                          <Bar pct={b.usedPct} tone={b.status === 'over' ? 'bad' : b.status === 'hot' ? 'warn' : 'ok'} marker={b.pacePct} />
                          <small className={b.status === 'over' ? 'down' : 'muted'}>
                            {fmtPctFa(b.usedPct)} مصرف
                            {b.status === 'over' ? ' — رد شده' : b.status === 'hot' ? ' — تند' : ''}
                          </small>
                        </>
                      ) : (
                        <small className="muted">بدون سقف</small>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="دسته‌ها">
        <div className="fin-tags">
          {d.categories.map((c) => (
            <span key={c.id} className={`fin-tag ${c.kind}`}>
              {c.emoji} {c.name}
              {c.id.startsWith('u-') ? (
                <button
                  className="linkish"
                  aria-label={`حذف ${c.name}`}
                  onClick={() => {
                    if (d.txns.some((t) => t.categoryId === c.id)) return alert('این دسته تراکنش دارد و حذف نمی‌شود.');
                    if (confirmDelete(`دسته «${c.name}»`))
                      update((dr) => {
                        dr.categories = dr.categories.filter((x) => x.id !== c.id);
                        dr.budgets = dr.budgets.filter((x) => x.categoryId !== c.id);
                      });
                  }}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
        <div className="fin-grid">
          <TextInput label="نام دسته تازه" value={catName} onChange={setCatName} placeholder="مثلاً شهریه مدرسه" />
          <TextInput label="ایموجی (اختیاری)" value={catEmoji} onChange={setCatEmoji} placeholder="🎒" />
          <SelectBox<CategoryKind> label="نوع" value={catKind} onChange={setCatKind} options={[{ key: 'expense', label: 'هزینه' }, { key: 'income', label: 'درآمد' }]} />
          <div className="fin-actions">
            <button
              className="btn"
              onClick={() => {
                const name = catName.trim();
                if (!name || d.categories.some((c) => c.name === name && c.kind === catKind)) return;
                update((dr) => {
                  dr.categories.push({ id: newId('u'), name, emoji: catEmoji.trim() || (catKind === 'expense' ? '💰' : '💵'), kind: catKind });
                });
                setCatName('');
                setCatEmoji('');
              }}
            >
              افزودن دسته
            </button>
          </div>
        </div>
      </Card>
    </>
  );
}

export default function BudgetView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Budget d={d} />}</WithBook>
    </div>
  );
}
