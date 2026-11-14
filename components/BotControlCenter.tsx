'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Activity, ArrowUpLeft, Bot, ChartNoAxesCombined, Clock3, ShieldCheck } from 'lucide-react';
import { loadLocalSession } from '@/lib/live-local';
import { loadSwingSession } from '@/lib/swing-local';
import { loadFutures } from '@/lib/futures-local';
import { fmtDateTimeFa } from '@/lib/num';

interface BotCard { id: string; name: string; detail: string; href: string; state: 'empty' | 'active' | 'finished' | 'idle'; at: number; positions: number; trades: number }
const LABEL = { empty: 'هنوز شروع نشده', active: 'فعال روی دستگاه', finished: 'پایان‌یافته', idle: 'آماده' };
function read(): BotCard[] {
  const live = loadLocalSession(), swing = loadSwingSession(), futures = loadFutures();
  return [
    { id: 'live', name: 'معامله‌گر چندبازاره', detail: 'طلا، ارز و رمزارز · سبد و مدیریت ریسک', href: '/live', state: !live ? 'empty' : live.status === 'running' ? 'active' : 'finished', at: live?.lastTickAt ?? 0, positions: Object.values(live?.positions ?? {}).filter(Boolean).length, trades: live?.trades?.length ?? 0 },
    { id: 'swing', name: 'ربات نوسان‌گیر', detail: 'روند بازار · ورود، خروج و کارنامه جلسه', href: '/swing', state: !swing ? 'empty' : swing.status === 'running' ? 'active' : 'finished', at: swing?.lastTickAt ?? 0, positions: swing?.open?.length ?? 0, trades: swing?.fills?.length ?? 0 },
    { id: 'futures', name: 'ربات فیوچرز', detail: 'اهرم، حد ضرر، فاندینگ و موقعیت‌های باز', href: '/futures', state: !futures ? 'empty' : futures.auto || futures.positions?.length ? 'active' : 'idle', at: futures?.lastTickAt ?? 0, positions: futures?.positions?.length ?? 0, trades: futures?.fills?.length ?? 0 },
  ];
}

export default function BotControlCenter() {
  const [bots, setBots] = useState<BotCard[] | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const sync = () => { setBots(read()); setNow(Date.now()); };
    sync();
    const timer = setInterval(sync, 30_000);
    window.addEventListener('storage', sync);
    window.addEventListener('imf:bot-session', sync);
    return () => { clearInterval(timer); window.removeEventListener('storage', sync); window.removeEventListener('imf:bot-session', sync); };
  }, []);
  return <section className="bot-center" aria-label="مرکز کنترل ربات‌ها">
    <div className="bot-center-head"><div><span className="section-eyebrow"><Bot size={18} aria-hidden="true" /> دستیارهای معاملاتی</span><h2>همه ربات‌ها، یک مرکز کنترل</h2><p>وضعیت جلسات شخصی روی همین دستگاه؛ برای تنظیم یا توقف، صفحه هر ربات را باز کنید.</p></div><span className="bot-paper"><ShieldCheck size={16} aria-hidden="true" /> معاملات کاغذی</span></div>
    <div className="bot-grid">
      {bots ? bots.map((bot) => {
        const stale = bot.state === 'active' && (!bot.at || now - bot.at > 10 * 60_000);
        return <article className="bot-card" key={bot.id}>
          <div className="bot-card-top"><span className="bot-icon"><ChartNoAxesCombined size={24} aria-hidden="true" /></span><span className={`state-pill ${stale ? 'warn' : bot.state === 'active' ? 'ok' : ''}`}>{stale ? 'نیازمند به‌روزرسانی' : LABEL[bot.state]}</span></div>
          <h3>{bot.name}</h3><p>{bot.detail}</p>
          <dl className="bot-numbers"><div><dt>موقعیت باز</dt><dd>{bot.positions.toLocaleString('fa-IR')}</dd></div><div><dt>معامله ثبت‌شده</dt><dd>{bot.trades.toLocaleString('fa-IR')}</dd></div></dl>
          <span className="bot-updated"><Clock3 size={14} aria-hidden="true" />{bot.at ? fmtDateTimeFa(bot.at) : 'بدون اجرای ثبت‌شده'}</span>
          <Link href={bot.href}>{bot.state === 'empty' ? 'بررسی و راه‌اندازی' : 'مدیریت و مشاهده کارنامه'}<ArrowUpLeft size={18} aria-hidden="true" /></Link>
        </article>;
      }) : <p role="status">در حال خواندن وضعیت ربات‌ها…</p>}
    </div>
    <p className="bot-center-note"><Activity size={16} aria-hidden="true" /> جلسات دستگاه هنگام باز بودن اپ به‌روزرسانی می‌شوند. این سه ربات سفارش واقعی به صرافی ارسال نمی‌کنند؛ اتصال آبان‌تتر بخش جداگانه‌ای است.</p>
  </section>;
}
