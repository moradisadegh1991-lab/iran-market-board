'use client';
import { useState } from 'react';
import { HORIZON_LABEL, PROFILE_LABEL } from '@/lib/engine/portfolio';
import { fmtInt, fmtPct, num } from '@/lib/num';
import type { PortfolioHorizon, Profile, Snapshot } from '@/lib/types';

const CLS_CLASS = { cash: 'c-cash', usd: 'c-usd', gold: 'c-gold', equity: 'c-equity', btc: 'c-btc', spec: 'c-spec' } as const;

export default function PortfolioPanel({ snap }: { snap: Snapshot }) {
  const [profile, setProfile] = useState<Profile>(snap.defaultProfile);
  const [horizon, setHorizon] = useState<PortfolioHorizon>('m3');
  const [amountTxt, setAmountTxt] = useState('');
  const p = snap.portfolios[profile][horizon];
  const amount = num(amountTxt);
  const lines = p.lines.filter((l) => l.weight > 0);

  return (
    <section className="block" id="portfolio">
      <div className="wrap">
        <h2>سبد دارایی پیشنهادی</h2>
        <p className="lede">
          وزن پایه هر پروفایل با ریسک ورودِ همان افق تنظیم می‌شود: ریسک پایین‌تر وزن بیشتر، ریسک بالاتر انتقال به درآمد ثابت. سقف کریپتو و آلت‌کوین برای هر پروفایل ثابت است.
        </p>
        <div className="controls">
          <div className="seg" role="group" aria-label="پروفایل ریسک">
            {(Object.keys(PROFILE_LABEL) as Profile[]).map((k) => (
              <button key={k} aria-pressed={profile === k} onClick={() => setProfile(k)}>
                {PROFILE_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="افق سرمایه‌گذاری">
            {(Object.keys(HORIZON_LABEL) as PortfolioHorizon[]).map((k) => (
              <button key={k} aria-pressed={horizon === k} onClick={() => setHorizon(k)}>
                {HORIZON_LABEL[k]}
              </button>
            ))}
          </div>
          <label className="amount">
            مبلغ سبد (تومان)
            <input inputMode="numeric" placeholder="مثلاً 500000000" value={amountTxt} onChange={(e) => setAmountTxt(e.target.value)} />
          </label>
        </div>

        <div className="surface" style={{ padding: 18 }}>
          <div className="metrics">
            <div>
              <b className="num">{fmtPct(p.annualVolPct, 0, false)}</b>
              <span>نوسان سالانه تخمینی سبد</span>
            </div>
            <div>
              <b className="num">{fmtPct(p.varPct, 0, false)}</b>
              <span>افت محتمل در بدترین ۵٪ حالت‌ها طی {HORIZON_LABEL[horizon]}</span>
            </div>
          </div>
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
                  <th>دسته</th>
                  <th>وزن</th>
                  <th>وزن پایه</th>
                  {Number.isFinite(amount) && amount > 0 ? <th>مبلغ (تومان)</th> : null}
                  <th>ابزار پیشنهادی</th>
                  <th>منطق تنظیم</th>
                </tr>
              </thead>
              <tbody>
                {p.lines.map((l) => (
                  <tr key={l.cls}>
                    <td className="sym">
                      <span className={`swatch ${CLS_CLASS[l.cls]}`} aria-hidden="true" />
                      {l.label}
                    </td>
                    <td className="num">{fmtPct(l.weight * 100, 0, false)}</td>
                    <td className="num muted">{fmtPct(l.baseWeight * 100, 0, false)}</td>
                    {Number.isFinite(amount) && amount > 0 ? <td className="num">{fmtInt(amount * l.weight)}</td> : null}
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
        </div>
      </div>
    </section>
  );
}
