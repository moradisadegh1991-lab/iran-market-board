'use client';
// «سرمایه‌ها» (rule 98): the assets as a portfolio — a total with the profit over what was paid, one card per kind
// (all the gold bought on different days is one card), and inside a card every purchase with its own profit.
// The grouping and the figures are lib/finance/asset-groups.ts; the total is netWorth's, so it matches every other page.
import { useCallback, useEffect, useState } from 'react';
import { netWorth, unitPrice } from '@/lib/finance/calc';
import { assetPerformance, portfolioPerformance, type AssetPerf } from '@/lib/finance/performance';
import { CPI_SOURCE } from '@/lib/finance/inflation';
import { groupAssets, SORT_LABEL, sortGroups, summarizeAssets, type AssetGroup, type AssetLot, type AssetSort } from '@/lib/finance/asset-groups';
import type { FinanceData, MarketKey } from '@/lib/finance/model';
import { Glyph, AssetIcon } from '../../icons';
import { Empty, Pct, PageHead, Select } from '../../ui';
import { useFinance, WithBook } from '../FinanceProvider';
import { AssetEdit, AssetForm, PerfLine, priceOn, usdFa } from '../asset-parts';
import { Card, confirmDelete, fmtDateFa, fmtPctFa, Modal, Money } from '../kit';

const fa = (n: number, d = 6) => n.toLocaleString('fa-IR', { maximumFractionDigits: d });

/** profit as the cards show it: an arrow, the amount, red or green; «نامشخص» when there is no cost to compare with */
function Profit({ rial }: { rial: number | null }) {
  if (rial === null) return <span className="asset-profit muted">سود نامشخص</span>;
  const up = rial >= 0;
  const A = up ? Glyph.Up : Glyph.Down;
  return (
    <span className={`asset-profit ${up ? 'up' : 'down'}`}>
      <A size={14} strokeWidth={2.4} aria-hidden="true" />
      <Money rial={Math.abs(rial)} />
    </span>
  );
}

function Hero({ s }: { s: ReturnType<typeof summarizeAssets> }) {
  const up = (s.profitRial ?? 0) >= 0;
  return (
    <section className="asset-hero" data-testid="assets-hero" aria-label="خلاصه سرمایه‌ها">
      <div className="asset-hero-row">
        <span className="asset-hero-label">مجموع سرمایه‌ها</span>
        <b className="asset-hero-val" data-testid="assets-total">
          <Money rial={s.totalRial} />
        </b>
      </div>
      <div className="asset-hero-row">
        <span className="asset-hero-label">سود شما</span>
        {s.profitRial !== null ? (
          <b className="asset-hero-val" data-testid="assets-profit">
            <Money rial={s.profitRial} signed />
            {s.profitPct !== null ? (
              <span className={`asset-pill ${up ? 'up' : 'down'}`}>
                {up ? <Glyph.Up size={14} strokeWidth={2.6} aria-hidden="true" /> : <Glyph.Down size={14} strokeWidth={2.6} aria-hidden="true" />}
                <Pct v={s.profitPct} digits={1} />
              </span>
            ) : null}
          </b>
        ) : (
          <span className="asset-hero-note" data-testid="assets-profit">برای دیدن سود، تاریخ و مبلغ خرید را بنویسید.</span>
        )}
      </div>
      {s.profitRial !== null && s.costedLots < s.lots ? (
        <p className="asset-hero-foot">سود فقط برای {fa(s.costedLots, 0)} خریدِ دارای مبلغ، از {fa(s.lots, 0)} خرید حساب شده است.</p>
      ) : null}
    </section>
  );
}

