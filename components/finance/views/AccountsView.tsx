'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { accountBalances } from '@/lib/finance/calc';
import { deleteAccount, editAccount } from '@/lib/finance/actions';
import { ACCOUNT_KIND_LABEL, USER_ACCOUNT_KINDS, newId, tomanToRial, type AccountKind, type FinanceData } from '@/lib/finance/model';
import { Empty, PageHead } from '../../ui';
import { useFinance, WithBook } from '../FinanceProvider';
import ClassicMigrate from '../ClassicMigrate';
import PayeeBook from '../PayeeBook';
import { createAccountForSource, linkSource, sourceLabel, unlinkedSources } from '@/lib/finance/sources';
import { BalanceSource } from '../BalanceChecks';
import { Card, confirmDelete, Disclosure, JalaliDate, Money, parseAmount, SelectBox, Tabs, TextInput, TomanInput } from '../kit';

/** Cards and bank accounts the app found in SMS: link each to an account, or make one for it. */
function SmsSources({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const [showIgnored, setShowIgnored] = useState(false);
  const list = (d.smsSources ?? []).filter((s) => showIgnored || !s.ignored).sort((a, b) => b.lastAt - a.lastAt);
  if (!(d.smsSources ?? []).length)
    return (
      <Card title="کارت‌ها و حساب‌های شناخته‌شده از پیامک">
        <Empty art="inbox">هنوز کارت یا حسابی از پیامک شناسایی نشده. با اولین پیامک بانکی (یا چسباندنش در «ورود از بانک و پیامک») این‌جا پیدا می‌شود تا به حسابی وصلش کنید.</Empty>
      </Card>
    );
  const accounts = d.accounts.filter((a) => !a.archived && a.kind !== 'person');
  return (
    <Card title="کارت‌ها و حساب‌های شناخته‌شده از پیامک">
      <p className="muted small">
        از پیامک‌های بانکی پیدا شده‌اند. هر کدام را به یکی از حساب‌هایتان وصل کنید تا تراکنش‌های بعدی‌اش خودکار به همان حساب برود و موجودی حساب از مانده‌ای که بانک می‌گوید
        حساب شود.
      </p>
      <ul className="fin-list">
        {list.map((s) => (
          <li key={s.key} className={s.ignored ? 'muted' : ''} data-testid="sms-source">
            <span className="fin-list-main">
              <b>{sourceLabel(s)}</b>
              <small>
                {s.count.toLocaleString('fa-IR')} پیامک · آخرین: {new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(s.lastAt))}
                {s.lastBalanceRial !== null ? ' · آخرین مانده: ' : ''}
                {s.lastBalanceRial !== null ? <Money rial={s.lastBalanceRial} /> : null}
              </small>
            </span>
            <select
              className="fin-input sm"
              aria-label={`حساب ${sourceLabel(s)}`}
              value={s.accountId ?? ''}
              onChange={(e) => update((dr) => linkSource(dr, s.key, e.target.value || null))}
            >
              <option value="">— وصل نیست —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {!s.accountId ? (
              <>
                <button className="fin-mini" onClick={() => update((dr) => void createAccountForSource(dr, s.key, sourceLabel(s), today))}>
                  ساخت حساب تازه
                </button>
                <button className="fin-mini ghost" onClick={() => update((dr) => void (dr.smsSources.find((x) => x.key === s.key)!.ignored = !s.ignored))}>
                  {s.ignored ? 'برگرداندن' : 'مال من نیست'}
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {(d.smsSources ?? []).some((s) => s.ignored) ? (
        <button className="linkish" onClick={() => setShowIgnored((v) => !v)}>
          {showIgnored ? 'پنهان کردن موارد کنارگذاشته' : 'نمایش موارد کنارگذاشته'}
        </button>
      ) : null}
    </Card>
  );
}

/** Name, kind, start date and today's balance of an account; the balance moves only the opening balance. */
function AccountEdit({ d, id, onDone }: { d: FinanceData; id: string; onDone: () => void }) {
  const { update } = useFinance();
  const a = d.accounts.find((x) => x.id === id)!;
  const current = accountBalances(d)[id] ?? 0;
  const [name, setName] = useState(a.name);
  const [kind, setKind] = useState<AccountKind>(a.kind);
  const [balance, setBalance] = useState(String(Math.round(current / 10)));
  const [openedOn, setOpenedOn] = useState(a.openedOn);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="fin-grid fin-edit">
      <TextInput label="نام" value={name} onChange={setName} />
      {USER_ACCOUNT_KINDS.includes(a.kind) ? (
        <SelectBox<AccountKind> label="نوع" value={kind} onChange={setKind} options={USER_ACCOUNT_KINDS.map((k) => ({ key: k, label: ACCOUNT_KIND_LABEL[k] }))} />
      ) : null}
      <TomanInput label="موجودی فعلی (تومان)" value={balance} onChange={setBalance} />
      <JalaliDate label="تاریخ شروع ثبت این حساب" value={openedOn} onChange={setOpenedOn} />
      <p className="fin-span muted small">
        {a.reported
          ? 'موجودی‌ای که می‌نویسید مثل مانده بانک در همین لحظه حساب می‌شود؛ تراکنش‌های ثبت‌شده دست نمی‌خورند.'
          : 'تغییر موجودی فقط «موجودی اول دوره» را جابه‌جا می‌کند؛ تراکنش‌های ثبت‌شده دست نمی‌خورند.'}
      </p>
      <div className="fin-span fin-actions">
        <button
          className="btn"
          onClick={() => {
            const b = parseAmount(balance);
            let e: string | null = null;
            update((dr) => {
              e = editAccount(dr, id, { name, kind, openedOn, currentRial: Number.isFinite(b) && tomanToRial(b) !== Math.round(current) ? tomanToRial(b) : null });
            });
            setErr(e);
            if (!e) onDone();
          }}
        >
          ذخیره
        </button>
        <button className="fin-mini ghost" onClick={onDone}>
          انصراف
        </button>
        {err ? <span className="fin-err">{err}</span> : null}
      </div>
    </div>
  );
}

function Accounts({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const bal = accountBalances(d);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('bank');
  const [opening, setOpening] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Card title="حساب‌ها">
      {d.accounts.length ? (
        <ul className="fin-list">
          {d.accounts.filter((a) => a.kind !== 'person').map((a) => (
            <li key={a.id} className={`fin-list-block${a.archived ? ' muted' : ''}`}>
              <div className="fin-list-row">
              <span className="fin-list-main">
                <b>{a.name}</b>
                <small>
                  {ACCOUNT_KIND_LABEL[a.kind]}
                  {a.archived ? ' · بایگانی' : ''}
                  {(d.smsSources ?? []).filter((s) => s.accountId === a.id).map((s) => ` · ${sourceLabel(s)}`).join('')}
                </small>
                <BalanceSource d={d} accountId={a.id} />
              </span>
              <Money rial={bal[a.id] ?? 0} />
              <button className="fin-mini" onClick={() => setEditing(editing === a.id ? null : a.id)} aria-expanded={editing === a.id}>
                ویرایش
              </button>
              <button className="fin-mini" onClick={() => update((dr) => void (dr.accounts.find((x) => x.id === a.id)!.archived = !a.archived))}>
                {a.archived ? 'بازگردانی' : 'بایگانی'}
              </button>
              <button
                className="fin-mini ghost"
                onClick={() => {
                  if (!confirmDelete(`حساب «${a.name}»`)) return;
                  let err: string | null = null;
                  update((dr) => {
                    err = deleteAccount(dr, a.id);
                  });
                  setMsg(err);
                }}
              >
                حذف
              </button>
              </div>
              {editing === a.id ? <AccountEdit d={d} id={a.id} onDone={() => setEditing(null)} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <Empty>حسابی ندارید.</Empty>
      )}
      {msg ? <p className="fin-err">{msg}</p> : null}
      <Disclosure label="+ حساب تازه" defaultOpen={d.accounts.length < 2 && !d.txns.length}>
        {(close) => (
          <div className="fin-grid">
            <TextInput label="نام" value={name} onChange={setName} placeholder="مثلاً حساب حقوق ملت" />
            <SelectBox<AccountKind> label="نوع" value={kind} onChange={setKind} options={USER_ACCOUNT_KINDS.map((k) => ({ key: k, label: ACCOUNT_KIND_LABEL[k] }))} />
            <TomanInput label="موجودی امروز (تومان)" value={opening} onChange={setOpening} placeholder="۰" />
            <div className="fin-span fin-actions">
              <button
                className="btn"
                onClick={() => {
                  if (!name.trim()) return;
                  update((dr) => void dr.accounts.push({ id: newId('a'), name: name.trim(), kind, openingRial: tomanToRial(parseAmount(opening) || 0), openedOn: today }));
                  setName('');
                  setOpening('');
                  close();
                }}
              >
                ذخیره
              </button>
            </div>
          </div>
        )}
      </Disclosure>
      <p className="note">
        موجودی کارت و حسابی که به پیامک بانک وصل است، آخرین مانده‌ای است که بانک گفته به‌علاوه تراکنش‌هایی که بعد از آن ثبت شده؛ اگر «موجودی اول ماه + تراکنش‌های این ماه» با آن
        نخواند، همین‌جا می‌پرسیم چرا. حساب بدون پیامک (مثل کیف پول نقد) از روی تراکنش‌ها حساب می‌شود؛ اگر فرق کرد، از «ویرایش» موجودی فعلی را بنویسید.
      </p>
    </Card>
  );
}

type Tab = 'accounts' | 'cards' | 'book' | 'backup';
const TABS: Tab[] = ['accounts', 'cards', 'book', 'backup'];

function Page({ d }: { d: FinanceData }) {
  const [tab, setTab] = useState<Tab>('accounts');
  // «/accounts?tab=cards» (the notices about cards found in SMS) opens the cards tab; read once, on the device
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && (TABS as string[]).includes(t)) setTab(t as Tab);
  }, []);
  const unlinked = unlinkedSources(d).length;
  return (
    <>
      <PageHead title="حساب‌ها و کارت‌ها">
        موجودی کارت‌ها و حساب‌ها (از پیامک بانک) و دفترچه شماره کارت و شبا. طلا، سکه، ارز و دارایی‌های دیگر در بخش <Link href="/assets">سرمایه‌ها</Link> است.
      </PageHead>
      <Tabs<Tab>
        label="بخش‌های حساب‌ها و کارت‌ها"
        idPrefix="acct-tab"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'accounts', label: 'حساب‌ها' },
          { key: 'cards', label: 'کارت‌ها', title: 'کارت‌ها و حساب‌های شناخته‌شده از پیامک', badge: unlinked },
          { key: 'book', label: 'دفترچه', title: 'دفترچه شماره کارت و شبا' },
          { key: 'backup', label: 'پشتیبان', title: 'پشتیبان و انتقال داده' },
        ]}
      />
      <div role="tabpanel" id="acct-tab-panel" aria-labelledby={`acct-tab-${tab}`} data-testid={`panel-${tab}`}>
        {tab === 'accounts' ? <Accounts d={d} /> : null}
        {tab === 'cards' ? <SmsSources d={d} /> : null}
        {tab === 'book' ? <PayeeBook d={d} /> : null}
        {tab === 'backup' ? (
          <>
            <Card title="تنظیمات و پشتیبان">
              <p className="muted small">
                تورم و سود مبنای محاسبه، صندوق اضطراری، یادآوری اقساط و قرض، و فایل پشتیبان دفتر همه در <Link href="/settings">صفحه تنظیمات</Link> است.
              </p>
            </Card>
            <ClassicMigrate d={d} always />
          </>
        ) : null}
      </div>
    </>
  );
}

export default function AccountsView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Page d={d} />}</WithBook>
    </div>
  );
}
