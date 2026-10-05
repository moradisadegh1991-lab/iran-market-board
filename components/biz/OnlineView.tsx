'use client';
import { useEffect, useMemo, useState } from 'react';
import { api, API_BASE } from '@/lib/api';
import type { FinanceData } from '@/lib/finance/model';
import type { Business } from '@/lib/biz/model';
import { newToken, suggestSlug } from '@/lib/biz/online';
import { SLUG_RE } from '@/lib/biz/public';
import { qrSvg } from '@/lib/biz/qrcode';
import { useFinance } from '../finance/FinanceProvider';
import { Card, fmtDateFa } from '../finance/kit';
import { publishNow, pullNow } from './BizSync';
import { fa, faTime, WithBiz } from './kit';
import { tehranParts } from '@/lib/biz/slots';

const when = (ms?: number | null) => (ms ? `${fmtDateFa(tehranParts(ms).date)} ${faTime(ms)}` : '—');

function Qr({ url, title }: { url: string; title: string }) {
  const svg = useMemo(() => qrSvg(url, { size: 200, margin: 3 }), [url]);
  const [copied, setCopied] = useState(false);
  return (
    <figure className="biz-qr">
      <div className="biz-qr-img" role="img" aria-label={`کد QR ${title}`} dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption>
        <b>{title}</b>
        <bdi dir="ltr" className="biz-url">
          {url}
        </bdi>
        <span className="fin-actions">
          <button
            className="fin-mini"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                // no clipboard: the link is on screen
              }
            }}
          >
            {copied ? 'کپی شد ✓' : 'کپی لینک'}
          </button>
          <a className="fin-mini" href={url} target="_blank" rel="noreferrer">
            باز کردن
          </a>
        </span>
      </figcaption>
    </figure>
  );
}

