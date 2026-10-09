'use client';
// Shared pieces of the کسب‌وکار من pages: the business gate, the strip of business pages, the payment
// picker and small formatting helpers. Every page reads and writes the same book as the rest of the
// app (useFinance), so a sale shows up in «حساب‌ها و کارت‌ها» the moment it is made.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isMoneyAccount, type FinanceData } from '@/lib/finance/model';
import { PAY_LABEL, typeInfo, type Business, type PayMethod } from '@/lib/biz/model';
import { NAV_GROUPS } from '../nav';
import { WithBook } from '../finance/FinanceProvider';
import { PageHead } from '../ui';
import { download } from '../finance/views/TransactionsView';

export const fa = (n: number, digits = 0) => n.toLocaleString('fa-IR', { maximumFractionDigits: digits });
export const faTime = (ms: number) => new Date(ms).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' });
export const faDay = (ms: number) => new Date(ms).toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Tehran' });
export const WEEKDAYS_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
/** Saturday first, as an Iranian week reads */
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];

const BIZ_PAGES = NAV_GROUPS.find((g) => g.tone === 'copper')!.items;
const SHORT: Record<string, string> = {
  '/biz': 'داشبورد',
  '/biz/pos': 'صندوق',
  '/biz/orders': 'سفارش‌ها',
  '/biz/booking': 'نوبت',
  '/biz/products': 'محصولات',
  '/biz/stock': 'انبار',
  '/biz/customers': 'مشتری و نسیه',
  '/biz/money': 'هزینه و سود',
  '/biz/reports': 'تحلیل',
  '/biz/tax': 'مالیات',
  '/biz/online': 'آنلاین',
  '/biz/settings': 'تنظیمات',
};

/** The business pages, one tap away from each other. */
export function BizTabs({ b }: { b: Business }) {
  const path = usePathname();
  const service = typeInfo(b.type).kind === 'service';
  // a salon starts its day from bookings, a café from the till
  const pages = service ? [BIZ_PAGES[0], BIZ_PAGES[3], ...BIZ_PAGES.slice(1, 3), ...BIZ_PAGES.slice(4)] : BIZ_PAGES;
  return (
    <nav className="biz-tabs" aria-label="بخش‌های کسب‌وکار">
      {pages.map((p) => (
        <Link key={p.href} href={p.href} aria-current={path === p.href ? 'page' : undefined}>
          <span aria-hidden="true">{p.icon}</span> {SHORT[p.href] ?? p.label}
        </Link>
      ))}
    </nav>
  );
}

/** Renders a business page once the book is loaded and a business exists; otherwise points to the setup. */
export function WithBiz({ title, lede, children }: { title: string; lede?: React.ReactNode; children: (d: FinanceData, b: Business) => React.ReactNode }) {
  return (
    <div className="wrap biz">
      <WithBook>
        {(d) =>
          d.biz ? (
            <>
              <BizTabs b={d.biz} />
              <PageHead title={title}>{lede}</PageHead>
              {children(d, d.biz)}
            </>
          ) : (
            <>
              <PageHead title={title}>{lede}</PageHead>
              <p className="banner info">
                هنوز کسب‌وکاری تعریف نکرده‌اید. <Link href="/biz">از داشبورد کسب‌وکار شروع کنید</Link> — یک دقیقه طول می‌کشد.
              </p>
            </>
          )
        }
      </WithBook>
    </div>
  );
}

/** نقد / کارت / نسیه */
export function PayPicker({ value, onChange, b, allowCredit = true }: { value: PayMethod; onChange: (p: PayMethod) => void; b: Business; allowCredit?: boolean }) {
  const opts: PayMethod[] = allowCredit ? ['cash', 'card', 'credit'] : ['cash', 'card'];
  return (
    <div className="seg biz-pay" role="radiogroup" aria-label="روش پرداخت">
      {opts.map((p) => (
        <button key={p} role="radio" aria-checked={value === p} disabled={p === 'card' && !b.cardAccountId && !b.cashAccountId} onClick={() => onChange(p)}>
          {p === 'cash' ? '💵 ' : p === 'card' ? '💳 ' : '📒 '}
          {PAY_LABEL[p]}
        </button>
      ))}
    </div>
  );
}

/** The business's own accounts in the book (till, card), for paying an expense or receiving money. */
export function BizAccountSelect({ d, b, value, onChange, label, allowNone }: { d: FinanceData; b: Business; value: string; onChange: (v: string) => void; label: string; allowNone?: boolean }) {
  const accs = d.accounts.filter((a) => a.bizId === b.id && isMoneyAccount(a));
  return (
    <label className="fin-field">
      <span className="fin-label">{label}</span>
      <select className="fin-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {allowNone ? <option value="">بدون ثبت در دفتر</option> : null}
        {accs.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export const firstBizAccount = (b: Business) => b.cashAccountId ?? b.cardAccountId ?? '';

/** Opens the phone's SMS app with the recipients and text filled in; the owner sends it from their own line. */
export function smsHref(phones: string[], text: string): string {
  return `sms:${phones.join(',')}?body=${encodeURIComponent(text)}`;
}

/** A CSV (UTF-8 with BOM, opens in Excel) — saved through the share sheet in the app (rule 37). */
export const downloadText = (name: string, text: string) => download(name, text, 'text/csv;charset=utf-8');

/** A picture (data: URL) — the share sheet in the app, a download on the web. */
export async function downloadPng(name: string, dataUrl: string) {
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, any> } }).Capacitor;
  const fs = cap?.Plugins?.Filesystem;
  const share = cap?.Plugins?.Share;
  if (cap?.isNativePlatform?.() && fs && share) {
    // no encoding: the data is base64 and is written as bytes
    const { uri } = await fs.writeFile({ path: name, data: dataUrl.split(',')[1], directory: 'CACHE' });
    await share.share({ title: name, files: [uri], dialogTitle: 'ارسال یا چاپ فاکتور' }).catch(() => share.share({ title: name, url: uri }));
    return;
  }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  a.click();
}
