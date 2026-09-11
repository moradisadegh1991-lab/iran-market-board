'use client';
import { useState } from 'react';
import { HORIZON_LABEL, PROFILE_LABEL } from '@/lib/engine/portfolio';
import { fmtInt, fmtPct, num } from '@/lib/num';
import type { PortfolioHorizon, Profile } from '@/lib/types';
import { WithSnapshot } from '../SnapshotProvider';
import { Chips, FilterBar, PageHead } from '../ui';

const CLS_CLASS = { cash: 'c-cash', usd: 'c-usd', gold: 'c-gold', equity: 'c-equity', btc: 'c-btc', spec: 'c-spec' } as const;

export default function PortfolioView() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [horizon, setHorizon] = useState<PortfolioHorizon>('m3');
  const [amountTxt, setAmountTxt] = useState('');

  return (
    <div className="wrap">
      <PageHead title="سبد دارایی پیشنهادی">وزن پایه هر پروفایل با ریسک ورودِ همان افق تنظیم می‌شود: ریسک پایین‌تر وزن بیشتر، ریسک بالاتر انتقال به درآمد ثابت. سقف کریپتو برای هر پروفایل ثابت است.</PageHead>
      <WithSnapshot>
        {(snap) => {
          const prof = profile ?? snap.defaultProfile;
          const p = snap.portfolios[prof][horizon];
          const amount = num(amountTxt);
          const hasAmount = Number.isFinite(amount) && amount > 0;
          const lines = p.lines.filter((l) => l.weight > 0);
          return (
            <>
              <FilterBar>
                <Chips label="پروفایل ریسک" value={prof} onChange={setProfile} options={(Object.keys(PROFILE_LABEL) as Profile[]).map((k) => ({ key: k, label: PROFILE_LABEL[k] }))} />
                <Chips label="افق" value={horizon} onChange={setHorizon} options={(Object.keys(HORIZON_LABEL) as PortfolioHorizon[]).map((k) => ({ key: k, label: HORIZON_LABEL[k] }))} />
                <label className="amount">
                  <span>مبلغ سبد (تومان)</span>
                  <input inputMode="numeric" placeholder="مثلاً ۵۰۰٬۰۰۰٬۰۰۰" value={amountTxt} onChange={(e) => setAmountTxt(e.target.value)} />
                </label>
              </FilterBar>
              <section className="panel pad">
                <dl className="metrics">
                  <div>
                    <dt>نوسان سالانه تخمینی سبد</dt>
                    <dd className="num">{fmtPct(p.annualVolPct, 0, false)}</dd>
                  </div>
                  <div>
                    <dt>افت محتمل در بدترین ۵٪ حالت‌ها طی {HORIZON_LABEL[horizon]}</dt>
                    <dd className="num">{fmtPct(p.varPct, 0, false)}</dd>
                  </div>
                  {hasAmount && p.varPct ? (
                    <div>
                      <dt>معادل ریالی این افت</dt>
                      <dd className="num">{fmtInt((amount * p.varPct) / 100)} تومان</dd>
                    </div>
                  ) : null}
                </dl>
                <div className="alloc" role="img" aria-label={lines.map((l) => `${l.label} ${Math.round(l.weight * 100)} درصد`).join('، ')}>
                  {lines.map((l) => (
                    <div key={l.cls} className={CLS_CLASS[l.cls]} style={{ width: `${l.weight * 100}%` }}>
                      {l.weight >= 0.07 ? fmtPct(l.weight * 100, 0, false) : ''}
                    </div>
                  ))}
                </div>
                <div className="table-scroll">
                  <table className="t">
                    <thead>
                      <tr>
                        <th scope="col">دسته</th>
                        <th scope="col">وزن</th>
                        <th scope="col">وزن پایه</th>
                        {hasAmount ? <th scope="col">مبلغ (تومان)</th> : null}
                        <th scope="col">ابزار پیشنهادی</th>
                        <th scope="col">منطق تنظیم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.lines.map((l) => (
                        <tr key={l.cls}>
                          <th scope="row" className="sym">
                            <span className={`swatch ${CLS_CLASS[l.cls]}`} aria-hidden="true" />
                            {l.label}
                          </th>
                          <td className="num">{fmtPct(l.weight * 100, 0, false)}</td>
                          <td className="num muted">{fmtPct(l.baseWeight * 100, 0, false)}</td>
                          {hasAmount ? <td className="num">{fmtInt(amount * l.weight)}</td> : null}
                          <td>{l.instrument}</td>
                          <td className="reasons">{l.rationale}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="notes">
                  {p.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </section>
            </>
          );
        }}
      </WithSnapshot>
    </div>
  );
}
