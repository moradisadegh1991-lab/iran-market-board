'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { accountBalances } from '@/lib/finance/calc';
import {
  CHOICE_LABEL,
  choicesFor,
  defaultChoice,
  commitStaged,
  dismissStaged,
  enqueue,
  isDuplicate,
  rowsFromSms,
  rowsFromTable,
  suggestCategory,
  type ColumnMap,
  type SmsResult,
  type StagedChoice,
} from '@/lib/finance/importers';
import { readStatement, ReadError } from '@/lib/finance/readers';
import { smsParser } from '@/lib/finance/sms';
import { learnFromCommit, queueSms, reportBalance, stagedAt, unlinkedSources } from '@/lib/finance/sources';
import { partiesNote, suggestParties, type PartySuggestion } from '@/lib/finance/sms-parties';
import { askOn, autoReadOn, FIRST_READ_DAYS, lastPhoneRead, readInbox, setAskOn, setAutoRead, useSmsPlugin } from '@/lib/finance/phone-sms';
import { tomanToRial, type FinanceData, type Staged } from '@/lib/finance/model';
import { Chips, Empty, PageHead, Toggle } from '../../ui';
import { useFinance, WithBook } from '../FinanceProvider';
import { Card, confirmDelete, Field, fmtDateFa, JalaliDate, Money, parseAmount, SelectBox, TomanInput } from '../kit';

const faN = (n: number) => n.toLocaleString('fa-IR');
const faDigits = (t: string) => t.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
const SOURCE_LABEL: Record<Staged['source'], string> = { sms: 'پیامک', statement: 'گردش حساب', classic: 'نسخه قبلی اپ' };
const ROLE_LABEL: Record<string, string> = { date: 'تاریخ', time: 'زمان', desc: 'شرح', out: 'برداشت', in: 'واریز', amount: 'مبلغ', balance: 'مانده', ref: 'پیگیری' };

interface FileReport {
  name: string;
  rows: number;
  added: number;
  skipped: number;
  warnings: string[];
  map: ColumnMap | null;
  header: string[];
  lastBalanceRial: number | null;
  bookBalanceRial: number | null;
  accountName: string;
}

function useAccounts(d: FinanceData) {
  return useMemo(() => d.accounts.filter((a) => !a.archived), [d.accounts]);
}

function AccountSelect({ d, value, onChange, label, allowNone }: { d: FinanceData; value: string; onChange: (v: string) => void; label: string; allowNone?: string }) {
  const accounts = useAccounts(d);
  return (
    <SelectBox
      label={label}
      value={value}
      onChange={onChange}
      options={[...(allowNone !== undefined ? [{ key: '', label: allowNone }] : []), ...accounts.map((a) => ({ key: a.id, label: a.name }))]}
    />
  );
}

// ── statement file ─────────────────────────────────────────────────────────