/** the card of one kind; a button on the list, plain at the top of its own page */
function GroupCard({ g, onOpen }: { g: AssetGroup; onOpen?: () => void }) {
  const body = (
    <>
      <AssetIcon id={g.kind === 'market' ? g.id : 'manual'} />
      <span className="asset-main">
        <b>{g.label}</b>
        <small>
          {g.qty !== null ? `${fa(g.qty)} ${g.unit}` : `${fa(g.lots.length, 0)} مورد`}
          {g.qty !== null && g.lots.length > 1 ? ` — ${fa(g.lots.length, 0)} خرید` : ''}
        </small>
      </span>
      <span className="asset-nums">
        {g.unpricedLots && !g.valueRial ? <span className="asset-profit muted">قیمت در دسترس نیست</span> : <Money rial={g.valueRial} />}
        <Profit rial={g.profitRial} />
      </span>
      {onOpen ? <Glyph.Chevron className="asset-chev" size={20} strokeWidth={2.2} aria-hidden="true" /> : null}
    </>
  );
  return onOpen ? (
    <button className="asset-card" onClick={onOpen} data-testid={`asset-card-${g.id}`} aria-label={`${g.label}، باز کردن`}>
      {body}
    </button>
  ) : (
    <div className="asset-card static" data-testid="asset-group-head">
      {body}
    </div>
  );
}

