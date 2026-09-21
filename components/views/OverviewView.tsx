'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { HORIZONS, riskLevel } from '@/lib/engine/risk';
import { fmtInt, fmtPct, fmtPrice, isNum } from '@/lib/num';
import type { Snapshot } from '@/lib/types';
import { WithSnapshot } from '../SnapshotProvider';
import RollingNumber from '../RollingNumber';
import Sparkline from '../Sparkline';
import { Pct } from '../ui';

const UNIT: Record<string, string> = { toman: 'تومان', usd: 'دلار', point: 'واحد' };
/** The three rates people actually open this page for — given the large treatment, first row. */
const LEAD = new Set(['usd', 'coin', 'g18']);
/** Board reading order: the lead trio, then the rest as listed, with not-yet-priced rows last
 *  so a missing feed leaves a gap at the end instead of a hole in the middle. */
const ORDER = ['usd', 'coin', 'g18', 'usdt', 'nim', 'rob', 'silver', 'ons', 'silverOns', 'tse', 'btc', 'eth', 'oilBrent', 'dxy'];
function boardOrder(items: Snapshot['live']['items']) {
  const rank = (k: string) => (ORDER.indexOf(k) < 0 ? ORDER.length : ORDER.indexOf(k));
  return [...items].sort((a, b) => {
    const aDead = !isNum(a.price) ? 1 : 0;
    const bDead = !isNum(b.price) ? 1 : 0;
    return aDead - bDead || rank(a.key) - rank(b.key);
  });
}

function Board({ snap }: { snap: Snapshot }) {
  const prev = useRef<Record<string, number | null>>({});
  const [flash, setFlash] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const it of snap.live.items) {
      const before = prev.current[it.key];
      if (isNum(before) && isNum(it.price) && before !== it.price) next[it.key] = it.price > before ? 'flash-up' : 'flash-down';
      prev.current[it.key] = it.price;
    }
    if (Object.keys(next).length) {
      setFlash(next);
      const t = setTimeout(() => setFlash({}), 900);
      return () => clearTimeout(t);
    }
  }, [snap]);
  return (
    <section className="board" aria-label="قیمت‌های لحظه‌ای">
      <div className="wrap">
        <div className="board-grid">
          {boardOrder(snap.live.items).map((it) => {
            const dir = !isNum(it.changePct) || it.changePct === 0 ? '' : it.changePct > 0 ? 'up' : 'down';
            const dead = !isNum(it.price);
            return (
            <Link
              href={`/charts?asset=${it.key}`}
              className={`rate${LEAD.has(it.key) ? ' lead' : ''}${dead ? ' dead' : ''}`}
              key={it.key}
            >
              <span className="rate-label">{it.label}</span>
              <span className={`rate-price num ${flash[it.key] ?? ''}`}>
                {dead ? <span className="rate-wait">در انتظار داده</span> : <RollingNumber text={fmtPrice(it.price)} />}
                {dead ? null : <small>{UNIT[it.unit]}</small>}
              </span>
              <span className="rate-meta">
                <span className={`rate-chg num ${dir}`}>
                  {isNum(it.changePct) ? `${it.changePct > 0 ? '▲' : it.changePct < 0 ? '▼' : ''} ${fmtPct(it.changePct)}` : ''}
                </span>
                {it.spark?.length ? (
                  <span className="rate-spark">
                    <Sparkline
                      data={it.spark}
                      width={LEAD.has(it.key) ? 110 : 76}
                      height={22}
                      label="روند سه ماه اخیر"
                      color="rgba(190, 208, 240, 0.75)"
                    />
                  </span>
                ) : null}
                <span className="rate-note">{it.note ?? ''}</span>
              </span>
            </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Digest({ snap }: { snap: Snapshot }) {
  const core = snap.scenarios.assets.filter((a) => a.group !== 'alt' && a.rows.m1);
  const maxAbs = Math.max(1, ...core.map((a) => Math.max(-a.rows.m1!.worstPct, a.rows.m1!.bestPct)));
  const alerts = snap.risk
    .filter((a) => !a.hidden)
    .flatMap((a) => HORIZONS.slice(0, 3).map((h) => ({ a, h, r: a.horizons[h.key] })))
    .filter((x) => x.r && x.r.buy >= 65)
    .sort((x, y) => y.r!.buy - x.r!.buy)
    .slice(0, 5);
  return (
    <div className="wrap digest">
      <section className="panel pad digest-scn">
        <header className="digest-head">
          <h2>یک ماه آینده: بدترین و بهترین حالت</h2>
          <Link href="/scenarios">همه افق‌ها و دلایل</Link>
        </header>
        <ul className="mini-ladder">
          {core.map((a) => {
            const r = a.rows.m1!;
            return (
              <li key={a.key}>
                <span className="ml-name">{a.label}</span>
                <span className="ml-val down num">{fmtPct(r.worstPct, 0)}</span>
                <span className="ml-bar" dir="ltr" aria-hidden="true">
                  <span className="wing loss" style={{ right: '50%', width: `${(-r.worstPct / maxAbs) * 50}%` }} />
                  <span className="wing gain" style={{ left: '50%', width: `${(r.bestPct / maxAbs) * 50}%` }} />
                  <span className="zero" />
                </span>
                <span className="ml-val up num">{fmtPct(r.bestPct, 0)}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel pad">
        <header className="digest-head">
          <h2>ریسک خرید بالا در کوتاه‌مدت</h2>
          <Link href="/risk">جدول کامل ریسک</Link>
        </header>
        {alerts.length ? (
          <ul className="list">
            {alerts.map(({ a, h, r }) => (
              <li key={`${a.key}-${h.key}`}>
                <span>
                  {a.label}، {h.label}
                </span>
                <span className={`rc-inline lv${riskLevel(r!.buy)} num`}>{fmtInt(r!.buy)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">در افق‌های روزانه تا ماهانه، هیچ دارایی ریسک خرید بالای ۶۵ ندارد.</p>
        )}
      </section>

      <section className="panel pad">
        <header className="digest-head">
          <h2>سهم‌های برتر ماه</h2>
          <Link href="/stocks">همه نمادها</Link>
        </header>
        {snap.stocks.rows.length ? (
          <ol className="list">
            {snap.stocks.rows.slice(0, 5).map((r) => (
              <li key={r.symbol}>
                <span>
                  <b>{r.symbol}</b> <small className="muted">{r.name}</small>
                </span>
                <Pct v={r.r20 ?? r.chgToday} digits={0} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">{snap.stocks.note}</p>
        )}
      </section>

      <section className="panel pad">
        <header className="digest-head">
          <h2>کوین‌های برتر هفته</h2>
          <Link href="/crypto">همه کوین‌ها</Link>
        </header>
        <ol className="list">
          {snap.crypto.coins.slice(0, 5).map((c) => (
            <li key={c.id}>
              <span>
                <b>{c.symbol}</b> <small className="muted">{c.name}</small>
              </span>
              <Pct v={c.m7} digits={0} />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function OverviewView() {
  return (
    <WithSnapshot>
      {(snap) => (
        <>
          <Board snap={snap} />
          <Digest snap={snap} />
        </>
      )}
    </WithSnapshot>
  );
}
