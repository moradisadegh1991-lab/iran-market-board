'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useSnapshot } from './SnapshotProvider';
import { fmtDateTimeFa } from '@/lib/num';
import { IN_APP } from '@/lib/api';

/** Personal finance first: this is a money app for one household that also watches the market. */
export const FIN_PAGES = [
  { href: '/', label: 'داشبورد' },
  { href: '/transactions', label: 'تراکنش‌ها' },
  { href: '/import', label: 'ورود از بانک' },
  { href: '/budget', label: 'بودجه' },
  { href: '/debts', label: 'وام، چک و قبض' },
  { href: '/goals', label: 'اهداف' },
  { href: '/accounts', label: 'حساب و دارایی' },
  { href: '/tools', label: 'ماشین‌حساب‌ها' },
  { href: '/advisor', label: 'مشاور' },
];

export const PAGES = [
  { href: '/market', label: 'نمای بازار' },
  { href: '/scenarios', label: 'سناریوها' },
  { href: '/simulator', label: 'معامله‌گر' },
  { href: '/live', label: 'معامله برخط' },
  { href: '/swing', label: 'نوسان‌گیری' },
  { href: '/charts', label: 'نمودار' },
  { href: '/risk', label: 'ریسک' },
  { href: '/stocks', label: 'بورس' },
  { href: '/crypto', label: 'کریپتو' },
  { href: '/portfolio', label: 'سبد' },
  { href: '/bot', label: 'ربات و منابع' },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { snap, busy, error, refresh } = useSnapshot();
  const tabsRef = useRef<HTMLDivElement>(null);
  const failing = snap?.sources.filter((s) => !s.ok && s.ageSec === null).length ?? 0;
  const inFinance = FIN_PAGES.some((p) => p.href === path);
  const tabs = inFinance ? FIN_PAGES : PAGES;

  useEffect(() => {
    tabsRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [path]);

  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <div className="brand">
            <Link href="/" className="wordmark" aria-label="مالی من، صفحه اصلی">
              مالی من
            </Link>
            <nav className="section-switch" aria-label="بخش">
              <Link href="/" aria-current={inFinance ? 'true' : undefined}>
                مالی شخصی
              </Link>
              <Link href="/market" aria-current={!inFinance ? 'true' : undefined}>
                بازار
              </Link>
              {IN_APP ? (
                // the phone-only tools (automatic SMS expenses, price alerts, per-device live
                // trading, the game) are the earlier app, bundled at /classic/. A file path, not
                // a route: the app's local server answers every extension-less path with /index.html.
                <a href="/classic/index.html">گوشی</a>
              ) : null}
            </nav>
          </div>
          <div className="status" aria-live="polite">
            {snap ? (
              <span className={`dot ${error ? 'bad' : failing ? 'warn' : 'ok'}`} title={error ?? (failing ? `${failing} منبع در دسترس نیست` : 'همه منابع در دسترس')} />
            ) : null}
            <span className="when">{snap ? fmtDateTimeFa(snap.generatedAt) : 'در حال دریافت…'}</span>
            <button className="icon-btn" onClick={refresh} disabled={busy} aria-label="به‌روزرسانی داده‌ها">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className={busy ? 'spin' : ''}>
                <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      <nav className="tabs" aria-label="صفحه‌ها">
        <div className="wrap tabs-inner" ref={tabsRef}>
          {tabs.map((p) => (
            <Link key={p.href} href={p.href} aria-current={path === p.href ? 'page' : undefined}>
              {p.label}
            </Link>
          ))}
        </div>
      </nav>
      {error && snap ? (
        <div className="wrap">
          <p className="banner warn" role="alert">
            آخرین به‌روزرسانی قیمت‌ها ناموفق بود ({error}). اعداد مربوط به آخرین دریافت موفق است.
          </p>
        </div>
      ) : null}
      <main className="page">{children}</main>
      <footer className="foot">
        <div className="wrap">
          دفتر مالی شما فقط در همین مرورگر ذخیره می‌شود و به سرور نمی‌رود. قیمت‌ها: TGJU، Gold API، نوبیتکس، BrsApi، TSETMC و CoinGecko. تحلیل‌ها و پاسخ‌های مشاور الگوریتمی‌اند و توصیه قطعی خرید یا فروش نیستند.
        </div>
      </footer>
    </>
  );
}
