'use client';
import { useState } from 'react';
import { HORIZONS, RISK_LEVEL_LABEL, riskLevel } from '@/lib/engine/risk';
import { fmtInt, fmtPct, fmtPrice } from '@/lib/num';
import type { AssetRisk, HorizonKey } from '@/lib/types';
import PositionSizer from '../PositionSizer';
import { WithSnapshot } from '../SnapshotProvider';
import { Chips, FilterBar, PageHead, Select, Toggle } from '../ui';

type Mode = 'buy' | 'hold' | 'sell';
type Group = 'all' | 'fx' | 'gold' | 'crypto' | 'tse';
const MODE_LABEL: Record<Mode, string> = { buy: 'ریسک خرید', hold: 'ریسک نگهداری', sell: 'ریسک فروش' };
const MODE_HELP: Record<Mode, string> = {
  buy: 'اگر امروز بخرید، احتمال افت، گران‌بودن نسبت به میانگین و افت‌های اخیر چقدر است.',
  hold: 'اگر دارایی را نگه دارید، احتمال افتِ بیش از حد معمول آن افق چقدر است.',
  sell: 'اگر امروز بفروشید، احتمال جاماندن از رشد چقدر است.',
};
const GROUP_OF: Record<string, Group> = { usd: 'fx', usdt: 'fx', g18: 'gold', coin: 'gold', ons: 'gold', btc: 'crypto', eth: 'crypto', tse: 'tse' };
const LEVEL_CLASS = ['lv0', 'lv1', 'lv2', 'lv3', 'lv4'] as const;
const UNIT: Record<string, string> = { toman: 'تومان', usd: 'دلار', point: 'واحد' };
const SIGNAL: Record<string, string> = { 'entry-low': 'شرایط ورود نسبتاً کم‌ریسک', 'entry-high': 'ورود پرریسک', neutral: 'بدون سیگنال مشخص' };

