'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { SCENARIO_HORIZONS } from '@/lib/engine/scenario';
import { fmtPct, fmtPrice, isNum } from '@/lib/num';
import type { AssetScenario, HorizonKey, ScenarioGroup, ScenarioRow } from '@/lib/types';
import { WithSnapshot } from '../SnapshotProvider';
import { Chips, FilterBar, MultiChips, PageHead } from '../ui';

const GROUP_LABEL: Record<ScenarioGroup, string> = { tse: 'بورس', fx: 'ارز', gold: 'طلا و سکه', crypto: 'بیت‌کوین', alt: 'آلت‌کوین' };
const GROUP_ORDER: ScenarioGroup[] = ['tse', 'fx', 'gold', 'crypto', 'alt'];
const UNIT: Record<string, string> = { toman: 'تومان', usd: 'دلار', point: 'واحد' };
const confLabel = (c: number) => (c >= 0.8 ? 'اعتماد زیاد' : c >= 0.5 ? 'اعتماد متوسط' : 'اعتماد کم');
const confClass = (c: number) => (c >= 0.8 ? 'hi' : c >= 0.5 ? 'mid' : 'lo');

function Ladder({ a, horizons, mode }: { a: AssetScenario; horizons: HorizonKey[]; mode: 'price' | 'pct' }) {
  const rows = horizons.map((h) => a.rows[h]).filter((r): r is ScenarioRow => !!r);
  // shared log-scale axis so +100% and −50% are drawn with equal visual weight
  const L = (pct: number) => Math.log(1 + pct / 100);
  const maxAbs = Math.max(0.01, ...rows.flatMap((r) => [Math.abs(L(r.worstPct)), Math.abs(L(r.bestPct))]));
  const pos = (pct: number) => 50 + (L(pct) / maxAbs) * 50;
  const val = (price: number, pct: number) => (mode === 'price' ? fmtPrice(price) : fmtPct(pct, 1));
  return (
    <div className="ladder" role="table" aria-label={`سناریوهای ${a.label}`}>
      <div className="ladder-head" role="row" aria-hidden="true">
        <span />
        <span className="down">بدترین (۵٪)</span>
        <span className="axis-label">امروز</span>
        <span className="up">بهترین (۹۵٪)</span>
      </div>
      {rows.map((r) => (
        <div className="rung" role="row" key={r.h} title={isNum(r.histWorstPct) ? `در تاریخچه: بدترین ${fmtPct(r.histWorstPct, 0)}، بهترین ${fmtPct(r.histBestPct, 0)}` : undefined}>
          <span className="rung-label" role="rowheader">
            {r.label}
            {r.confidence < 0.5 ? <i className="lowconf-dot" aria-label="اعتماد کم" /> : null}
          </span>
          <span className="rung-val down num" role="cell">
            {val(r.worst, r.worstPct)}
          </span>
          <span className="rung-bar" role="cell" aria-label={`بدترین ${fmtPct(r.worstPct, 1)}، میانه ${fmtPct(r.basePct, 1)}، بهترین ${fmtPct(r.bestPct, 1)}`}>
            <span className="track" dir="ltr">
              <span className="wing loss" style={{ left: `${pos(r.worstPct)}%`, width: `${50 - pos(r.worstPct)}%` }} />
              <span className="wing gain" style={{ left: '50%', width: `${pos(r.bestPct) - 50}%` }} />
              <span className="zero" />
              <span className="base-tick" style={{ left: `${pos(r.basePct)}%` }} />
            </span>
          </span>
          <span className="rung-val up num" role="cell">
            {val(r.best, r.bestPct)}
          </span>
        </div>
      ))}
    </div>
  );
}

