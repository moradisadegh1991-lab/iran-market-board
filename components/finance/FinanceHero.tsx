'use client';
import Link from 'next/link';
import { ArrowUpLeft, Bot, CalendarDays, CreditCard, Plus, ShieldCheck, Target, Wallet } from 'lucide-react';
import type { NetWorth } from '@/lib/finance/calc';
import { fmtDateFa, Money } from './kit';

const shortcuts = [
  { href: '/transactions', label: 'ثبت تراکنش', hint: 'دخل و خرج روزمره', Icon: Plus },
  { href: '/accounts', label: 'حساب‌های من', hint: 'موجودی و کارت‌ها', Icon: CreditCard },
  { href: '/goals', label: 'اهداف پس‌انداز', hint: 'قدم بعدی برای آینده', Icon: Target },
  { href: '/bot', label: 'مرکز ربات‌ها', hint: 'وضعیت و کنترل', Icon: Bot },
];

export default function FinanceHero({ today, worth }: { today: string; worth: NetWorth }) {
  return <>
    <section className="finance-hero" aria-label="نمای کلی مالی">
      <div className="finance-hero-intro">
        <span className="hero-kicker"><span className="hero-dot" /> نمای شخصی شما</span>
        <h1>پول امروز،<br /><span>آرامش فردا.</span></h1>
        <p>حساب‌ها، تصمیم‌ها و هدف‌های مالی‌تان را<br className="hero-break" /> در یک نگاه دنبال کنید.</p>
        <span className="hero-date"><CalendarDays size={16} aria-hidden="true" />{fmtDateFa(today)}</span>
      </div>
      <div className="hero-balance">
        <div className="hero-balance-label"><Wallet size={20} aria-hidden="true" /><span>دارایی خالص من</span><span className="hero-unit">تومان</span></div>
        <div className="hero-amount"><Money rial={worth.netRial} short /></div>
        <p>دارایی‌ها + طلب − بدهی</p>
        {worth.unpriced.length ? <p className="hero-price-note">بدون قیمت: {worth.unpriced.join('، ')}</p> : worth.lastPriced.length ? <p className="hero-price-note">{worth.lastPriced.length.toLocaleString('fa-IR')} دارایی با آخرین قیمت ذخیره‌شده</p> : null}
        <Link href="/assets">جزئیات سرمایه‌ها <ArrowUpLeft size={18} aria-hidden="true" /></Link>
        <span className="hero-private"><ShieldCheck size={15} aria-hidden="true" /> دفتر مالی روی همین دستگاه ذخیره می‌شود</span>
      </div>
    </section>
    <nav className="finance-shortcuts" aria-label="دسترسی سریع مالی">
      {shortcuts.map(({ href, label, hint, Icon }) => <Link key={href} href={href}><span className="shortcut-icon"><Icon size={22} aria-hidden="true" /></span><span><b>{label}</b><small>{hint}</small></span><ArrowUpLeft className="shortcut-arrow" size={17} aria-hidden="true" /></Link>)}
    </nav>
  </>;
}
