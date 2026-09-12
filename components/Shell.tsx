'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useSnapshot } from './SnapshotProvider';
import { fmtDateTimeFa } from '@/lib/num';

export const PAGES = [
  { href: '/', label: 'نمای کلی' },
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

  useEffect(() => {
    tabsRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [path]);

  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <Link href="/" className="wordmark" aria-label="تابلوی بازار، صفحه اصلی">
            تابلوی بازار
          </Link>
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
          {PAGES.map((p) => (
            <Link key={p.href} href={p.href} aria-current={path === p.href ? 'page' : undefined}>
              {p.label}
            </Link>
          ))}
        </div>
      </nav>
      {error && snap ? (
        <div className="wrap">
          <p className="banner warn" role="alert">
            آخرین به‌روزرسانی ناموفق بود ({error}). اعداد مربوط به آخرین دریافت موفق است.
          </p>
        </div>
      ) : null}
      <main className="page">{children}</main>
      <footer className="foot">
        <div className="wrap">منابع: TGJU، Gold API، نوبیتکس، BrsApi، TSETMC و CoinGecko. همه تحلیل‌ها الگوریتمی‌اند و توصیه خرید یا فروش نیستند.</div>
      </footer>
    </>
  );
}