function StatementCard({ d }: { d: FinanceData }) {
  const { update } = useFinance();
  const accounts = useAccounts(d);
  const [accountId, setAccountId] = useState(() => accounts.find((a) => a.kind === 'bank')?.id ?? '');
  const [unit, setUnit] = useState<'auto' | 'rial' | 'toman'>('auto');
  const [password, setPassword] = useState('');
  const [needPassword, setNeedPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState<FileReport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useRef<File | null>(null);

  async function run(file: File) {
    setErr(null);
    setReport(null);
    if (!accountId) return setErr('اول حسابی را که این گردش مال آن است انتخاب کنید.');
    setBusy(true);
    try {
      const { table, format, pages } = await readStatement(file.name, await file.arrayBuffer(), password || undefined);
      setNeedPassword(false);
      const res = rowsFromTable(table, { accountId, unit: unit === 'auto' ? undefined : unit });
      if (!res.rows.length) {
        setErr(res.warnings[0] ?? (format === 'pdf' ? 'در این PDF جدول تراکنشی پیدا نشد.' : 'ردیف تراکنشی در فایل پیدا نشد.'));
        return;
      }
      const before = accountBalances(d)[accountId] ?? null;
      let added = 0;
      const last = [...res.rows].reverse().find((r) => r.balanceRial !== null && r.balanceRial !== undefined);
      update((dr) => {
        added = enqueue(dr, res.rows);
        // the file's last running balance is what the bank says is in this account
        const at = last ? stagedAt(last) : null;
        if (last && at !== null) reportBalance(dr, accountId, last.balanceRial!, at, 'statement');
      });
      setReport({
        name: pages ? `${file.name} (${faN(pages)} صفحه)` : file.name,
        rows: res.rows.length,
        added,
        skipped: res.skipped,
        warnings: res.warnings,
        map: res.map,
        header: res.map ? table[res.map.headerRow] : [],
        lastBalanceRial: last?.balanceRial ?? null,
        bookBalanceRial: before,
        accountName: d.accounts.find((a) => a.id === accountId)?.name ?? '',
      });
      pending.current = null;
    } catch (e) {
      if (e instanceof ReadError && e.code === 'password') {
        setNeedPassword(true);
        pending.current = file;
      }
      setErr(e instanceof Error ? e.message : 'خواندن فایل ناموفق بود.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <Card title="فایل گردش حساب (اکسل، CSV یا PDF)">
      <p className="muted small">
        از اینترنت‌بانک یا همراه‌بانک «صورتحساب / گردش حساب» را بگیرید. فایل همین‌جا در مرورگر خوانده می‌شود و به هیچ سروری فرستاده نمی‌شود. PDF باید متنی باشد (نه
        عکس اسکن‌شده).
      </p>
      {accounts.length ? null : <p className="fin-err">اول در صفحه «حساب‌ها و کارت‌ها» یک حساب بانکی بسازید.</p>}
      <div className="fin-grid">
        <AccountSelect d={d} label="این گردش مال کدام حساب است؟" value={accountId} onChange={setAccountId} allowNone="— انتخاب حساب —" />
        <SelectBox<'auto' | 'rial' | 'toman'>
          label="واحد مبالغ فایل"
          value={unit}
          onChange={setUnit}
          options={[
            { key: 'auto', label: 'از سرستون فایل (پیش‌فرض ریال)' },
            { key: 'rial', label: 'ریال' },
            { key: 'toman', label: 'تومان' },
          ]}
        />
        {needPassword ? (
          <Field label="رمز فایل PDF" hint="معمولاً کد ملی یا شماره مشتری؛ فقط برای باز کردن فایل در همین مرورگر استفاده می‌شود.">
            <input className="fin-input" type="password" dir="ltr" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        ) : null}
      </div>
      <div className="fin-actions" style={{ marginTop: 12 }}>
        <label className={`fin-upload${busy || !accountId ? ' disabled' : ''}`}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.ods,.csv,.txt,.pdf,.htm,.html"
            disabled={busy || !accountId}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void run(f);
            }}
          />
          {busy ? 'در حال خواندن…' : 'انتخاب فایل گردش حساب'}
        </label>
        {needPassword && pending.current ? (
          <button className="fin-mini" disabled={busy || !password} onClick={() => pending.current && void run(pending.current)}>
            باز کردن با این رمز
          </button>
        ) : null}
      </div>
      {err ? (
        <p className="fin-err" role="alert">
          {err}
        </p>
      ) : null}
      {report ? (
        <div className="fin-report" role="status">
          <p>
            <b>{report.name}</b>: {faN(report.rows)} تراکنش خوانده شد؛ {faN(report.added)} ردیف تازه به صف بررسی رفت
            {report.rows > report.added ? ` (${faN(report.rows - report.added)} ردیف قبلاً در صف بود)` : ''}
            {report.skipped ? `؛ ${faN(report.skipped)} ردیف (جمع، مانده از قبل یا بدون تاریخ) کنار گذاشته شد` : ''}.
          </p>
          {report.map ? (
            <p className="muted small">
              ستون‌های شناخته‌شده:{' '}
              {Object.entries(report.map.cols)
                .map(([role, i]) => `${ROLE_LABEL[role] ?? role} ← «${report.header[i!] ?? ''}»`)
                .join('، ')}
              . واحد: {unit === 'auto' ? (report.map.unit === 'toman' ? 'تومان' : 'ریال') : unit === 'toman' ? 'تومان' : 'ریال'}.
            </p>
          ) : null}
          {report.warnings.length ? (
            <ul className="fin-alerts">
              {report.warnings.map((w) => (
                <li key={w} className="warn">
                  {w}
                </li>
              ))}
            </ul>
          ) : null}
          {report.lastBalanceRial !== null ? (
            <p className="small">
              مانده آخر فایل: <Money rial={report.lastBalanceRial} /> — مانده «{report.accountName}» در دفتر پیش از ثبت این ردیف‌ها: <Money rial={report.bookBalanceRial} />. بعد از
              ثبت همه ردیف‌ها این دو باید به هم نزدیک شوند؛ اگر حساب را تازه ساخته‌اید، موجودی اولش را با مانده قبل از اولین ردیف فایل یکی کنید.
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

// ── SMS ────────────────────────────────────────────────────────────────────

function SmsCard({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const accounts = useAccounts(d);
  const [accountId, setAccountId] = useState(() => accounts.find((a) => a.kind === 'bank')?.id ?? '');
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ added: number; read: number; ignored: { text: string; reason: string }[]; ignoredCount: number; newSources: number } | null>(null);

  const plugin = useSmsPlugin();
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneErr, setPhoneErr] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    setAuto(autoReadOn());
    setAsk(askOn());
  }, []);

  function queue(r: SmsResult, listIgnored: boolean) {
    let added = 0;
    let newSources = 0;
    update((dr) => {
      ({ added, newSources } = queueSms(dr, r.rows, Date.now()));
    });
    // from the phone inbox, "ignored" is every personal SMS too — count them, never list them
    setResult({ added, read: r.rows.length, ignored: listIgnored ? r.ignored : [], ignoredCount: r.ignored.length, newSources });
  }

  function read() {
    const r = rowsFromSms(text, smsParser, today, { accountId: accountId || null });
    queue(r, true);
    if (r.rows.length) setText('');
  }

  async function readPhone() {
    if (!plugin) return;
    setPhoneErr(null);
    setResult(null);
    setPhoneBusy(true);
    try {
      const r = await readInbox(plugin, today, accountId || null, true);
      if (r) queue(r, false);
    } catch (e) {
      setPhoneErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPhoneBusy(false);
    }
  }

  return (
    <Card title="پیامک بانکی">
      <p className="muted small">
        {plugin ? 'پیامک‌های بانکی را مستقیم از گوشی بخوانید، یا متنشان را این‌جا بچسبانید' : 'متن پیامک‌های بانک را کپی کنید و این‌جا بچسبانید'}؛ <b>بین هر دو پیامک یک خط خالی</b>{' '}
        بگذارید. نوع هر تراکنش را بعد از خواندن خودتان تعیین می‌کنید.{plugin ? null : ' (اپ اندروید پیامک‌ها را خودش می‌خواند؛ مرورگر به پیامک‌های گوشی دسترسی ندارد.)'}
      </p>
      <div className="fin-grid">
        <AccountSelect d={d} label="حساب این پیامک‌ها" value={accountId} onChange={setAccountId} allowNone="— بعداً انتخاب می‌کنم —" />
      </div>
      {plugin ? (
        <div className="fin-actions" style={{ margin: '10px 0 14px' }}>
          <button className="fin-upload" onClick={readPhone} disabled={phoneBusy}>
            {phoneBusy ? 'در حال خواندن صندوق پیامک…' : 'خواندن پیامک‌های بانکی گوشی'}
          </button>
          <span className="muted small">
            {lastPhoneRead() ? `از آخرین خواندن (${fmtDateFa(new Date(lastPhoneRead()!).toISOString().slice(0, 10))}) به بعد` : `پیامک‌های ${faN(FIRST_READ_DAYS)} روز اخیر`}؛ پیامک‌ها از گوشی بیرون نمی‌روند.
          </span>
        </div>
      ) : null}
      {plugin ? (
        <Toggle
          checked={auto}
          onChange={(v) => {
            setAuto(v);
            setAutoRead(v);
          }}
        >
          پیامک‌های بانکی تازه را خودکار بخوان (هنگام باز کردن اپ و هر ۳۰ ثانیه وقتی اپ باز است) و اعلان بده
        </Toggle>
      ) : null}
      {plugin?.asked ? (
        <>
          <Toggle
            checked={ask}
            onChange={(v) => {
              setAsk(v);
              setAskOn(v, plugin);
            }}
          >
            همان لحظه رسیدن پیامک بانکی، در اعلان بالای صفحه بپرس هزینه بود، درآمد یا انتقال — حتی وقتی اپ بسته است
          </Toggle>
          <p className="muted small">
            جوابی که در اعلان می‌دهید روی گوشی می‌ماند و با باز شدن اپ اعمال می‌شود: هزینه/درآمدِ کارتی که به حسابی وصل است مستقیم در دفتر ثبت می‌شود،
            بقیه با همان نوع در صف همین صفحه منتظر حساب یا بررسی می‌مانند. اگر اعلان نیامد، در تنظیمات اندروید «بهینه‌سازی باتری» را برای «مالی من» خاموش کنید.
          </p>
        </>
      ) : null}
      {phoneErr ? (
        <p className="fin-err" role="alert">
          {phoneErr}
        </p>
      ) : null}
      <Field label="متن پیامک‌ها">
        <textarea className="fin-input" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'برداشت: 1,250,000 ریال\nکارت: *4417\nمانده: 12,300,000\n0705-14:35\n\nواریز 3,000,000 ریال به حساب شما'} />
      </Field>
      <div className="fin-actions" style={{ marginTop: 10 }}>
        <button className="fin-mini" onClick={read} disabled={!text.trim()}>
          خواندن پیامک‌ها
        </button>
      </div>
      {result ? (
        <div className="fin-report" role="status">
          <p>
            {faN(result.read)} تراکنش خوانده شد؛ {faN(result.added)} ردیف تازه به صف بررسی رفت{result.read > result.added ? ` (${faN(result.read - result.added)} تا قبلاً در صف بود)` : ''}.
            {result.ignoredCount ? ` ${faN(result.ignoredCount)} پیام تراکنش بانکی نبود.` : ''}
          </p>
          {result.newSources ? (
            <p className="banner info">
              {faN(result.newSources)} کارت یا حساب تازه در پیامک‌ها شناسایی شد. در <Link href="/accounts">حساب‌ها و کارت‌ها</Link> به حساب‌هایتان وصلشان کنید تا تراکنش‌ها و مانده بانکشان
              خودکار به همان حساب برود.
            </p>
          ) : null}
          {result.ignored.length ? (
            <details className="fin-details">
              <summary>پیام‌های کنار گذاشته</summary>
              <ul className="fin-list">
                {result.ignored.map((x, i) => (
                  <li key={i}>
                    <span className="fin-list-main">
                      <b className="fin-raw">{x.text}</b>
                      <small>{x.reason}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

// ── review queue ───────────────────────────────────────────────────────────

interface Draft {
  choice?: StagedChoice;
  categoryId?: string;
  accountId?: string;
  otherAccountId?: string;
  date?: string;
  amount?: string;
}


type QueueFilter = 'all' | 'decide' | 'dup';

/** The SMS's «مبدا و مقصد»; for a row whose direction the bank left unstated, read with the side the user chose. */
function partiesFor(d: FinanceData, s: Staged, choice?: StagedChoice): PartySuggestion | null {
  if (s.source !== 'sms') return null;
  const dir = s.direction ?? (choice === 'expense' || choice === 'transfer-out' ? 'out' : choice === 'income' || choice === 'transfer-in' ? 'in' : null);
  return suggestParties(d, dir === s.direction ? s : { ...s, direction: dir });
}

function PartiesBox({ p, onApply, hasAccount, choice }: { p: PartySuggestion; onApply: (patch: Draft) => void; hasAccount: boolean; choice?: StagedChoice }) {
  if (!p.from && !p.to && !p.bank) return null;
  const why = [p.from && p.from.kind !== 'mine' ? p.from.why : null, p.to && p.to.kind !== 'mine' ? p.to.why : null, p.bank ? `بانک: ${p.bank.via === 'sender' ? 'از فرستنده پیامک' : 'از متن پیامک'}` : null].filter(Boolean);
  return (
    <div className="fin-parties" data-testid="parties">
      {p.from || p.to ? (
        <div className="fin-parties-flow">
          <span>
            <small>مبدا</small>
            <b>{p.from?.label ?? 'نامعلوم'}</b>
          </span>
          <span className="fin-parties-arrow" aria-hidden="true">
            ←
          </span>
          <span>
            <small>مقصد</small>
            <b>{p.to?.label ?? 'نامعلوم'}</b>
          </span>
        </div>
      ) : (
        <div className="fin-parties-flow">
          <span>
            <small>بانک</small>
            <b>{p.bank!.name}</b>
          </span>
        </div>
      )}
      {p.purpose ? <div className="small">بابت: {p.purpose}</div> : null}
      {why.length ? <small className="muted">پیشنهاد اپ — {why.join('؛ ')}</small> : null}
      {p.transfer && choice !== p.transfer.choice ? (
        <button type="button" className="fin-mini" onClick={() => onApply({ choice: p.transfer!.choice, otherAccountId: p.transfer!.otherAccountId, categoryId: undefined })}>
          ثبت به‌عنوان انتقال {p.transfer.choice === 'transfer-out' ? 'به' : 'از'} «{p.transfer.name}»
        </button>
      ) : null}
      {p.account && !hasAccount ? (
        <button type="button" className="fin-mini ghost" onClick={() => onApply({ accountId: p.account!.accountId })} title={p.account.why}>
          حساب: «{p.account.name}»؟ <small>({p.account.why})</small>
        </button>
      ) : null}
    </div>
  );
}

function Queue({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [limit, setLimit] = useState(40);
  const [note, setNote] = useState<string | null>(null);
  const accounts = useAccounts(d);

  const rows = useMemo(
    () =>
      [...d.inbox]
        .map((s) => ({ s, dup: isDuplicate(d, s), suggested: suggestCategory(d, s, partiesFor(d, s)?.memoryKey) }))
        // rows that need the user's decision first, then newest first
        .sort((a, b) => Number(!!a.s.direction) - Number(!!b.s.direction) || ((a.s.date ?? '9999') < (b.s.date ?? '9999') ? 1 : -1)),
    [d],
  );

  const resolve = (s: Staged, suggested: string | null) => {
    const dr = drafts[s.id] ?? {};
    const choice = dr.choice ?? defaultChoice(s);
    const kind = choice === 'expense' || choice === 'income' ? choice : null;
    const cat = dr.categoryId !== undefined ? dr.categoryId : suggested && kind && d.categories.find((c) => c.id === suggested)?.kind === kind ? suggested : '';
    return {
      choice,
      categoryId: cat,
      accountId: dr.accountId ?? s.accountId ?? '',
      otherAccountId: dr.otherAccountId ?? '',
      // an undated row shows today in the picker, so today is what the user sees and confirms
      date: dr.date ?? s.date ?? today,
      amountRial: dr.amount !== undefined ? tomanToRial(parseAmount(dr.amount)) : null,
    };
  };
  const ready = (r: (typeof rows)[number]) => {
    const v = resolve(r.s, r.suggested);
    // bulk confirmation never picks a date or an amount for the user
    return !r.dup && !!v.choice && !v.choice.startsWith('transfer') && !!v.accountId && !!(r.s.date || drafts[r.s.id]?.date) && !r.s.uncertainAmount;
  };

  const shown = rows.filter((r) => (filter === 'decide' ? !resolve(r.s, r.suggested).choice || !r.s.date : filter === 'dup' ? r.dup : true));
  const readyRows = rows.filter(ready);

  const setDraft = (id: string, patch: Draft) => setDrafts((x) => ({ ...x, [id]: { ...x[id], ...patch } }));

  function commit(ids: string[]) {
    const errs: Record<string, string> = {};
    let done = 0;
    update((dr) => {
      for (const id of ids) {
        const r = rows.find((x) => x.s.id === id);
        if (!r) continue;
        const v = resolve(r.s, r.suggested);
        if (!v.choice) {
          errs[id] = 'نوع تراکنش را انتخاب کنید.';
          continue;
        }
        const p = partiesFor(d, r.s, v.choice);
        const e = commitStaged(dr, id, {
          choice: v.choice,
          accountId: v.accountId,
          otherAccountId: v.otherAccountId || null,
          categoryId: v.categoryId || null,
          date: v.date || null,
          amountRial: v.amountRial,
          partiesNote: p ? partiesNote(p) || null : null,
          partyKey: p?.memoryKey ?? null,
        });
        if (e) errs[id] = e;
        else {
          done++;
          // the card on this row now knows its account; its next SMS arrive already assigned
          learnFromCommit(dr, r.s, v.accountId);
        }
      }
    });
    setErrors((x) => {
      const next = { ...x };
      for (const id of ids) delete next[id];
      return { ...next, ...errs };
    });
    if (ids.length > 1) setNote(`${faN(done)} تراکنش ثبت شد${Object.keys(errs).length ? `؛ ${faN(Object.keys(errs).length)} ردیف خطا داشت` : ''}.`);
  }

  if (!rows.length)
    return (
      <Card title="صف بررسی">
        {/* the last bulk booking empties the queue: its confirmation must still show */}
        {note ? (
          <p className="fin-ok" role="status">
            {note}
          </p>
        ) : null}
        <Empty>صف خالی است. یک فایل گردش حساب بدهید یا پیامک بچسبانید.</Empty>
      </Card>
    );

  return (
    <Card title={`صف بررسی (${faN(rows.length)})`}>
      <p className="muted small">
        هیچ ردیفی بدون تأیید شما ثبت نمی‌شود. جهت (برداشت/واریز) فقط وقتی از پیش پر است که بانک خودش گفته باشد؛ وگرنه شما تعیین می‌کنید. ردیف‌های «احتمالاً تکراری» با تراکنشی که
        قبلاً ثبت کرده‌اید هم‌روز و هم‌مبلغ‌اند.
      </p>
      <div className="filterbar">
        <Chips<QueueFilter>
          label="نمایش"
          options={[
            { key: 'all', label: 'همه' },
            { key: 'decide', label: 'نیازمند تصمیم' },
            { key: 'dup', label: 'احتمالاً تکراری' },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <button className="fin-mini" disabled={!readyRows.length} onClick={() => commit(readyRows.map((r) => r.s.id))}>
          ثبت {faN(readyRows.length)} ردیف آماده
        </button>
        <button
          className="fin-mini ghost"
          onClick={() => {
            if (confirmDelete(`همه ${faN(rows.length)} ردیف صف (بدون ثبت)`)) update((dr) => dismissStaged(dr, rows.map((r) => r.s.id)));
          }}
        >
          خالی کردن صف
        </button>
      </div>
      <p className="muted small">«آماده» یعنی نوع، تاریخ و حساب معلوم است، انتقال نیست و تکراری به نظر نمی‌رسد؛ انتقال‌ها و بقیه را تک‌تک ثبت کنید.</p>
      {note ? (
        <p className="fin-ok" role="status">
          {note}
        </p>
      ) : null}
      <ul className="fin-list fin-queue">
        {shown.slice(0, limit).map(({ s, dup, suggested }) => {
          const v = resolve(s, suggested);
          const kind = v.choice === 'expense' || v.choice === 'income' ? v.choice : null;
          const transfer = v.choice === 'transfer-out' || v.choice === 'transfer-in';
          const sign = s.direction === 'out' ? -1 : s.direction === 'in' ? 1 : 0;
          return (
            <li key={s.id} className={`fin-list-block${dup ? ' dup' : ''}`} data-testid="staged">
              <div className="fin-list-row">
                <span className="fin-list-main">
                  <b>{s.description || SOURCE_LABEL[s.source]}</b>
                  <small>
                    {s.date ? fmtDateFa(s.date) : 'بدون تاریخ'}
                    {s.time ? ` · ${s.time}` : ''}
                    {s.ref ? ` · پیگیری ${faDigits(s.ref)}` : ''}
                    {` · ${SOURCE_LABEL[s.source]}`}
                  </small>
                </span>
                <span className="fin-list-nums">
                  {sign ? <Money rial={sign * s.amountRial} signed /> : <Money rial={s.amountRial} />}
                  <small>{s.direction === 'out' ? 'برداشت' : s.direction === 'in' ? 'واریز' : 'جهت نامعلوم'}</small>
                </span>
              </div>
              <div className="fin-tags tight">
                <span className={`fin-tag${s.direction ? '' : ' warn'}`}>{s.why}</span>
                {dup ? <span className="fin-tag warn">احتمالاً تکراری</span> : null}
                {s.fee ? <span className="fin-tag">کارمزد</span> : null}
              </div>
              {(() => {
                const p = partiesFor(d, s, v.choice);
                return p ? <PartiesBox p={p} choice={v.choice} hasAccount={!!v.accountId} onApply={(patch) => setDraft(s.id, patch)} /> : null;
              })()}
              <div className="fin-grid fin-queue-form">
                <Field label="نوع">
                  <select className="fin-input" aria-label="نوع" value={v.choice ?? ''} onChange={(e) => setDraft(s.id, { choice: (e.target.value || undefined) as StagedChoice | undefined, categoryId: undefined })}>
                    {v.choice ? null : <option value="">— انتخاب کنید —</option>}
                    {choicesFor(s).map((c) => (
                      <option key={c} value={c}>
                        {CHOICE_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </Field>
                {kind ? (
                  <Field label="دسته">
                    <select className="fin-input" aria-label="دسته" value={v.categoryId} onChange={(e) => setDraft(s.id, { categoryId: e.target.value })}>
                      <option value="">بدون دسته</option>
                      {d.categories
                        .filter((c) => c.kind === kind)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.emoji} {c.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                ) : null}
                {transfer ? (
                  <Field label={v.choice === 'transfer-out' ? 'به کدام حساب' : 'از کدام حساب'}>
                    <select className="fin-input" aria-label={v.choice === 'transfer-out' ? 'به کدام حساب' : 'از کدام حساب'} value={v.otherAccountId} onChange={(e) => setDraft(s.id, { otherAccountId: e.target.value })}>
                      <option value="">— انتخاب —</option>
                      {accounts
                        .filter((a) => a.id !== v.accountId)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                ) : null}
                {s.accountId ? null : (
                  <Field label="حساب">
                    <select className="fin-input" aria-label="حساب" value={v.accountId} onChange={(e) => setDraft(s.id, { accountId: e.target.value })}>
                      <option value="">— انتخاب —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {s.date ? null : <JalaliDate label="تاریخ" value={v.date} onChange={(iso) => setDraft(s.id, { date: iso })} yearsBack={2} yearsAhead={0} />}
                {s.uncertainAmount ? (
                  <TomanInput label="مبلغ درست (تومان)" value={drafts[s.id]?.amount ?? String(s.amountRial / 10)} onChange={(x) => setDraft(s.id, { amount: x })} />
                ) : null}
              </div>
              {s.direction === 'in' && v.accountId && d.biz && d.accounts.find((x) => x.id === v.accountId)?.bizId ? (
                <p className="fin-hint" data-testid="biz-deposit-hint">
                  این واریز به حساب کسب‌وکار است. اگر پول فروش کارتی است که در «صندوق فروش» ثبت کرده‌اید، «نادیده بگیر» را بزنید تا دوبار ثبت نشود — موجودی همچنان از مانده
                  همین پیامک می‌آید.
                </p>
              ) : null}
              <div className="fin-actions">
                <button
                  className="fin-mini"
                  onClick={() => commit([s.id])}
                  disabled={!v.choice}
                >
                  ثبت
                </button>
                <button className="fin-mini ghost" onClick={() => update((dr) => dismissStaged(dr, [s.id]))}>
                  نادیده بگیر
                </button>
                <details className="fin-details">
                  <summary>متن اصلی</summary>
                  <pre className="fin-raw">{s.raw}</pre>
                </details>
              </div>
              {errors[s.id] ? (
                <p className="fin-err" role="alert">
                  {errors[s.id]}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {shown.length > limit ? (
        <button className="fin-mini" onClick={() => setLimit((x) => x + 40)}>
          نمایش {faN(Math.min(40, shown.length - limit))} ردیف دیگر
        </button>
      ) : null}
    </Card>
  );
}

function Import({ d }: { d: FinanceData }) {
  return (
    <>
      <PageHead title="ورود از بانک">
        گردش حساب بانک یا پیامک‌های بانکی را بدهید تا لازم نباشد تراکنش‌ها را یکی‌یکی تایپ کنید. همه‌چیز اول به «صف بررسی» می‌رود و فقط با تأیید شما در دفتر ثبت می‌شود. فایل و
        پیامک از همین مرورگر بیرون نمی‌رود.
      </PageHead>
      {unlinkedSources(d).length ? (
        <p className="banner info">
          {faN(unlinkedSources(d).length)} کارت یا حساب از پیامک‌ها شناسایی شده که هنوز به حسابی وصل نیست. <Link href="/accounts">وصلشان کنید</Link> تا تراکنش‌ها و مانده
          بانکشان خودکار به همان حساب برود.
        </p>
      ) : null}
      <div className="fin-cols">
        <StatementCard d={d} />
        <SmsCard d={d} />
      </div>
      <Queue d={d} />
    </>
  );
}

export default function ImportView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Import d={d} />}</WithBook>
    </div>
  );
}
