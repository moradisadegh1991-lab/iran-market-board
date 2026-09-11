'use client';
import { useState } from 'react';
import Sparkline from '../Sparkline';
import { fmtCompactUsd, fmtInt, fmtPrice } from '@/lib/num';
import type { CryptoRow } from '@/lib/types';
import { WithSnapshot } from '../SnapshotProvider';
import { Chips, Empty, FilterBar, PageHead, Pct, Search, Select, Toggle } from '../ui';

type Sort = 'score' | 'm7' | 'm30' | 'risk' | 'mcap';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'score', label: 'امتیاز غربال' },
  { key: 'm7', label: 'بازده ۷ روز' },
  { key: 'm30', label: 'بازده ۳۰ روز' },
  { key: 'risk', label: 'کم‌ریسک‌ترین در هفته' },
  { key: 'mcap', label: 'ارزش بازار' },
];
const sorter: Record<Sort, (a: CryptoRow, b: CryptoRow) => number> = {
  score: (a, b) => b.score - a.score,
  m7: (a, b) => (b.m7 ?? -1e9) - (a.m7 ?? -1e9),
  m30: (a, b) => (b.m30 ?? -1e9) - (a.m30 ?? -1e9),
  risk: (a, b) => (a.riskWeek ?? 999) - (b.riskWeek ?? 999),
  mcap: (a, b) => b.mcap - a.mcap,
};

export default function CryptoView() {
  const [tab, setTab] = useState<'coins' | 'memes'>('coins');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('score');
  const [onlyNobitex, setOnlyNobitex] = useState(false);
  const [limit, setLimit] = useState<'10' | '25'>('10');

  return (
    <div className="wrap">
      <PageHead title="کریپتو: مستعد رشد در هفته آینده">رتبه‌بندی بر پایه روند و مومنتوم ۷ و ۳۰ روزه، گردش معاملات و نزدیکی به سقف هفته. این فهرست پیش‌بینی قیمت نیست؛ به‌ویژه برای میم‌کوین‌ها قدرت پیش‌بینی ضعیف است.</PageHead>
      <WithSnapshot>
        {(snap) => {
          const all = tab === 'coins' ? snap.crypto.coins : snap.crypto.memes;
          const hasNobitex = all.some((c) => c.onNobitex !== null);
          const term = q.trim().toLowerCase();
          const rows = all
            .filter((c) => !term || c.symbol.toLowerCase().includes(term) || c.name.toLowerCase().includes(term))
            .filter((c) => !onlyNobitex || c.onNobitex)
            .sort(sorter[sort])
            .slice(0, Number(limit));
          return (
            <>
              <FilterBar>
                <Chips label="نوع" value={tab} onChange={setTab} options={[{ key: 'coins', label: 'کوین‌ها', count: snap.crypto.coins.length }, { key: 'memes', label: 'میم‌کوین‌ها', count: snap.crypto.memes.length }]} />
                <Search value={q} onChange={setQ} placeholder="جست‌وجوی نماد یا نام" />
                <Select label="مرتب‌سازی" value={sort} onChange={setSort} options={SORTS} />
                <Chips label="تعداد" value={limit} onChange={setLimit} options={[{ key: '10', label: '۱۰ ردیف' }, { key: '25', label: '۲۵ ردیف' }]} />
                {hasNobitex ? (
                  <Toggle checked={onlyNobitex} onChange={setOnlyNobitex}>
                    فقط قابل معامله در نوبیتکس
                  </Toggle>
                ) : null}
              </FilterBar>
              <div className="panel table-scroll">
                {rows.length === 0 ? (
                  <Empty>{all.length ? 'هیچ ردیفی با این فیلترها پیدا نشد. جست‌وجو یا فیلتر را تغییر دهید.' : 'داده بازار کریپتو در دسترس نیست. وضعیت CoinGecko را در صفحه «ربات و منابع» ببینید.'}</Empty>
                ) : (
                  <table className="t sticky-first">
                    <thead>
                      <tr>
                        <th scope="col">ارز</th>
                        <th scope="col">قیمت ($)</th>
                        <th scope="col">۲۴ ساعت</th>
                        <th scope="col">۷ روز</th>
                        <th scope="col">۳۰ روز</th>
                        <th scope="col">روند هفته</th>
                        <th scope="col">امتیاز</th>
                        <th scope="col">ریسک هفته</th>
                        <th scope="col">دلیل حضور در فهرست</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((c) => (
                        <tr key={c.id}>
                          <th scope="row" className="sym">
                            <span className="rank num">{fmtInt(c.rank)}</span> {c.symbol}
                            <small>
                              {c.name}، {fmtCompactUsd(c.mcap)}
                            </small>
                            {c.onNobitex ? <span className="badge">نوبیتکس</span> : null}
                          </th>
                          <td className="num">{fmtPrice(c.price)}</td>
                          <td><Pct v={c.m24} /></td>
                          <td><Pct v={c.m7} /></td>
                          <td><Pct v={c.m30} /></td>
                          <td><Sparkline data={c.spark} /></td>
                          <td>
                            <span className="scorebar num">
                              <span className="bar"><b style={{ width: `${c.score}%` }} /></span>
                              {fmtInt(c.score)}
                            </span>
                          </td>
                          <td className="num">{fmtInt(c.riskWeek)}</td>
                          <td className="reasons">{c.reasons.join('؛ ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          );
        }}
      </WithSnapshot>
    </div>
  );
}
