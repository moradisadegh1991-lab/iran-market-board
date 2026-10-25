'use client';
// The Digikala search sheet (rule 103), shared by the shopping list and the goals (rule 105): searches from this device,
// lists what the site sells with today's price, and hands the picked product back. Nothing is picked on its own.
import { useEffect, useState } from 'react';
import { dkSearch } from '@/lib/digikala/client';
import { siteSearchLink, type DkProduct, type DkSort } from '@/lib/digikala/parse';
import { Glyph } from '../icons';
import { Modal, Money } from './kit';

const faN = (n: number) => n.toLocaleString('fa-IR');

/**
 * «قیمت در دیجی‌کالا» (rule 103): searches Digikala from this device for the item's name (editable), lists what the site
 * sells with today's price, and «انتخاب» makes that product's price the item's estimate. «خرید» opens the product on
 * Digikala (its app, if installed); the site's own search link works even where the API does not.
 */
export function DkPicker({ query, title, note, pickLabel = 'انتخاب برای تخمین', onPick, onClose }: { query: string; title: string; note?: React.ReactNode; pickLabel?: string; onPick: (p: DkProduct) => void; onClose: () => void }) {
  const [q, setQ] = useState(query);
  const [sort, setSort] = useState<DkSort>('relevant');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ products: DkProduct[]; total: number | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (query = q, s = sort) => {
    if (!query.trim()) return;
    setBusy(true);
    setErr(null);
    const r = await dkSearch(query, s);
    setBusy(false);
    if (r.ok) setRes(r.value!);
    else {
      setRes(null);
      setErr(r.error ?? 'جواب دیجی‌کالا خوانده نشد.');
    }
  };
  useEffect(() => {
    void run(query, 'relevant');
    // one search when the sheet opens; after that only on the user's tap
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="dk-search"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input className="fin-input" aria-label="جست‌وجو در دیجی‌کالا" value={q} onChange={(e) => setQ(e.target.value)} data-testid="dk-q" />
        <select
          className="fin-input"
          aria-label="ترتیب"
          value={sort}
          onChange={(e) => {
            const v = e.target.value as DkSort;
            setSort(v);
            void run(q, v);
          }}
        >
          <option value="relevant">مرتبط‌ترین</option>
          <option value="cheapest">ارزان‌ترین (موجود)</option>
        </select>
        <button className="fin-mini" type="submit" disabled={busy || !q.trim()} aria-label="جست‌وجو">
          <Glyph.Search size={16} aria-hidden="true" />
        </button>
      </form>
      <p className="muted small">
        نام کالا مستقیم از همین دستگاه به دیجی‌کالا فرستاده می‌شود؛ سرور «مالی من» آن را نمی‌بیند. قیمت‌ها همان قیمت امروز سایت‌اند و ممکن است عوض شوند.
        {note}
      </p>
      {busy ? (
        <p className="muted" role="status">
          در حال گرفتن قیمت از دیجی‌کالا…
        </p>
      ) : null}
      {err ? (
        <p className="fin-err" role="alert" data-testid="dk-err">
          {err}
        </p>
      ) : null}
      {res && !busy ? (
        res.products.length ? (
          <ul className="dk-list" data-testid="dk-results">
            {res.products.slice(0, 10).map((p) => (
              <li key={p.id} className={`dk-item${p.available ? '' : ' off'}`} data-testid="dk-item">
                {p.image ? <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="dk-noimg" aria-hidden="true" />}
                <div className="dk-main">
                  <span className="dk-title">{p.title}</span>
                  {p.priceRial ? (
                    <span className="dk-price">
                      <Money rial={p.priceRial} />
                      {p.discountPct && p.rrpRial ? (
                        <small>
                          {' '}
                          <s>
                            <Money rial={p.rrpRial} short />
                          </s>{' '}
                          ({faN(p.discountPct)}٪ تخفیف)
                        </small>
                      ) : null}
                    </span>
                  ) : (
                    <small className="muted">ناموجود</small>
                  )}
                  <span className="dk-acts">
                    {p.priceRial ? (
                      <button
                        className="fin-mini"
                        data-testid="dk-pick"
                        onClick={() => {
                          onPick(p);
                          onClose();
                        }}
                      >
                        {pickLabel}
                      </button>
                    ) : null}
                    <a className="fin-mini ghost" href={p.url} target="_blank" rel="noopener noreferrer" data-testid="dk-buy">
                      خرید در دیجی‌کالا <Glyph.External size={14} aria-hidden="true" />
                    </a>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">دیجی‌کالا برای «{q}» چیزی پیدا نکرد. نام را ساده‌تر بنویسید.</p>
        )
      ) : null}
      <p className="small">
        <a href={siteSearchLink(q || query)} target="_blank" rel="noopener noreferrer" data-testid="dk-site">
          جست‌وجوی «{q || query}» در سایت دیجی‌کالا <Glyph.External size={14} aria-hidden="true" />
        </a>
      </p>
    </Modal>
  );
}

