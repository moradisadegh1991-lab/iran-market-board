'use client';
import { useState } from 'react';
import { addDays, goalPlan } from '@/lib/finance/calc';
import { newId, tomanToRial, type FinanceData } from '@/lib/finance/model';
import { Empty, PageHead, Toggle } from '../../ui';
import { useFinance, WithBook } from '../FinanceProvider';
import { Bar, Card, confirmDelete, Disclosure, fmtDateFa, fmtPctFa, JalaliDate, Money, parseAmount, TextInput, TomanInput } from '../kit';

function Goals({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [saved, setSaved] = useState('');
  const [date, setDate] = useState(addDays(today, 365));
  const [infl, setInfl] = useState(true);
  const [add, setAdd] = useState<Record<string, string>>({});
  const { inflationPct, safeYieldPct } = d.settings;

  return (
    <>
      <PageHead title="اهداف پس‌انداز">
        خانه، خودرو، جهیزیه، سفر یا صندوق اضطراری. با تورم {fmtPctFa(inflationPct)} قیمت هدف تا آن روز بالا می‌رود؛ عددها این را حساب می‌کنند و نشان می‌دهند اگر پول را در صندوق درآمد ثابت (
        {fmtPctFa(safeYieldPct)}) بگذارید، ماهی چقدر کافی است. این دو عدد را در «حساب‌ها و کارت‌ها ← تنظیمات» عوض کنید.
      </PageHead>

      {d.goals.length ? (
        d.goals.map((g) => {
          const p = goalPlan(g, today, inflationPct, safeYieldPct);
          return (
            <Card
              key={g.id}
              title={g.name}
              action={
                <button className="fin-mini ghost" onClick={() => confirmDelete(`هدف «${g.name}»`) && update((dr) => void (dr.goals = dr.goals.filter((x) => x.id !== g.id)))}>
                  حذف
                </button>
              }
            >
              <Bar pct={p.progressPct} tone={p.reached ? 'ok' : 'warn'} />
              <dl className="fin-kpis tight">
                <div className="fin-stat">
                  <dt>پس‌انداز فعلی</dt>
                  <dd>
                    <Money rial={g.savedRial} short />
                  </dd>
                </div>
                <div className="fin-stat">
                  <dt>{g.inflationAdjust ? `هدف در ${fmtDateFa(g.targetDate)} (با تورم)` : `هدف تا ${fmtDateFa(g.targetDate)}`}</dt>
                  <dd>
                    <Money rial={p.futureTargetRial} short />
                  </dd>
                  {g.inflationAdjust ? (
                    <dd className="fin-stat-sub">
                      به پول امروز <Money rial={g.targetRial} short />
                    </dd>
                  ) : null}
                </div>
                <div className="fin-stat">
                  <dt>ماهانه، اگر پول بی‌سود بماند</dt>
                  <dd>
                    <Money rial={p.monthlyNoReturnRial} short />
                  </dd>
                </div>
                <div className="fin-stat">
                  <dt>ماهانه، در صندوق درآمد ثابت</dt>
                  <dd>
                    <Money rial={p.monthlyAtSafeYieldRial} short />
                  </dd>
                  <dd className="fin-stat-sub">
                    بازده واقعی صندوق: <span className={p.realSafeYieldPct < 0 ? 'down' : 'up'}>{fmtPctFa(p.realSafeYieldPct, 1)}</span>
                  </dd>
                </div>
              </dl>
              {p.reached ? <p className="up">به هدف رسیده‌اید.</p> : p.monthsLeft < 1 ? <p className="down">زمان هدف رسیده یا کمتر از یک ماه مانده.</p> : null}
              <div className="fin-inline">
                <input
                  className="fin-input sm"
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="تومان"
                  aria-label="مبلغ واریز به هدف"
                  value={add[g.id] ?? ''}
                  onChange={(e) => setAdd((x) => ({ ...x, [g.id]: e.target.value }))}
                />
                <button
                  className="fin-mini"
                  onClick={() => {
                    const t = parseAmount(add[g.id] ?? '');
                    if (!(t > 0)) return;
                    update((dr) => void (dr.goals.find((x) => x.id === g.id)!.savedRial += tomanToRial(t)));
                    setAdd((x) => ({ ...x, [g.id]: '' }));
                  }}
                >
                  افزودن به پس‌انداز
                </button>
                <button
                  className="fin-mini ghost"
                  onClick={() => {
                    const t = parseAmount(add[g.id] ?? '');
                    if (!(t > 0)) return;
                    update((dr) => {
                      const x = dr.goals.find((y) => y.id === g.id)!;
                      x.savedRial = Math.max(0, x.savedRial - tomanToRial(t));
                    });
                    setAdd((x) => ({ ...x, [g.id]: '' }));
                  }}
                >
                  برداشت
                </button>
              </div>
            </Card>
          );
        })
      ) : (
        <Card>
          <Empty>هنوز هدفی ندارید.</Empty>
        </Card>
      )}

      <Disclosure label="+ هدف تازه" defaultOpen={!d.goals.length}>
        {(close) => (
          <div className="fin-grid">
            <TextInput label="عنوان" value={name} onChange={setName} placeholder="مثلاً پیش‌پرداخت خانه" />
            <TomanInput label="مبلغ هدف به پول امروز (تومان)" value={target} onChange={setTarget} />
            <TomanInput label="تا الان جمع کرده‌ام (تومان)" value={saved} onChange={setSaved} placeholder="۰" />
            <JalaliDate label="تاریخ هدف" value={date} onChange={setDate} yearsBack={0} yearsAhead={20} />
            <div className="fin-span">
              <Toggle checked={infl} onChange={setInfl}>
                قیمت هدف با تورم بالا می‌رود (برای خانه، خودرو، طلا روشن بگذارید)
              </Toggle>
            </div>
            <div className="fin-span fin-actions">
              <button
                className="btn"
                onClick={() => {
                  const t = parseAmount(target);
                  if (!name.trim() || !(t > 0) || date <= today) return;
                  update(
                    (dr) =>
                      void dr.goals.push({ id: newId('g'), name: name.trim(), targetRial: tomanToRial(t), savedRial: tomanToRial(parseAmount(saved) || 0), targetDate: date, inflationAdjust: infl }),
                  );
                  setName('');
                  setTarget('');
                  setSaved('');
                  close();
                }}
              >
                ذخیره
              </button>
            </div>
          </div>
        )}
      </Disclosure>
    </>
  );
}

export default function GoalsView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Goals d={d} />}</WithBook>
    </div>
  );
}