function Online({ d, b }: { d: FinanceData; b: Business }) {
  const { update, data } = useFinance();
  const [slug, setSlug] = useState(b.online?.slug ?? suggestSlug(b.name));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [bot, setBot] = useState<string | null>(null);
  const origin = API_BASE || (typeof window !== 'undefined' ? window.location.origin : '');
  const live = !!b.online?.publishedAt;
  useEffect(() => {
    if (!live) return;
    fetch(api('/api/biz/bot'))
      .then((r) => r.json())
      .then((j) => setBot(j.bot ?? null))
      .catch(() => undefined);
  }, [live]);

  const publish = async () => {
    const s = slug.trim().toLowerCase();
    if (!SLUG_RE.test(s)) return setMsg({ ok: false, text: 'نامک: فقط حروف کوچک انگلیسی، عدد و خط تیره، ۳ تا ۳۲ حرف (مثلاً cafe-narenj).' });
    setBusy(true);
    setMsg(null);
    const box: { d: FinanceData | null } = { d: null };
    update((dr) => {
      const biz = dr.biz!;
      // a slug that was never published can still change; once live it is the customers' address
      if (!biz.online || !biz.online.publishedAt) biz.online = { slug: s, token: biz.online?.token ?? newToken(), seen: biz.online?.seen ?? [] };
      box.d = dr;
    });
    try {
      const r = await publishNow(box.d!, update);
      setBot(r.bot);
      setMsg({ ok: true, text: 'منتشر شد ✓ از این به بعد هر تغییر منو، ساعت یا نوبت‌ها خودکار به‌روز می‌شود.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'انتشار ناموفق بود.' });
    } finally {
      setBusy(false);
    }
  };

  const off = async () => {
    if (!b.online || !window.confirm('صفحه آنلاین و ربات این کسب‌وکار خاموش شود؟ سفارش‌هایی که هنوز دریافت نشده‌اند از بین می‌روند.')) return;
    setBusy(true);
    try {
      await pullNow(() => data, update).catch(() => null);
      const r = await fetch(api('/api/biz/unpublish'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: b.online.slug, token: b.online.token }) });
      const j = await r.json().catch(() => ({}));
      if (!j.ok && r.status !== 404) throw new Error(j.error ?? 'خاموش کردن ناموفق بود.');
      update((dr) => {
        dr.biz!.online = null;
      });
      setMsg({ ok: true, text: 'خاموش شد.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const shopUrl = b.online ? `${origin}/shop?b=${b.online.slug}` : '';
  const tgUrl = b.online && bot ? `https://t.me/${bot}?start=b_${b.online.slug}` : '';
  return (
    <>
      <Card title={live ? 'صفحه آنلاین روشن است' : 'روشن کردن فروشگاه آنلاین'}>
        <p className="small">
          مشتری‌ها از یک لینک یا کد QR — یا داخل تلگرام — منو را می‌بینند، سفارش می‌دهند و نوبت می‌گیرند؛ سفارش‌ها هر چند ثانیه یک بار در «سفارش‌ها» و «نوبت‌دهی» همین گوشی «در انتظار
          تأیید» می‌نشینند و با تأیید شما فاکتور، کسر انبار و ثبت پول انجام می‌شود. پرداخت آنلاین نیست: مشتری حضوری، کارت‌به‌کارت یا موقع تحویل پرداخت می‌کند.
        </p>
        <details className="biz-details">
          <summary>چه چیزی به سرور می‌رود؟</summary>
          <p className="small">
            فقط آن‌چه مشتری باید ببیند: نام، نوع، شهر، آدرس و تلفن کسب‌وکار، نام و قیمت محصولات و خدمات فعال، ساعات کاری و این‌که کدام ساعت‌ها پر است (بدون نام مشتری). دفتر مالی،
            فروش، سود، انبار و مشتری‌ها روی گوشی می‌مانند. نام و شماره‌ای که مشتری برای سفارش می‌نویسد تا وقتی گوشی شما آن را بردارد روی سرور می‌ماند و بعد پاک می‌شود (حداکثر ۳۰ روز).
          </p>
        </details>
        {!live ? (
          <div className="fin-grid">
            <label className="fin-field">
              <span className="fin-label">نامک (آدرس صفحه)</span>
              <input className="fin-input" dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} aria-label="نامک" placeholder="cafe-narenj" />
            </label>
            <p className="fin-span muted small" dir="ltr">
              {origin}/shop?b={slug || '…'}
            </p>
            <div className="fin-span fin-actions">
              <button className="btn" onClick={publish} disabled={busy}>
                {busy ? '…' : 'انتشار صفحه آنلاین'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="biz-qrs">
              <Qr url={shopUrl} title="صفحه سفارش و نوبت" />
              {tgUrl ? <Qr url={tgUrl} title="ربات تلگرام" /> : null}
            </div>
            {!tgUrl ? <p className="muted small">ربات تلگرام روی سرور تنظیم نشده؛ صفحه آنلاین کار می‌کند.</p> : null}
            <ul className="fin-list small">
              <li className="fin-list-row">
                <span>آخرین انتشار</span>
                <span>{when(b.online!.publishedAt)}</span>
              </li>
              <li className="fin-list-row">
                <span>آخرین دریافت سفارش</span>
                <span>{when(b.online!.pulledAt)}</span>
              </li>
              <li className="fin-list-row">
                <span>منتشرشده</span>
                <span>
                  {fa(b.products.filter((p) => p.active).length)} محصول، {fa(b.services.filter((s) => s.active).length)} خدمت
                </span>
              </li>
            </ul>
            {b.online!.error ? <p className="banner warn">آخرین تلاش: {b.online!.error}</p> : null}
            <div className="fin-actions">
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await pullNow(() => data, update);
                    setMsg({ ok: true, text: r && (r.orders || r.bookings) ? `${fa(r.orders)} سفارش و ${fa(r.bookings)} نوبت تازه رسید.` : 'چیز تازه‌ای نیست.' });
                  } catch (e) {
                    setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                دریافت سفارش‌ها
              </button>
              <button className="btn ghost" onClick={publish} disabled={busy}>
                انتشار دوباره
              </button>
              <button className="fin-mini ghost" onClick={off} disabled={busy}>
                خاموش کردن
              </button>
            </div>
          </>
        )}
        {msg ? <p className={msg.ok ? 'fin-ok' : 'fin-err'} role="status">{msg.text}</p> : null}
      </Card>
      {live ? (
        <Card title="چطور به مشتری‌ها بدهید">
          <ul className="biz-tips">
            <li>کد QR را چاپ کنید و روی پیشخوان، میز یا ویترین بچسبانید.</li>
            <li>لینک را در بیو اینستاگرام، استوری و واتس‌اپ بگذارید.</li>
            <li>در تلگرام، مشتری با لینک ربات مستقیم وارد منوی شما می‌شود؛ «/shops» در ربات همه کسب‌وکارهای منتشرشده را به تفکیک شهر نشان می‌دهد{b.city ? '' : ' (شهر را در تنظیمات کسب‌وکار بگذارید)'}.</li>
            <li>وقتی سفارش یا نوبت تلگرامی را تأیید، تحویل یا لغو کنید، ربات به مشتری خبر می‌دهد؛ مشتری صفحه وب هم با کد پیگیری وضعیتش را می‌بیند.</li>
          </ul>
        </Card>
      ) : null}
      {d.biz?.online && !live ? <p className="muted small">نامک «{d.biz.online.slug}» هنوز منتشر نشده.</p> : null}
    </>
  );
}

export default function OnlineView() {
  return <WithBiz title="فروشگاه آنلاین و ربات" lede="صفحه سفارش و نوبت برای مشتری‌ها، کد QR و ربات تلگرام — سفارش‌ها مستقیم به همین گوشی می‌آیند.">{(d, b) => <Online d={d} b={b} />}</WithBiz>;
}
