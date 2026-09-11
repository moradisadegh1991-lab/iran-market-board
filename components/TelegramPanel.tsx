'use client';
import { useState } from 'react';

export default function TelegramPanel({ botUsername }: { botUsername: string }) {
  const [secret, setSecret] = useState('');
  const [state, setState] = useState<{ busy: boolean; msg: string }>({ busy: false, msg: '' });

  async function send() {
    setState({ busy: true, msg: '' });
    try {
      const res = await fetch('/api/telegram/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret }, body: '{}' });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error === 'forbidden' ? 'رمز مدیر اشتباه است.' : j.error || 'ارسال انجام نشد.');
      setState({ busy: false, msg: `ارسال شد: ${j.messages} پیام به ${j.sent} گفتگو${j.failed?.length ? ` — ${j.failed.length} مورد ناموفق` : ''}` });
    } catch (e) {
      setState({ busy: false, msg: e instanceof Error ? e.message : 'ارسال انجام نشد.' });
    }
  }

  return (
    <section className="block" id="telegram">
      <div className="wrap">
        <h2>ربات تلگرام</h2>
        <p className="lede">همه بخش‌های این صفحه در ربات هم هست. با /start گزارش روزانه ساعت ۸ صبح برایتان فعال می‌شود.</p>
        <div className="surface tg">
          <div>
            {botUsername ? (
              <p>
                ربات: <a href={`https://t.me/${botUsername}`}>@{botUsername}</a>
              </p>
            ) : (
              <p className="muted">نام ربات در NEXT_PUBLIC_BOT_USERNAME تنظیم نشده است.</p>
            )}
            <ul>
              <li><code>/prices</code> قیمت لحظه‌ای</li>
              <li><code>/risk</code> ریسک در ۶ افق</li>
              <li><code>/crypto</code> و <code>/meme</code> فهرست‌های هفتگی</li>
              <li><code>/stocks</code> ۱۰ سهم یک‌ماهه</li>
              <li><code>/portfolio</code> سبد متعادل، <code>/portfolio_safe</code> و <code>/portfolio_bold</code></li>
              <li><code>/all</code> گزارش کامل</li>
            </ul>
          </div>
          <div>
            <p>ارسال فوری گزارش کامل به کانال و همه مشترکان:</p>
            <div className="admin">
              <input type="password" placeholder="ADMIN_SECRET" value={secret} onChange={(e) => setSecret(e.target.value)} aria-label="رمز مدیر" />
              <button className="btn" onClick={send} disabled={!secret || state.busy}>
                {state.busy ? 'در حال ارسال…' : 'ارسال به تلگرام'}
              </button>
            </div>
            {state.msg ? <p className="small" role="status">{state.msg}</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
