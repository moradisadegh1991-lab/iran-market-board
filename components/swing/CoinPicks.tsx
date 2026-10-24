'use client';
// «ارزهای پیشنهادی» (rule 96): the calmest liquid coins for the trend rider, with what the rule did on real
// data next to it. Used on the swing page (fill the basket / start my session) and the futures page.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fmtDateTimeFa, fmtInt, isNum } from '@/lib/num';
import type { PickRow, PICK_EVIDENCE } from '@/lib/engine/coin-pick';
import { Pct } from '../ui';

export interface PicksReply {
  rows: PickRow[];
  picked: PickRow[];
  btcUp: boolean | null;
  asOf: number | null;
  stale?: boolean;
  rule: { k: number; minDays: number; minValue: number };
  evidence: typeof PICK_EVIDENCE;
  error?: string;
}

let cache: { at: number; data: PicksReply } | null = null;

export function usePicks(): { data: PicksReply | null; err: string | null } {
  const [data, setData] = useState<PicksReply | null>(cache?.data ?? null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (cache && Date.now() - cache.at < 30 * 60_000) return;
    let off = false;
    fetch(api('/api/coin-picks'))
      .then((r) => r.json())
      .then((j: PicksReply) => {
        if (j.error) throw new Error(j.error);
        cache = { at: Date.now(), data: j };
        if (!off) setData(j);
      })
      .catch((e) => !off && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      off = true;
    };
  }, []);
  return { data, err };
}

const money = (v: number | null) => (isNum(v) ? `${fmtInt(Math.round(v! / 1e6))} میلیون دلار` : '—');

export default function CoinPicks({ onUse, useLabel }: { onUse?: (rows: PickRow[]) => void; useLabel?: string }) {
  const { data, err } = usePicks();
  if (err) return <section className="panel pad"><h2>ارزهای پیشنهادی</h2><p className="empty">{err}</p></section>;
  if (!data) return <section className="panel pad" aria-busy="true"><h2>ارزهای پیشنهادی</h2><div className="skeleton picks-skel" /></section>;
  const e = data.evidence;
  const others = data.rows.filter((r) => r.eligible && !r.picked).slice(0, 5);
  return (
    <section className="panel pad picks" data-testid="coin-picks">
      <h2>ارزهای پیشنهادی برای روندسوار</h2>
      <p className="lede">
        از میان {fmtInt(data.rows.length)} ارز پرمعامله، {fmtInt(data.rule.k)} ارز <b>آرام‌تر</b> (کمترین نوسان ۲۰ روز اخیر) — قاعده‌ای که روی داده واقعی، هم در سال‌های طراحی و هم در سال‌های
        آزمون، از معامله روی همه ارزها بهتر بود. انتخاب برندگان اخیر بهتر نبود. این فهرست هر ۶ ساعت از قیمت‌های روزانه بایننس دوباره ساخته می‌شود.
      </p>
      <ol className="pick-list">
        {data.picked.map((r) => (
          <li key={r.sym} className="pick" data-testid={`pick-${r.sym}`}>
            <span className="pick-sym">{r.sym}</span>
            <span className="pick-name">{r.name}</span>
            <span className="pick-vol">نوسان سالانه <span className="num">{fmtInt(Math.round(r.vol20Pct ?? 0))}٪</span></span>
            <span className={`state-pill ${r.holdNow ? 'ok' : 'warn'}`}>{r.holdNow ? 'روندسوار الان نگه می‌دارد' : 'الان بیرون است (زیر میانگین ۵۰ روزه)'}</span>
          </li>
        ))}
      </ol>
      {data.btcUp === false ? <p className="note">بیت‌کوین زیر میانگین ۵۰ روزه خودش است؛ روندسوار تا برگشتن آن، هیچ ارز دیگری را نمی‌خرد.</p> : null}
      {onUse ? (
        <button className="btn run" onClick={() => onUse(data.picked)} data-testid="use-picks">
          {useLabel ?? 'همین‌ها را انتخاب کن'}
        </button>
      ) : null}
      <details className="method">
        <summary>چرا این‌ها؟ کارنامه قاعده انتخاب روی داده واقعی</summary>
        <div className="table-scroll">
          <table className="t compact">
            <caption>روندسوار روی سبد ارزها با هر قاعده انتخاب؛ بازده سالانه و بیشترین افت (دلاری، کارمزد ۰٫۴٪ هر طرف)</caption>
            <thead>
              <tr>
                <th scope="col">قاعده انتخاب</th>
                <th scope="col">طراحی {e.design}</th>
                <th scope="col">افت</th>
                <th scope="col">آزمون {e.test}</th>
                <th scope="col">افت</th>
              </tr>
            </thead>
            <tbody>
              {e.rows.map((r, i) => (
                <tr key={r.label} className={i === 1 ? 'sel' : ''}>
                  <th scope="row">{r.label}</th>
                  <td><Pct v={r.designCagr} digits={0} /></td>
                  <td><Pct v={r.designDd} digits={0} /></td>
                  <td><Pct v={r.testCagr} digits={0} /></td>
                  <td><Pct v={r.testDd} digits={0} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-scroll">
          <table className="t compact" data-testid="picks-aban">
            <caption>همان مطالعه با هزینه آبان‌تتر (حدود ۰٫۷۱٪ هر طرف)</caption>
            <thead>
              <tr>
                <th scope="col">قاعده انتخاب</th>
                <th scope="col">طراحی {e.design}</th>
                <th scope="col">افت</th>
                <th scope="col">آزمون {e.test}</th>
                <th scope="col">افت</th>
              </tr>
            </thead>
            <tbody>
              {e.aban.rows.map((r, i) => (
                <tr key={r.label} className={i === 1 ? 'sel' : ''}>
                  <th scope="row">{r.label}</th>
                  <td><Pct v={r.designCagr} digits={0} /></td>
                  <td><Pct v={r.designDd} digits={0} /></td>
                  <td><Pct v={r.testCagr} digits={0} /></td>
                  <td><Pct v={r.testDd} digits={0} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">{e.aban.note}</p>
        <p className="note">{e.years}</p>
        <p className="note">{e.rules}</p>
        <p className="note">{e.caveat}</p>
      </details>
      <details className="method">
        <summary>ارزهای بعدی در صف</summary>
        <div className="table-scroll">
          <table className="t compact">
            <thead>
              <tr>
                <th scope="col">رتبه</th>
                <th scope="col">ارز</th>
                <th scope="col">نوسان سالانه</th>
                <th scope="col">معامله روزانه</th>
                <th scope="col">روند</th>
              </tr>
            </thead>
            <tbody>
              {others.map((r) => (
                <tr key={r.sym}>
                  <td className="num">{fmtInt(r.rank ?? 0)}</td>
                  <th scope="row">{r.sym}</th>
                  <td className="num">{fmtInt(Math.round(r.vol20Pct ?? 0))}٪</td>
                  <td>{money(r.value90)}</td>
                  <td>{r.holdNow ? 'بالای میانگین' : 'زیر میانگین'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.asOf ? <p className="muted small">بر اساس روزهای بسته‌شده تا {fmtDateTimeFa(data.asOf + 86_400_000)}{data.stale ? ' (داده کمی کهنه است)' : ''}.</p> : null}
      </details>
    </section>
  );
}
