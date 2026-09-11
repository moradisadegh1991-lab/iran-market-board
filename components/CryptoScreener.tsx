'use client';
import { useState } from 'react';
import Sparkline from './Sparkline';
import { fmtCompactUsd, fmtInt, fmtPct, fmtPrice, isNum } from '@/lib/num';
import type { CryptoRow, Snapshot } from '@/lib/types';

const sign = (p: number | null) => (!isNum(p) || p === 0 ? 'flat' : p > 0 ? 'up' : 'down');

function Table({ rows }: { rows: CryptoRow[] }) {
  if (!rows.length) return <p className="empty">داده بازار کریپتو در دسترس نیست. وضعیت CoinGecko را در تابلو بالا ببینید.</p>;
  return (
    <div className="table-scroll">
      <table className="t">
        <thead>
          <tr>
            <th>#</th>
            <th>ارز</th>
            <th>قیمت ($)</th>
            <th>۲۴ ساعت</th>
            <th>۷ روز</th>
            <th>۳۰ روز</th>
            <th>روند ۷ روزه</th>
            <th>امتیاز</th>
            <th>ریسک هفته</th>
            <th>چرا در فهرست است</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td className="rank num">{fmtInt(c.rank)}</td>
              <td className="sym">
                {c.symbol}
                <small>
                  {c.name} · {fmtCompactUsd(c.mcap)}
                </small>
                {c.onNobitex ? <span className="badge-ok">قابل معامله در نوبیتکس</span> : null}
              </td>
              <td className="num ltr">{fmtPrice(c.price)}</td>
              <td className={`num ltr ${sign(c.m24)}`}>{fmtPct(c.m24)}</td>
              <td className={`num ltr ${sign(c.m7)}`}>{fmtPct(c.m7)}</td>
              <td className={`num ltr ${sign(c.m30)}`}>{fmtPct(c.m30)}</td>
              <td>
                <Sparkline data={c.spark} />
              </td>
              <td>
                <span className="scorebar num">
                  <span className="bar">
                    <b style={{ width: `${c.score}%` }} />
                  </span>
                  {fmtInt(c.score)}
                </span>
              </td>
              <td className="num">{fmtInt(c.riskWeek)}</td>
              <td className="reasons">{c.reasons.join('؛ ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CryptoScreener({ crypto }: { crypto: Snapshot['crypto'] }) {
  const [tab, setTab] = useState<'coins' | 'memes'>('coins');
  return (
    <section className="block" id="crypto">
      <div className="wrap">
        <h2>ارز دیجیتال: فهرست مستعد رشد در هفته آینده</h2>
        <p className="lede">{crypto.note}</p>
        <div className="controls">
          <div className="seg" role="group" aria-label="نوع دارایی">
            <button aria-pressed={tab === 'coins'} onClick={() => setTab('coins')}>
              ۱۰ کوین
            </button>
            <button aria-pressed={tab === 'memes'} onClick={() => setTab('memes')}>
              ۱۰ میم‌کوین
            </button>
          </div>
        </div>
        <div className="surface">
          <Table rows={tab === 'coins' ? crypto.coins : crypto.memes} />
        </div>
      </div>
    </section>
  );
}
