'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSnapshot } from './SnapshotProvider';
import { useNotify } from './NotifyProvider';
import { fmtDateTimeFa } from '@/lib/num';
import { BOTTOM_TABS, NAV_GROUPS, pageOf } from './nav';
import Assistant from './assistant/Assistant';
import { onAssist } from '@/lib/voice-io';

/**
 * One app: on a phone a compact header, a bottom bar for the four places used every day and a
 * «بیشتر» sheet with every page; on a wide screen the same list as a sidebar. All navigation is
 * client-side <Link> — inside the APK an <a href="/x"> would always land on the dashboard
 * (CLAUDE.md rule 35).
 */

const ICONS: Record<string, React.ReactNode> = {
  '/': <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  '/transactions': (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  '/market': (
    <>
      <path d="M4 19h16" />
      <path d="m5 15 4-5 4 3 6-7" />
      <path d="M15 6h4v4" />
    </>
  ),
  '/advisor': <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4.5 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" />,
  '/accounts': (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </>
  ),
  more: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
    </>
  ),
};
const Icon = ({ k }: { k: string }) => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    {ICONS[k]}
  </svg>
);
const BOTTOM_LABEL: Record<string, string> = { '/': 'خانه', '/transactions': 'تراکنش‌ها', '/accounts': 'حساب‌ها', '/market': 'بازار', '/advisor': 'مشاور' };

function Tiles({ path, onPick }: { path: string; onPick?: () => void }) {
  return (
    <>
      {NAV_GROUPS.map((g) => (
        <section key={g.title} className="nav-group">
          <h3>{g.title}</h3>
          <div className="tiles">
            {g.items.map((p) => (
              <Link key={p.href} href={p.href} className={`tile tone-${g.tone}`} aria-current={path === p.href ? 'page' : undefined} onClick={onPick}>
                <span className="tile-ic" aria-hidden="true">
                  {p.icon}
                </span>
                <span className="tile-t">{p.label}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { snap, busy, error, refresh } = useSnapshot();
  const { unread } = useNotify();
  const [more, setMore] = useState(false);
  const [ask, setAsk] = useState(false);
  // the phone asked for the assistant (assist gesture, tile, shortcut — rule 74): open it and listen
  const [assistN, setAssistN] = useState(0);
  // …by its name, «مالی من» (rule 75): if nothing is said after, it goes away again
  const [byName, setByName] = useState(false);
  useEffect(
    () =>
      onAssist(({ wake }) => {
        setAsk(true);
        setByName(wake);
        setAssistN((n) => n + 1);
      }),
    [],
  );
  const failing = snap?.sources.filter((s) => !s.ok && s.ageSec === null).length ?? 0;
  const here = pageOf(path);
  const inBottom = (BOTTOM_TABS as readonly string[]).includes(path);

  // the sheet closes on navigation and on Escape, and the page behind it does not scroll
  useEffect(() => setMore(false), [path]);
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMore(false);
    document.addEventListener('keydown', onKey);
    document.body.classList.add('sheet-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('sheet-open');
    };
  }, [more]);

  return (
    <div className="app">
      <header className="appbar">
        <div className="appbar-inner">
          <Link href="/" className="wordmark" aria-label="مالی من، خانه">
            مالی من
          </Link>
          <span className="appbar-title">{here && path !== '/' ? here.label : ''}</span>
          <div className="status" aria-live="polite">
            {snap ? (
              <span className={`dot ${error ? 'bad' : failing ? 'warn' : 'ok'}`} title={error ?? (failing ? `${failing} منبع در دسترس نیست` : 'همه منابع در دسترس')} />
            ) : null}
            <span className="when">{snap ? fmtDateTimeFa(snap.generatedAt) : 'در حال دریافت…'}</span>
            <button className="icon-btn" onClick={() => setAsk(true)} aria-label="دستیار صوتی: بپرسید یا تراکنش بگویید">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
              </svg>
            </button>
            <Link href="/alerts" className="icon-btn bell" aria-label={unread ? `هشدار و اعلان‌ها، ${unread.toLocaleString('fa-IR')} اعلان تازه` : 'هشدار و اعلان‌ها'}>
              {unread ? <span className="badge">{unread > 9 ? '۹+' : unread.toLocaleString('fa-IR')}</span> : null}
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />
              </svg>
            </Link>
            <button className="icon-btn" onClick={refresh} disabled={busy} aria-label="به‌روزرسانی قیمت‌ها">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className={busy ? 'spin' : ''}>
                <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="frame">
        <aside className="sidebar" aria-label="همه صفحه‌ها">
          <Tiles path={path} />
        </aside>
        <div className="content">
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
              دفتر مالی شما فقط روی همین دستگاه ذخیره می‌شود و به سرور نمی‌رود. قیمت‌ها: TGJU، Gold API، نوبیتکس، BrsApi، TSETMC و CoinGecko. تحلیل‌ها و پاسخ‌های مشاور الگوریتمی‌اند و
              توصیه قطعی خرید یا فروش نیستند.
            </div>
          </footer>
        </div>
      </div>

      <nav className="bottombar" aria-label="بخش‌های اصلی">
        {BOTTOM_TABS.map((href) => (
          <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>
            <Icon k={href} />
            <span>{BOTTOM_LABEL[href]}</span>
          </Link>
        ))}
        <button type="button" onClick={() => setMore(true)} aria-expanded={more} aria-current={!inBottom ? 'page' : undefined} aria-haspopup="dialog">
          <Icon k="more" />
          <span>{!inBottom && here ? here.label : 'بیشتر'}</span>
        </button>
      </nav>

      {more ? (
        <div className="sheet-wrap" onClick={() => setMore(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="همه بخش‌ها" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" aria-hidden="true" />
            <div className="sheet-head">
              <b>همه بخش‌ها</b>
              <button type="button" className="sheet-close" onClick={() => setMore(false)} aria-label="بستن">
                ✕
              </button>
            </div>
            <Tiles path={path} onPick={() => setMore(false)} />
          </div>
        </div>
      ) : null}
      {ask ? (
        <Assistant
          listen={assistN}
          byName={byName}
          onClose={() => {
            setAsk(false);
            setAssistN(0);
            setByName(false);
          }}
        />
      ) : null}
    </div>
  );
}