function Lot({ g, lot, perf, d, open, editing, onToggle, onEdit }: { g: AssetGroup; lot: AssetLot; perf: AssetPerf | null; d: FinanceData; open: boolean; editing: boolean; onToggle: () => void; onEdit: (on: boolean) => void }) {
  const { update } = useFinance();
  const manual = g.kind === 'manual';
  return (
    <li className="asset-lot" data-testid="asset-lot">
      <button className="asset-lot-row" onClick={onToggle} aria-expanded={open}>
        <span className="asset-main">
          <b>{manual ? lot.name : `${fa(lot.qty ?? 0)} ${g.unit}`}</b>
          <small>{lot.boughtOn ? fmtDateFa(lot.boughtOn) : manual ? (lot.asset.liquid ? 'قابل نقد شدن سریع' : 'غیرنقد') : 'تاریخ خرید نوشته نشده'}</small>
        </span>
        <span className="asset-nums">
          {lot.valueRial === null ? <span className="asset-profit muted">قیمت در دسترس نیست</span> : <Money rial={lot.valueRial} />}
          <Profit rial={lot.profitRial} />
        </span>
      </button>
      {open ? (
        <div className="asset-lot-more">
          {lot.costRial ? (
            <p className="muted small">
              خرید <Money rial={lot.costRial} />
              {lot.boughtOn ? ` در ${fmtDateFa(lot.boughtOn)}` : ''}
              {lot.profitPct !== null ? <> — <b className={lot.profitPct >= 0 ? 'up' : 'down'}>{fmtPctFa(lot.profitPct, 1)}</b></> : null}
            </p>
          ) : (
            <p className="muted small">مبلغ و تاریخ خرید ثبت نشده؛ با «ویرایش» بنویسید تا سود، مقایسه با دلار و تورم حساب شود.</p>
          )}
          {lot.asOf ? <p className="muted small">بازار بسته است؛ با آخرین قیمت ثبت‌شده ({fmtDateFa(lot.asOf)}) حساب شده.</p> : null}
          {perf ? <PerfLine p={perf} /> : null}
          {editing ? (
            <AssetEdit d={d} id={lot.id} onDone={() => onEdit(false)} />
          ) : (
            <div className="fin-actions">
              <button className="fin-mini" onClick={() => onEdit(true)} data-testid="asset-edit">ویرایش</button>
              <button
                className="fin-mini ghost"
                onClick={() => confirmDelete(`«${manual ? lot.name : `${fa(lot.qty ?? 0)} ${g.unit} ${g.label}`}»`) && update((dr) => void (dr.assets = dr.assets.filter((x) => x.id !== lot.id)))}
              >
                حذف
              </button>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

function Page({ d }: { d: FinanceData }) {
  const { update, today, items } = useFinance();
  const nw = netWorth(d, items, today);
  const groups = groupAssets(d, nw, items);
  const summary = summarizeAssets(groups);
  const [sort, setSort] = useState<AssetSort>('value');
  const [gid, setGid] = useState<string | null>(null);
  const [openLot, setOpenLot] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const closeAdd = useCallback(() => setAdding(false), []);
  const g = gid ? groups.find((x) => x.id === gid) ?? null : null;

  // the last purchase of a kind was deleted: back to the list
  useEffect(() => {
    if (gid && !g) setGid(null);
  }, [gid, g]);

  const usdNow = unitPrice('usd', items)?.rial ?? null;
  const perf = new Map<string, AssetPerf>();
  for (const a of d.assets) {
    const p = assetPerformance(a, nw.byAsset.find((x) => x.id === a.id)?.rial ?? null, usdNow, today, d.settings.inflationPct);
    if (p) perf.set(a.id, p);
  }
  const total = portfolioPerformance([...perf.values()]);

  // the dollar on each purchase day: looked up once and kept on the asset (it never changes)
  const missing = d.assets.filter((a) => a.boughtOn && a.costRial && a.usdAtBuyFor !== a.boughtOn);
  const want = [...new Set(missing.map((a) => a.boughtOn!))].sort().join(',');
  useEffect(() => {
    if (!want) return;
    let live = true;
    void priceOn('usd', want.split(','))
      .then((r) => {
        if (!live) return;
        update((dr) => {
          for (const a of dr.assets) {
            if (!a.boughtOn || !a.costRial || a.usdAtBuyFor === a.boughtOn) continue;
            const c = r.prices[a.boughtOn];
            if (c === undefined) continue;
            a.usdRialAtBuy = c ? c.value : null;
            a.usdAtBuyFor = a.boughtOn;
          }
        });
      })
      .catch(() => {
        // offline: next time
      });
    return () => {
      live = false;
    };
  }, [want, update]);

  const sorted = sortGroups(groups, sort);
  const addKey: MarketKey | null = g?.kind === 'market' ? g.key : null;

  return (
    <>
      {g ? (
        <>
          <div className="asset-top">
            <button
              className="asset-back"
              onClick={() => {
                setGid(null);
                setOpenLot(null);
                setEditing(null);
              }}
              data-testid="asset-back"
            >
              <Glyph.Back size={20} strokeWidth={2.2} aria-hidden="true" />
              سرمایه‌ها
            </button>
            <h1>{g.label}</h1>
          </div>
          <GroupCard g={g} />
          {g.kind === 'market' ? (
            <p className="asset-unit" data-testid="asset-unit-price">
              {g.unitPriceRial ? (
                <>
                  قیمت هر {g.unit}: <Money rial={g.unitPriceRial} />
                  {g.asOf ? <small> (آخرین قیمت، {fmtDateFa(g.asOf)})</small> : null}
                </>
              ) : (
                'قیمت این دارایی الان در دسترس نیست.'
              )}
            </p>
          ) : null}
          {g.costedLots < g.lots.length ? (
            <p className="note">سود فقط برای {fa(g.costedLots, 0)} خریدِ دارای مبلغ، از {fa(g.lots.length, 0)} خرید حساب شده؛ بقیه را با «ویرایش» کامل کنید.</p>
          ) : null}
          <ul className="asset-lots">
            {g.lots.map((l) => (
              <Lot
                key={l.id}
                g={g}
                lot={l}
                perf={perf.get(l.id) ?? null}
                d={d}
                open={openLot === l.id}
                editing={editing === l.id}
                onToggle={() => setOpenLot(openLot === l.id ? null : l.id)}
                onEdit={(on) => setEditing(on ? l.id : null)}
              />
            ))}
          </ul>
        </>
      ) : (
        <>
          <PageHead title="سرمایه‌ها">طلا، سکه، ارز، کریپتو و دارایی‌های دیگرتان — هر خرید با سود یا زیان خودش، و مقایسه با دلار و تورم.</PageHead>
          <Hero s={summary} />
          {nw.unpriced.length ? <p className="banner warn">قیمت این موارد در دسترس نیست و در جمع حساب نشده‌اند: {nw.unpriced.join('، ')}</p> : null}
          {nw.lastPriced.length ? (
            <p className="banner info">
              بازار بسته است (جمعه یا تعطیل) یا قیمت لحظه‌ای نرسید؛ این دارایی‌ها با آخرین قیمت ثبت‌شده حساب شده‌اند: {[...new Map(nw.lastPriced.map((x) => [x.name, x])).values()].map((x) => `${x.name} (${fmtDateFa(x.asOf)})`).join('، ')}
            </p>
          ) : null}
          <div className="asset-list-head">
            <h2>سرمایه‌های من</h2>
            {groups.length > 1 ? (
              <Select<AssetSort> label="مرتب‌سازی" value={sort} onChange={setSort} options={(Object.keys(SORT_LABEL) as AssetSort[]).map((k) => ({ key: k, label: SORT_LABEL[k] }))} />
            ) : null}
          </div>
          {sorted.length ? (
            <div className="asset-cards">
              {sorted.map((x) => (
                <GroupCard key={x.id} g={x} onOpen={() => setGid(x.id)} />
              ))}
            </div>
          ) : (
            <Empty art="wallet">طلا، سکه، ارز، کریپتو، خودرو، ودیعه رهن یا سهام را با دکمه «+» اضافه کنید.</Empty>
          )}
          {total ? (
            <Card title="از روز خرید تا امروز" className="asset-perf-card">
              <div className="asset-perf-total" data-testid="asset-perf-total">
                <b>{total.count.toLocaleString('fa-IR')} دارایی با تاریخ و مبلغ خرید</b>
                <span>
                  خرید <Money rial={total.costRial} short />، امروز <Money rial={total.valueRial} short /> ← <b className={total.growthPct >= 0 ? 'up' : 'down'}>{fmtPctFa(total.growthPct, 1)}</b>
                </span>
                {total.usdGrowthPct != null ? (
                  <span>
                    به دلار هر روز: {usdFa(total.costUsd!)} ← {usdFa(total.valueUsd!)} (<b className={total.usdGrowthPct >= 0 ? 'up' : 'down'}>{fmtPctFa(total.usdGrowthPct, 1)}</b>)
                  </span>
                ) : null}
                {total.realPct != null ? (
                  <span>
                    بعد از تورم: <b className={total.realPct >= 0 ? 'up' : 'down'}>{fmtPctFa(total.realPct, 1)}</b> — یعنی قدرت خریدش {total.realPct >= 0 ? 'بیشتر' : 'کمتر'} شده.
                  </span>
                ) : null}
                <small className="muted">
                  تورم از {CPI_SOURCE}؛ * بعد از آن با تورم سالانه {d.settings.inflationPct.toLocaleString('fa-IR')}٪ تنظیمات. دلار: نرخ بازار آزاد روز خرید (یا آخرین روز کاری قبلش). گذشته وعده آینده
                  نیست.
                </small>
              </div>
            </Card>
          ) : null}
          <details className="method asset-nw">
            <summary>دارایی خالص از چه چیزهایی ساخته شده؟</summary>
            <dl className="fin-kpis tight">
              <div className="fin-stat"><dt>دارایی خالص</dt><dd><Money rial={nw.netRial} short /></dd></div>
              <div className="fin-stat"><dt>حساب‌ها و کارت‌ها</dt><dd><Money rial={nw.cashRial} short /></dd></div>
              <div className="fin-stat"><dt>طلا، ارز، کریپتو</dt><dd><Money rial={nw.marketRial} short /></dd></div>
              <div className="fin-stat"><dt>سایر دارایی‌ها</dt><dd><Money rial={nw.manualRial} short /></dd></div>
              <div className="fin-stat"><dt>طلب − بدهی</dt><dd><Money rial={nw.receivableRial - nw.debtRial} short signed /></dd></div>
            </dl>
          </details>
        </>
      )}

      <div className="asset-spacer" aria-hidden="true" />
      <button className="asset-fab" onClick={() => setAdding(true)} aria-label="سرمایه تازه" data-testid="asset-fab">
        <Glyph.Plus size={28} strokeWidth={2.4} aria-hidden="true" />
      </button>
      {adding ? (
        <Modal title={g ? `خرید تازه — ${g.label}` : 'سرمایه تازه'} onClose={closeAdd}>
          <AssetForm
            initialKey={addKey}
            initialMode={g?.kind === 'manual' ? 'manual' : 'market'}
            onDone={closeAdd}
            onAdded={(id) => {
              setGid(id);
              setOpenLot(null);
            }}
          />
        </Modal>
      ) : null}
    </>
  );
}

export default function AssetsView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Page d={d} />}</WithBook>
    </div>
  );
}
