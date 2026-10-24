'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { isMoneyAccount, rialToTomanN, tomanToRial, type FinanceData, type ShoppingItem } from '@/lib/finance/model';
import {
  addItem,
  bookPurchase,
  boughtItems,
  editItem,
  listItems,
  listTotals,
  purchaseMatches,
  removeItem,
  setBought,
  suggestItems,
  undoPurchase,
  type PurchaseReceipt,
} from '@/lib/finance/shopping';
import { Glyph } from '../../icons';
import { Empty, PageHead } from '../../ui';
import { useFinance, WithBook } from '../FinanceProvider';
import { Card, Field, fmtDateFa, JalaliDate, Money, parseAmount, TomanInput } from '../kit';

const faN = (n: number) => n.toLocaleString('fa-IR');
const ACCT_KEY = 'imf.shop.acct.v1';
const CAT_KEY = 'imf.shop.cat.v1';
const remembered = (k: string) => {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
};
const remember = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // a convenience only
  }
};

function AddBox({ d }: { d: FinanceData }) {
  const { update } = useFinance();
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [est, setEst] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const sugg = useMemo(() => suggestItems(d, name), [d, name]);

  const add = (n = name) => {
    let e: string | null = null;
    update((dr) => {
      const r = addItem(dr, { name: n, qty, estRial: est ? tomanToRial(parseAmount(est)) : null });
      if (typeof r === 'string') e = r;
    });
    setErr(e);
    if (!e) {
      setName('');
      setQty('');
      setEst('');
    }
  };

  return (
    <Card title="چه چیزی باید بخرم؟">
      <form
        className="fin-grid shop-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Field label="نام">
          <input className="fin-input" aria-label="نام" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً شیر" list="shop-sugg" autoComplete="off" data-testid="shop-name" />
          <datalist id="shop-sugg">
            {sugg.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="مقدار (اختیاری)">
          <input className="fin-input" aria-label="مقدار" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="۲ کیلو، یک بسته" />
        </Field>
        <TomanInput label="قیمت تقریبی (تومان، اختیاری)" value={est} onChange={setEst} />
        <div className="fin-actions">
          <button className="fin-mini" type="submit" disabled={!name.trim()} data-testid="shop-add">
            <Glyph.Plus size={16} aria-hidden="true" /> افزودن
          </button>
        </div>
      </form>
      {err ? (
        <p className="fin-err" role="alert">
          {err}
        </p>
      ) : null}
      {!name.trim() && sugg.length ? (
        <div className="shop-chips" aria-label="افزودن سریع">
          {sugg.map((s) => (
            <button key={s} type="button" className="fin-chip" onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function ItemRow({ it }: { it: ShoppingItem }) {
  const { update } = useFinance();
  const [price, setPrice] = useState(it.priceRial ? String(rialToTomanN(it.priceRial)) : '');
  return (
    <li className={`shop-item${it.done ? ' done' : ''}`} data-testid={it.done ? 'shop-bought' : 'shop-left'}>
      <label className="shop-check">
        <input type="checkbox" checked={!!it.done} onChange={(e) => update((dr) => setBought(dr, it.id, e.target.checked))} aria-label={`${it.name} خریده شد`} />
        <span className="shop-name">
          <b>{it.name}</b>
          {it.qty ? <small> {it.qty}</small> : null}
        </span>
      </label>
      {it.done ? (
        <input
          className="fin-input shop-price"
          inputMode="numeric"
          aria-label={`قیمت ${it.name} (تومان)`}
          placeholder="قیمت (تومان)"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={() => update((dr) => editItem(dr, it.id, { priceRial: price ? tomanToRial(parseAmount(price)) : null }))}
        />
      ) : it.estRial ? (
        <small className="muted shop-est">
          حدود <Money rial={it.estRial} short />
        </small>
      ) : null}
      <button className="fin-mini ghost shop-del" onClick={() => update((dr) => removeItem(dr, it.id))} aria-label={`حذف ${it.name}`}>
        <Glyph.Close size={16} aria-hidden="true" />
      </button>
    </li>
  );
}

/** Books the basket as one expense; offers the bank's SMS of the same payment instead of a second row. */
function Checkout({ d, onBooked }: { d: FinanceData; onBooked: (r: PurchaseReceipt) => void }) {
  const { update, today } = useFinance();
  const bought = boughtItems(d);
  const totals = listTotals(d);
  const accounts = d.accounts.filter((a) => isMoneyAccount(a) && !a.bizId);
  const cats = d.categories.filter((c) => c.kind === 'expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(() => {
    const r = remembered(ACCT_KEY);
    return accounts.some((a) => a.id === r) ? r : (accounts.find((a) => a.kind === 'bank') ?? accounts[0])?.id ?? '';
  });
  const [categoryId, setCategoryId] = useState(() => {
    const r = remembered(CAT_KEY);
    return cats.some((c) => c.id === r) ? r : cats.some((c) => c.id === 'c-food') ? 'c-food' : '';
  });
  const [date, setDate] = useState(today);
  const [match, setMatch] = useState<string>(''); // '' = not chosen yet, 'new', 't:<id>', 's:<id>'
  const [err, setErr] = useState<string | null>(null);

  // the typed amount wins; otherwise the sum of the prices, when every ticked item has one
  const amountRial = amount ? tomanToRial(parseAmount(amount)) : totals.boughtUnpriced ? 0 : totals.boughtRial;
  const m = amountRial > 0 ? purchaseMatches(d, amountRial, date) : { txns: [], staged: [] };
  const hasMatch = m.txns.length + m.staged.length > 0;
  const chosen = hasMatch ? match : 'new';

  const book = () => {
    if (hasMatch && !chosen) return setErr('آیا این همان پیامک بانک است؟ یکی را انتخاب کنید.');
    let res: PurchaseReceipt | string = '';
    update((dr) => {
      res = bookPurchase(dr, {
        itemIds: bought.map((x) => x.id),
        amountRial,
        accountId,
        categoryId: categoryId || null,
        date,
        linkTxnId: chosen.startsWith('t:') ? chosen.slice(2) : null,
        stagedId: chosen.startsWith('s:') ? chosen.slice(2) : null,
      });
    });
    if (typeof res === 'string') return setErr(res);
    remember(ACCT_KEY, accountId);
    remember(CAT_KEY, categoryId);
    setErr(null);
    setAmount('');
    setMatch('');
    onBooked(res);
  };

  return (
    <Card title={`ثبت خرید در دفتر (${faN(bought.length)} قلم)`} className="shop-checkout">
      <p className="muted small">
        همه اقلام تیک‌خورده یک هزینه می‌شوند، همان‌طور که بانک هم یک پرداخت می‌بیند. قیمت اقلام اختیاری است؛ مبلغی که این‌جا تأیید می‌کنید ثبت می‌شود.
      </p>
      <div className="fin-grid">
        <TomanInput
          label="مبلغ کل خرید (تومان)"
          value={amount}
          onChange={setAmount}
          placeholder={totals.boughtRial && !totals.boughtUnpriced ? String(rialToTomanN(totals.boughtRial)) : 'مبلغی که پرداختید'}
        />
        <Field label="از کدام حساب">
          <select className="fin-input" aria-label="از کدام حساب" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="دسته">
          <select className="fin-input" aria-label="دسته" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">بدون دسته</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
        </Field>
        <JalaliDate label="تاریخ" value={date} onChange={setDate} yearsBack={1} yearsAhead={0} />
      </div>
      {totals.boughtRial ? (
        <p className="small" data-testid="shop-sum">
          جمع قیمت‌های واردشده: <Money rial={totals.boughtRial} />
          {totals.boughtUnpriced ? ` (${faN(totals.boughtUnpriced)} قلم بی‌قیمت — مبلغ کل را خودتان بنویسید)` : ''}
        </p>
      ) : null}
      {hasMatch ? (
        <fieldset className="shop-match" data-testid="shop-match">
          <legend>پرداختی با همین مبلغ در دفتر یا صف پیامک هست. همین خرید است؟</legend>
          {m.txns.map((t) => (
            <label key={t.id} className="fin-radio">
              <input type="radio" name="shop-match" checked={chosen === `t:${t.id}`} onChange={() => setMatch(`t:${t.id}`)} />
              بله، همین تراکنش ثبت‌شده: {fmtDateFa(t.date)}
              {t.time ? ` ساعت ${t.time}` : ''} — {t.note || 'بی‌توضیح'}
            </label>
          ))}
          {m.staged.map((s) => (
            <label key={s.id} className="fin-radio">
              <input type="radio" name="shop-match" checked={chosen === `s:${s.id}`} onChange={() => setMatch(`s:${s.id}`)} />
              بله، همین پیامک بانک در صف: {s.date ? fmtDateFa(s.date) : 'بی‌تاریخ'}
              {s.time ? ` ساعت ${s.time}` : ''} — {s.description}
            </label>
          ))}
          <label className="fin-radio">
            <input type="radio" name="shop-match" checked={chosen === 'new'} onChange={() => setMatch('new')} />
            نه، خرید جداگانه‌ای است (تراکنش تازه)
          </label>
        </fieldset>
      ) : null}
      <div className="fin-actions">
        <button className="fin-mini" onClick={book} disabled={!(amountRial > 0) || !accountId} data-testid="shop-book">
          ثبت در دفتر
        </button>
      </div>
      {err ? (
        <p className="fin-err" role="alert">
          {err}
        </p>
      ) : null}
    </Card>
  );
}

function Shopping({ d }: { d: FinanceData }) {
  const { update } = useFinance();
  const [receipt, setReceipt] = useState<PurchaseReceipt | null>(null);
  const items = listItems(d);
  const left = items.filter((x) => !x.done);
  const bought = items.filter((x) => x.done);
  const t = listTotals(d);

  return (
    <>
      <PageHead title="لیست خرید">
        آن‌چه باید بخرید را یادداشت کنید، موقع خرید تیک بزنید (قیمت هر قلم اختیاری است) و در آخر کل خرید را یک‌جا در دفتر ثبت کنید. اگر پیامک بانکِ همین پرداخت قبلاً رسیده،
        همان ثبت می‌شود، نه دوباره. لیست فقط روی همین دستگاه است.
      </PageHead>
      {receipt ? (
        <p className="fin-ok" role="status" data-testid="shop-booked">
          خرید ثبت شد ({receipt.how === 'new' ? 'تراکنش تازه' : receipt.how === 'staged' ? 'از پیامک بانک در صف' : 'روی همان تراکنش پیامک بانک'}).{' '}
          <Link href="/transactions">دیدن تراکنش‌ها</Link>{' '}
          <button
            className="fin-mini ghost"
            onClick={() => {
              update((dr) => undoPurchase(dr, receipt));
              setReceipt(null);
            }}
          >
            برگرداندن
          </button>
        </p>
      ) : null}
      <AddBox d={d} />
      <Card title={`باید بخرم (${faN(left.length)})`}>
        {left.length ? (
          <>
            <ul className="shop-list">
              {left.map((it) => (
                <ItemRow key={`${it.id}${it.done ? '-d' : ''}`} it={it} />
              ))}
            </ul>
            {t.leftEstRial ? (
              <p className="small muted">
                جمع تقریبی: <Money rial={t.leftEstRial} />
                {t.leftUnpriced ? ` (بدون ${faN(t.leftUnpriced)} قلم بی‌قیمت)` : ''}
              </p>
            ) : null}
          </>
        ) : (
          <Empty art="shop">{bought.length ? 'همه را خریدید. خرید را پایین ثبت کنید.' : 'لیست خالی است. اولین قلم را بالا بنویسید.'}</Empty>
        )}
      </Card>
      {bought.length ? (
        <>
          <Card title={`در سبد (${faN(bought.length)})`}>
            <ul className="shop-list">
              {bought.map((it) => (
                <ItemRow key={`${it.id}${it.done ? '-d' : ''}`} it={it} />
              ))}
            </ul>
          </Card>
          <Checkout d={d} onBooked={setReceipt} />
        </>
      ) : null}
    </>
  );
}

export default function ShoppingView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Shopping d={d} />}</WithBook>
    </div>
  );
}