function Matrix({ assets, mode, onlyHigh, sel, setSel }: { assets: AssetRisk[]; mode: Mode; onlyHigh: boolean; sel: { key: string; h: HorizonKey } | null; setSel: (s: { key: string; h: HorizonKey }) => void }) {
  return (
    <div className="panel table-scroll">
      <table className="t matrix sticky-first">
        <thead>
          <tr>
            <th scope="col">دارایی</th>
            {HORIZONS.map((h) => (
              <th scope="col" key={h.key}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.key}>
              <th scope="row" className="sym">
                {a.label}
                <small>{a.points ? `${fmtInt(a.points)} روز، ${a.basis ?? ''}` : 'بدون تاریخچه'}</small>
              </th>
              {HORIZONS.map((h) => {
                const r = a.horizons[h.key];
                if (!r)
                  return (
                    <td key={h.key}>
                      <span className="rc na">داده کم</span>
                    </td>
                  );
                const v = r[mode];
                const lv = riskLevel(v);
                const dim = onlyHigh && v < 60;
                return (
                  <td key={h.key}>
                    <button
                      className={`rc num ${LEVEL_CLASS[lv]} ${r.confidence < 0.6 ? 'lowconf' : ''} ${dim ? 'dim' : ''}`}
                      aria-pressed={sel?.key === a.key && sel?.h === h.key}
                      aria-label={`${a.label}، ${h.label}، ${MODE_LABEL[mode]} ${v}`}
                      onClick={() => setSel({ key: a.key, h: h.key })}
                    >
                      {fmtInt(v)}
                      <small>{RISK_LEVEL_LABEL[lv]}</small>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RiskView() {
  const [mode, setMode] = useState<Mode>('buy');
  const [group, setGroup] = useState<Group>('all');
  const [sortH, setSortH] = useState<'none' | HorizonKey>('none');
  const [onlyHigh, setOnlyHigh] = useState(false);
  const [sel, setSel] = useState<{ key: string; h: HorizonKey } | null>({ key: 'tse', h: 'm1' });

  return (
    <div className="wrap">
      <PageHead title="ریسک در شش افق زمانی">صفر یعنی کم‌ریسک و صد یعنی پرریسک. {MODE_HELP[mode]} روی هر خانه بزنید تا جزئیات و بازه محتمل قیمت را ببینید.</PageHead>
      <WithSnapshot>
        {(snap) => {
          let assets = snap.risk.filter((r) => !r.hidden && (group === 'all' || GROUP_OF[r.key] === group));
          if (sortH !== 'none') assets = [...assets].sort((x, y) => (x.horizons[sortH]?.[mode] ?? 999) - (y.horizons[sortH]?.[mode] ?? 999));
          const selAsset = snap.risk.find((a) => a.key === sel?.key);
          const selRisk = selAsset && sel ? selAsset.horizons[sel.h] : null;
          const selH = HORIZONS.find((h) => h.key === sel?.h);
          const thin = snap.risk.filter((r) => !r.hidden && r.points < 21);
          return (
            <>
              <FilterBar>
                <Chips label="نوع ریسک" value={mode} onChange={setMode} options={(Object.keys(MODE_LABEL) as Mode[]).map((m) => ({ key: m, label: MODE_LABEL[m] }))} />
                <Chips
                  label="گروه"
                  value={group}
                  onChange={setGroup}
                  options={[
                    { key: 'all', label: 'همه' },
                    { key: 'tse', label: 'بورس' },
                    { key: 'fx', label: 'ارز' },
                    { key: 'gold', label: 'طلا' },
                    { key: 'crypto', label: 'کریپتو' },
                  ]}
                />
                <Select label="مرتب‌سازی" value={sortH} onChange={setSortH} options={[{ key: 'none', label: 'ترتیب پیش‌فرض' }, ...HORIZONS.map((h) => ({ key: h.key, label: `کم‌ریسک‌ترین در افق ${h.label}` }))]} />
                <Toggle checked={onlyHigh} onChange={setOnlyHigh}>
                  فقط خانه‌های پرریسک (۶۰+)
                </Toggle>
              </FilterBar>
              {thin.length ? (
                <p className="banner">
                  تاریخچه {thin.map((t) => t.label).join('، ')} هنوز کمتر از ۲۰ روز است. وضعیت منابع تاریخچه را در صفحه «ربات و منابع» ببینید.
                </p>
              ) : null}
              <Matrix assets={assets} mode={mode} onlyHigh={onlyHigh} sel={sel} setSel={setSel} />
              <div className="legend">
                {RISK_LEVEL_LABEL.map((l, i) => (
                  <span key={l}>
                    <i className={LEVEL_CLASS[i]} /> {l}
                  </span>
                ))}
                <span>
                  <i className="lv2 lowconf" /> داده کم، اعتماد پایین
                </span>
              </div>
              {selAsset && selRisk && selH ? (
                <section className="panel detail" aria-live="polite">
                  <h2>
                    {selAsset.label}، افق {selH.label}: {SIGNAL[selRisk.signal]}
                  </h2>
                  <dl>
                    <div>
                      <dt>خرید / نگهداری / فروش</dt>
                      <dd className="num">
                        {fmtInt(selRisk.buy)} / {fmtInt(selRisk.hold)} / {fmtInt(selRisk.sell)}
                      </dd>
                    </div>
                    <div>
                      <dt>احتمال افت بیش از {fmtPct(selH.k * 100, 0, false)}</dt>
                      <dd className="num">{fmtPct(selRisk.pDown * 100, 0, false)}</dd>
                    </div>
                    <div>
                      <dt>احتمال رشد بیش از {fmtPct(selH.k * 100, 0, false)}</dt>
                      <dd className="num">{fmtPct(selRisk.pUp * 100, 0, false)}</dd>
                    </div>
                    <div className="wide">
                      <dt>بازه محتمل (۸۰٪)، {UNIT[selAsset.unit]}</dt>
                      <dd className="num">
                        <bdi>{fmtPrice(selRisk.rangeLow)}</bdi> تا <bdi>{fmtPrice(selRisk.rangeHigh)}</bdi>
                      </dd>
                    </div>
                    <div>
                      <dt>نوسان سالانه</dt>
                      <dd className="num">{fmtPct(selAsset.annualVolPct, 0, false)}</dd>
                    </div>
                    <div>
                      <dt>اعتماد به داده</dt>
                      <dd className="num">{fmtPct(selRisk.confidence * 100, 0, false)}</dd>
                    </div>
                  </dl>
                </section>
              ) : null}
              <PositionSizer assets={snap.risk} />
            </>
          );
        }}
      </WithSnapshot>
    </div>
  );
}
