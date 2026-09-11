'use client';
import { useState } from 'react';
import { fmtInt, fmtNum, isNum } from '@/lib/num';
import type { StockRow } from '@/lib/types';
import { WithSnapshot } from '../SnapshotProvider';
import { Chips, Empty, FilterBar, PageHead, Pct, Search, Select, Toggle } from '../ui';

type Sort = 'score' | 'r20' | 'r60' | 'today' | 'risk' | 'pe';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'score', label: 'امتیاز غربال' },
  { key: 'r20', label: 'بازده ۲۰ روز' },
  { key: 'r60', label: 'بازده ۶۰ روز' },
  { key: 'today', label: 'تغییر امروز' },
  { key: 'risk', label: 'کم‌ریسک‌ترین در ماه' },
  { key: 'pe', label: 'کمترین P/E' },
];
const val = (x: number | null, dflt: number) => (isNum(x) ? x : dflt);
const sorter: Record<Sort, (a: StockRow, b: StockRow) => number> = {
  score: (a, b) => b.score - a.score,
  r20: (a, b) => val(b.r20, -1e9) - val(a.r20, -1e9),
  r60: (a, b) => val(b.r60, -1e9) - val(a.r60, -1e9),
  today: (a, b) => val(b.chgToday, -1e9) - val(a.chgToday, -1e9),
  risk: (a, b) => val(a.riskMonth, 999) - val(b.riskMonth, 999),
  pe: (a, b) => val(a.pe && a.pe > 0 ? a.pe : null, 1e9) - val(b.pe && b.pe > 0 ? b.pe : null, 1e9),
};

export default function StocksView() {
  const [q, setQ] = useState('');
  const [sector, setSector] = useState('all');
  const [sort, setSort] = useState<Sort>('score');
  const [clean, setClean] = useState(false);
  const [limit, setLimit] = useState<'10' | '25'>('10');

  return (
    <div className="wrap">
      <PageHead title="بورس و فرابورس: مستعد رشد در یک ماه">قدرت نسبی به شاخص، جهش ارزش معاملات، نزدیکی به سقف ۶۰ روزه، روند میانگین‌ها و ورود پول حقیقی. نمادهای زیان‌ده، اشباع خرید و صف خرید امتیاز منفی می‌گیرند.</PageHead>
      <WithSnapshot>
        {(snap) => {
          const all = snap.stocks.rows;
          const sectors = [...new Set(all.map((r) => r.sector).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, 'fa'));
          const term = q.trim();
          const rows = all
            .filter((r) => !term || r.symbol.includes(term) || r.name.includes(term))
            .filter((r) => sector === 'all' || r.sector === sector)
            .filter((r) => !clean || r.flags.length === 0)
            .sort(sorter[sort])
            .slice(0, Number(limit));
          const tse = snap.scenarios.assets.find((a) => a.key === 'tse');
          return (
            <>
              {snap.stocks.mode !== 'history' ? <p className="banner">{snap.stocks.note}</p> : null}
              {tse?.rows.m1 ? (
                <p className="banner info">
                  شاخص کل در یک ماه آینده با احتمال ۹۰٪ بین <bdi className="num">{fmtInt(tse.rows.m1.worst)}</bdi> و <bdi className="num">{fmtInt(tse.rows.m1.best)}</bdi> است.{' '}
                  <a href="/scenarios#s-tse">دلایل و افق‌های دیگر</a>
                </p>
              ) : null}
              <FilterBar>
                <Search value={q} onChange={setQ} placeholder="جست‌وجوی نماد یا نام شرکت" />
                {sectors.length > 1 ? <Select label="صنعت" value={sector} onChange={setSector} options={[{ key: 'all', label: 'همه صنایع' }, ...sectors.map((s) => ({ key: s, label: s }))]} /> : null}
                <Select label="مرتب‌سازی" value={sort} onChange={setSort} options={SORTS} />
                <Chips label="تعداد" value={limit} onChange={setLimit} options={[{ key: '10', label: '۱۰ ردیف' }, { key: '25', label: '۲۵ ردیف' }]} />
                <Toggle checked={clean} onChange={setClean}>
                  بدون هشدار (صف، اشباع، زیان)
                </Toggle>
              </FilterBar>
              <div className="panel table-scroll">
                {rows.length === 0 ? (
                  <Empty>{all.length ? 'هیچ نمادی با این فیلترها پیدا نشد. جست‌وجو یا فیلتر را تغییر دهید.' : snap.stocks.note}</Empty>
                ) : (
                  <table className="t sticky-first">
                    <thead>
                      <tr>
                        <th scope="col">نماد</th>
                        <th scope="col">قیمت (ریال)</th>
                        <th scope="col">امروز</th>
                        <th scope="col">۲۰ روز</th>
                        <th scope="col">۶۰ روز</th>
                        <th scope="col">جهش حجم</th>
                        <th scope="col">P/E</th>
                        <th scope="col">امتیاز</th>
                        <th scope="col">ریسک ماه</th>
                        <th scope="col">دلایل و هشدارها</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.symbol}>
                          <th scope="row" className="sym">
                            <span className="rank num">{fmtInt(r.rank)}</span> {r.symbol}
                            <small>{r.name}{r.sector ? `، ${r.sector}` : ''}</small>
                          </th>
                          <td className="num">{fmtInt(r.price)}</td>
                          <td><Pct v={r.chgToday} /></td>
                          <td><Pct v={r.r20} digits={0} /></td>
                          <td><Pct v={r.r60} digits={0} /></td>
                          <td className="num">{isNum(r.volSurge) ? `×${fmtNum(r.volSurge, 1)}` : '—'}</td>
                          <td className="num">{isNum(r.pe) ? fmtNum(r.pe, 1) : '—'}</td>
                          <td>
                            <span className="scorebar num">
                              <span className="bar"><b style={{ width: `${r.score}%` }} /></span>
                              {fmtInt(r.score)}
                            </span>
                          </td>
                          <td className="num">{fmtInt(r.riskMonth)}</td>
                          <td className="reasons">
                            {r.flags.map((f) => (
                              <span className="flag" key={f}>{f}</span>
                            ))}
                            {r.reasons.join('؛ ')}
                          </td>
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
