'use client';
import { useState } from 'react';
import { HORIZONS, RISK_LEVEL_LABEL, riskLevel } from '@/lib/engine/risk';
import { fmtDateTimeFa, fmtInt, fmtPct, fmtPrice } from '@/lib/num';
import type { AssetRisk, HorizonKey } from '@/lib/types';

type Mode = 'buy' | 'hold' | 'sell';
const MODE_LABEL: Record<Mode, string> = { buy: 'ریسک خرید', hold: 'ریسک نگهداری', sell: 'ریسک فروش' };
const MODE_HELP: Record<Mode, string> = {
  buy: 'احتمال افت پس از ورود، گران‌بودن نسبت به میانگین و افت‌های اخیر.',
  hold: 'احتمال افتِ بیش از آستانه هر افق در صورت نگهداری.',
  sell: 'احتمال جاماندن از رشد در صورت فروش امروز.',
};
const LEVEL_CLASS = ['lv0', 'lv1', 'lv2', 'lv3', 'lv4'] as const;
const UNIT: Record<string, string> = { toman: 'تومان', usd: 'دلار', point: 'واحد' };
const SIGNAL: Record<string, string> = { 'entry-low': 'شرایط ورود نسبتاً کم‌ریسک', 'entry-high': 'ورود پرریسک', neutral: 'خنثی' };

export default function RiskMatrix({ risk }: { risk: AssetRisk[] }) {
  const [mode, setMode] = useState<Mode>('buy');
  const [sel, setSel] = useState<{ key: string; h: HorizonKey } | null>({ key: 'g18', h: 'm1' });
  const visible = risk.filter((r) => !r.hidden);
  const selAsset = visible.find((a) => a.key === sel?.key);
  const selRisk = selAsset && sel ? selAsset.horizons[sel.h] : null;
  const selH = HORIZONS.find((h) => h.key === sel?.h);

  return (
    <section className="block" id="risk">
      <div className="wrap">
        <h2>ریسک بازارها در شش افق زمانی</h2>
        <p className="lede">عدد صفر یعنی کم‌ریسک و صد یعنی پرریسک. {MODE_HELP[mode]} روی هر خانه بزنید تا جزئیات و بازه محتمل قیمت را ببینید.</p>
        <div className="controls">
          <div className="seg" role="group" aria-label="نوع ریسک">
            {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
              <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
        <div className="surface table-scroll">
          <table className="t matrix">
            <thead>
              <tr>
                <th>دارایی</th>
                {HORIZONS.map((h) => (
                  <th key={h.key}>{h.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.key}>
                  <td className="sym">
                    {a.label}
                    <small className="num">{a.points ? `${fmtInt(a.points)} روز داده` : 'بدون داده'}</small>
                  </td>
                  {HORIZONS.map((h) => {
                    const r = a.horizons[h.key];
                    if (!r)
                      return (
                        <td className="cell" key={h.key}>
                          <button className="rc na" disabled aria-label={`${a.label} ${h.label}: داده کافی نیست`}>
                            داده کافی نیست
                          </button>
                        </td>
                      );
                    const v = r[mode];
                    const lv = riskLevel(v);
                    const pressed = sel?.key === a.key && sel?.h === h.key;
                    return (
                      <td className="cell" key={h.key}>
                        <button
                          className={`rc num ${LEVEL_CLASS[lv]} ${r.confidence < 0.6 ? 'lowconf' : ''}`}
                          aria-pressed={pressed}
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
        <div className="legend">
          {RISK_LEVEL_LABEL.map((l, i) => (
            <span key={l}>
              <i className={LEVEL_CLASS[i]} /> {l}
            </span>
          ))}
          <span>
            <i className="lv2 lowconf" /> داده کم؛ اعتماد پایین
          </span>
        </div>

        {selAsset && selRisk && selH ? (
          <div className="surface detail" aria-live="polite">
            <h3>
              {selAsset.label} · افق {selH.label} · {SIGNAL[selRisk.signal]}
            </h3>
            <div>
              <div className="k">خرید / نگهداری / فروش</div>
              <div className="v num">
                {fmtInt(selRisk.buy)} / {fmtInt(selRisk.hold)} / {fmtInt(selRisk.sell)}
              </div>
            </div>
            <div>
              <div className="k">احتمال افت بیش از {fmtPct(selH.k * 100, 0, false)}</div>
              <div className="v num">{fmtPct(selRisk.pDown * 100, 0, false)}</div>
            </div>
            <div>
              <div className="k">احتمال رشد بیش از {fmtPct(selH.k * 100, 0, false)}</div>
              <div className="v num">{fmtPct(selRisk.pUp * 100, 0, false)}</div>
            </div>
            <div className="wide">
              <div className="k">بازه محتمل (۸۰٪) — {UNIT[selAsset.unit]}</div>
              <div className="v num">
                <bdi>{fmtPrice(selRisk.rangeLow)}</bdi> تا <bdi>{fmtPrice(selRisk.rangeHigh)}</bdi>
              </div>
            </div>
            <div>
              <div className="k">نوسان سالانه تاریخی</div>
              <div className="v num">{fmtPct(selAsset.annualVolPct, 0, false)}</div>
            </div>
            <div>
              <div className="k">اعتماد به داده</div>
              <div className="v num">{fmtPct(selRisk.confidence * 100, 0, false)}</div>
            </div>
            <div>
              <div className="k">شروع تاریخچه</div>
              <div className="v num">{selAsset.firstDate ? fmtDateTimeFa(selAsset.firstDate).split('،')[0] : '—'}</div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
