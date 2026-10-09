'use client';
import BizSync from './biz/BizSync';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSnapshot } from './SnapshotProvider';
import { useNotify } from './NotifyProvider';
import { fmtDateTimeFa } from '@/lib/num';
import { BOTTOM_TABS, NAV_GROUPS, pageOf } from './nav';
import Assistant from './assistant/Assistant';
import { onAssist } from '@/lib/voice-io';
import { Bell, LayoutGrid, Mic, RefreshCw } from 'lucide-react';
import { PageIcon } from './icons';

/**
 * One app: on a phone a compact header, a bottom bar for the four places used every day and a
 * «بیشتر» sheet with every page; on a wide screen the same list as a sidebar. All navigation is
 * client-side <Link> — inside the APK an <a href="/x"> would always land on the dashboard
 * (CLAUDE.md rule 35).
 */

// the bottom bar and the header use the same Lucide set as the menu (components/icons.tsx)
const Icon = ({ k }: { k: string }) => (k === 'more' ? <LayoutGrid size={24} strokeWidth={1.9} aria-hidden="true" /> : <PageIcon href={k} size={24} />);
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
                  <PageIcon href={p.href} />
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

  // a business's page for its customers (/shop, rule 80): none of the owner's app around it
  if (path === '/shop')
    return (
      <div className="app public">
        <main className="page">{children}</main>
      </div>
    );

  return (
    <div className="app">
      <BizSync />
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
              <Mic size={18} strokeWidth={2} aria-hidden="true" />
            </button>
            <Link href="/alerts" className="icon-btn bell" aria-label={unread ? `هشدار و اعلان‌ها، ${unread.toLocaleString('fa-IR')} اعلان تازه` : 'هشدار و اعلان‌ها'}>
              {unread ? <span className="badge">{unread > 9 ? '۹+' : unread.toLocaleString('fa-IR')}</span> : null}
              <Bell size={18} strokeWidth={2} aria-hidden="true" />
            </Link>
            <button className="icon-btn" onClick={refresh} disabled={busy} aria-label="به‌روزرسانی قیمت‌ها">
              <RefreshCw size={18} strokeWidth={2} aria-hidden="true" className={busy ? 'spin' : ''} />
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
