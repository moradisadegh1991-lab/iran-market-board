'use client';
import { useState } from 'react';
import { fmtInt } from '@/lib/num';
import { WithSnapshot } from '../SnapshotProvider';
import { PageHead } from '../ui';

const age = (s: number | null) => (s === null ? 'هرگز' : s < 90 ? 'همین حالا' : s < 3600 ? `${fmtInt(s / 60)} دقیقه پیش` : s < 86400 ? `${fmtInt(s / 3600)} ساعت پیش` : `${fmtInt(s / 86400)} روز پیش`);

export default function BotView({ botUsername }: { botUsername: string }) {
  const [secret, setSecret] = useState('');
  const [state, setState] = useState<{ busy: boolean; msg: string }>({ busy: false, msg: '' });

  async function send() {
    setState({ busy: true, msg: '' });
    try {
      const res = await fetch('/api/telegram/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret }, body: '{}' });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error === 'forbidden' ? 'رمز مدیر اشتباه است.' : j.error || 'ارسال انجام نشد.');
      setState({ busy: false, msg: `ارسال شد: ${j.messages} پیام به ${j.sent} گفتگو${j.failed?.length ? `. ${j.failed.length} مورد ناموفق (${j.failed[0].chat}: ${j.failed[0].error})` : ''}` });
    } catch (e) {
      setState({ busy: false, msg: e instanceof Error ? e.message : 'ارسال انجام نشد.' });
    }
  }

  return (
    <div className="wrap">
      <PageHead title="ربات تلگرام و وضعیت منابع">همه بخش‌های سایت در ربات هم هست. با /start گزارش روزانه ساعت ۸ صبح برایتان فعال می‌شود.</PageHead>
      <div className="split">
        <section className="panel pad">
          <h2>دستورهای ربات</h2>
          {botUsername ? (
            <p>
              <a className="btn" href={`https://t.me/${botUsername}`}>باز کردن @{botUsername}</a>
            </p>
          ) : (
            <p className="muted">نام ربات در NEXT_PUBLIC_BOT_USERNAME تنظیم نشده است.</p>
          )}
          <ul className="cmds">
            <li><code>/prices</code> قیمت لحظه‌ای</li>
            <li><code>/scenarios</code> بدترین و بهترین سناریو</li>
            <li><code>/risk</code> ریسک در ۶ افق</li>
            <li><code>/stocks</code> ۱۰ سهم یک‌ماهه</li>
            <li><code>/crypto</code> و <code>/meme</code> فهرست‌های هفتگی</li>
            <li><code>/portfolio</code> سبد متعادل؛ <code>/portfolio_safe</code> و <code>/portfolio_bold</code></li>
            <li><code>/all</code> گزارش کامل</li>
          </ul>
        </section>
        <section className="panel pad">
          <h2>ارسال فوری گزارش</h2>
          <p className="muted">گزارش کامل به کانال و همه مشترکان فرستاده می‌شود.</p>
          <div className="admin">
            <input type="password" placeholder="رمز مدیر (ADMIN_SECRET)" value={secret} onChange={(e) => setSecret(e.target.value)} aria-label="رمز مدیر" />
            <button className="btn" onClick={send} disabled={!secret || state.busy}>
              {state.busy ? 'در حال ارسال…' : 'ارسال به تلگرام'}
            </button>
          </div>
          {state.msg ? <p className="small" role="status">{state.msg}</p> : null}
        </section>
      </div>

      <WithSnapshot>
        {(snap) => (
          <section className="panel table-scroll" style={{ marginTop: 20 }}>
            <table className="t">
              <caption>وضعیت منابع داده (برای بررسی کامل: <code>/api/diag?secret=…</code>)</caption>
              <thead>
                <tr>
                  <th scope="col">منبع</th>
                  <th scope="col">وضعیت</th>
                  <th scope="col">آخرین دریافت موفق</th>
                  <th scope="col">خطا</th>
                </tr>
              </thead>
              <tbody>
                {snap.sources.map((s) => (
                  <tr key={s.name}>
                    <th scope="row" className="sym">{s.label}</th>
                    <td>
                      <span className={`state-pill ${!s.ok && s.ageSec === null ? 'bad' : s.stale || !s.ok ? 'warn' : 'ok'}`}>
                        {!s.ok && s.ageSec === null ? 'در دسترس نیست' : !s.ok ? 'داده قدیمی' : s.stale ? 'کمی قدیمی' : 'فعال'}
                      </span>
                      {s.via === 'ingest' ? <small className="muted"> ارسال از ایران</small> : null}
                    </td>
                    <td className="num">{age(s.ageSec)}</td>
                    <td className="reasons ltr-text">{s.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </WithSnapshot>
    </div>
  );
}