function AssetCard({ a, horizons, mode, open }: { a: AssetScenario; horizons: HorizonKey[]; mode: 'price' | 'pct'; open: boolean }) {
  const m1 = a.rows.m1;
  const chartHref = a.group === 'alt' ? `/charts?asset=cg:${a.key.slice(4)}` : `/charts?asset=${a.key}`;
  return (
    <article className="scn" id={`s-${a.key.replace(':', '-')}`}>
      <header className="scn-head">
        <div>
          <h2>
            {a.label}
            {a.symbol ? <span className="sym-tag">{a.symbol}</span> : null}
          </h2>
          <p className="scn-price num">
            {fmtPrice(a.price)} <small>{UNIT[a.unit]}</small>
          </p>
        </div>
        <div className="scn-meta">
          {isNum(a.annualVolPct) ? <span className="tag">نوسان سالانه {fmtPct(a.annualVolPct, 0, false)}</span> : null}
          {m1 ? <span className={`tag conf ${confClass(m1.confidence)}`}>{confLabel(m1.confidence)}</span> : null}
          <Link className="tag link" href={chartHref}>
            نمودار
          </Link>
        </div>
      </header>
      {a.missingReason ? (
        <p className="empty">{a.missingReason} با ثبت روزانه قیمت، این بخش خودکار فعال می‌شود.</p>
      ) : (
        <>
          {a.summary ? <p className="scn-summary">{a.summary}</p> : null}
          <Ladder a={a} horizons={horizons} mode={mode} />
          <details className="why" open={open}>
            <summary>چرا این بازه؟</summary>
            <ul>
              {a.drivers.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </article>
  );
}

export default function ScenariosView() {
  const [group, setGroup] = useState<'all' | ScenarioGroup>('all');
  const [horizons, setHorizons] = useState<HorizonKey[]>(SCENARIO_HORIZONS.map((h) => h.key));
  const [mode, setMode] = useState<'price' | 'pct'>('price');

  return (
    <div className="wrap">
      <PageHead title="بدترین و بهترین سناریو">
        برای هر افق، بازه‌ای که قیمت با احتمال ۹۰٪ در آن می‌ماند: سمت چپ بدترین حالت، سمت راست بهترین حالت و خط تیره سناریوی میانه. زیر هر دارایی نوشته شده این بازه از چه عددهایی آمده است.
      </PageHead>
      <WithSnapshot>
        {(snap) => {
          const assets = [...snap.scenarios.assets].sort((x, y) => GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group));
          const counts = GROUP_ORDER.map((g) => ({ key: g, label: GROUP_LABEL[g], count: assets.filter((a) => a.group === g).length })).filter((o) => o.count);
          const visible = assets.filter((a) => group === 'all' || a.group === group);
          const ordered = SCENARIO_HORIZONS.filter((h) => horizons.includes(h.key)).map((h) => h.key);
          return (
            <>
              <FilterBar>
                <Chips label="گروه دارایی" value={group} onChange={setGroup} options={[{ key: 'all', label: 'همه', count: assets.length }, ...counts]} />
                <MultiChips label="افق زمانی" value={horizons} onChange={setHorizons} options={SCENARIO_HORIZONS.map((h) => ({ key: h.key, label: h.label }))} />
                <Chips label="نمایش" value={mode} onChange={setMode} options={[{ key: 'price', label: 'قیمت' }, { key: 'pct', label: 'درصد' }]} />
              </FilterBar>
              <div className="scn-list">
                {visible.map((a, i) => (
                  <AssetCard key={a.key} a={a} horizons={ordered} mode={mode} open={i === 0 || visible.length === 1} />
                ))}
              </div>
              <details className="method panel">
                <summary>روش محاسبه به زبان ساده</summary>
                <p>{snap.scenarios.note}</p>
                <ol>
                  <li>از تاریخچه روزانه قیمت، تغییرات روزانه و میزان نوسان محاسبه می‌شود. برای افق‌های کوتاه نوسان هفته‌های اخیر وزن بیشتری دارد و برای افق‌های بلند نوسان یک سال.</li>
                  <li>اگر بازار «دُم پهن» داشته باشد، یعنی جهش‌های ناگهانی بیش از توزیع نرمال رخ داده باشد، بازه با روش کورنیش-فیشر بازتر می‌شود.</li>
                  <li>اگر حرکت‌های روزانه ادامه‌دار باشند (مثل بورس تهران با دامنه نوسان)، نوسان افق‌های بلند بزرگ‌تر از جمع ساده نوسان روزانه در نظر گرفته می‌شود.</li>
                  <li>فقط نیمی از روند گذشته، با سقف مشخص، به آینده منتقل می‌شود؛ روند یک‌ساله پیش‌بینی‌کننده ضعیفی است.</li>
                  <li>اگر تاریخچه کافی باشد، بازه آماری با بدترین و بهترین تغییرات واقعی گذشته در همان طول زمان ترکیب می‌شود.</li>
                  <li>در افق‌های بلند، بدترین سناریو گاهی کم‌عمق‌تر از افق کوتاه‌تر است: روند تورمی دارایی‌های ریالی زمان بیشتری برای جبران افت دارد.</li>
                </ol>
              </details>
            </>
          );
        }}
      </WithSnapshot>
    </div>
  );
}
