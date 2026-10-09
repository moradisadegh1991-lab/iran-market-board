'use client';
import { useEffect, useMemo, useState } from 'react';
import { NOTIFY_CATS, type PriceAlert } from '@/lib/alerts';
import { isNum } from '@/lib/num';
import { useNotify } from '../NotifyProvider';
import { useSnapshot } from '../SnapshotProvider';
import { Empty, PageHead, Toggle } from '../ui';
import { Card, Field, parseAmount } from '../finance/kit';

const faN = (n: number, d = 0) => n.toLocaleString('fa-IR', { maximumFractionDigits: d });
const unitLabel = (u?: string) => (u === 'usd' ? 'دلار' : u === 'point' ? 'واحد' : 'تومان');
const timeFa = (ms: number) => new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

export default function AlertsView() {
  const { prefs, setPrefs, alerts, setAlerts, log, askPermission, native, notify, markRead, unread } = useNotify();
  // opening the list reads it: the bell's badge clears (and again for notices that arrive while here)
  useEffect(() => {
    if (unread) markRead();
  }, [unread, markRead]);
  const { snap } = useSnapshot();
  const items = useMemo(() => (snap?.live.items ?? []).filter((i) => isNum(i.price)), [snap]);
  const [asset, setAsset] = useState('');
  const [dir, setDir] = useState<PriceAlert['dir']>('above');
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const chosen = items.find((i) => i.key === (asset || items[0]?.key));

  function add() {
    const v = parseAmount(value);
    if (!chosen || !(v > 0)) return setMsg('دارایی و یک قیمت مثبت وارد کنید.');
    setAlerts([{ asset: chosen.key, dir, value: v, fired: 0 }, ...alerts]);
    setValue('');
    setMsg(null);
  }

  return (
    <div className="wrap">
      <PageHead title="هشدار قیمت و اعلان‌ها">
        برای قیمت‌هایی که برایتان مهم است هشدار بگذارید و انتخاب کنید از چه رویدادهایی خبردار شوید. هشدارها هر بار که قیمت‌های تازه می‌رسد بررسی می‌شوند.
      </PageHead>

      <p className="banner info">
        اعلان‌ها وقتی اپ بسته است فرستاده نمی‌شوند. هر بار که اپ را باز کنید قیمت‌ها بررسی و هشدارهای رسیده اعلام می‌شوند.
      </p>

      <div className="fin-cols">
        <Card title="هشدارهای قیمت من">
          {alerts.length ? (
            <ul className="fin-list">
              {alerts.map((a, i) => {
                const it = items.find((x) => x.key === a.asset);
                const now = it && isNum(it.price) ? it.price : null;
                return (
                  <li key={`${a.asset}-${a.value}-${i}`} className={a.fired ? 'muted' : ''}>
                    <span className="fin-list-main">
                      <b>
                        {it?.label ?? a.asset} {a.dir === 'above' ? 'بالاتر از' : 'پایین‌تر از'} {faN(a.value)} {unitLabel(it?.unit)}
                      </b>
                      <small>
                        {a.fired ? `اجرا شد · ${timeFa(a.fired)}` : now !== null ? `الان ${faN(now)} · ${faN(Math.abs((a.value / now - 1) * 100), 1)}٪ فاصله` : 'قیمت فعلی در دسترس نیست'}
                      </small>
                    </span>
                    {a.fired ? (
                      <button className="fin-mini" onClick={() => setAlerts(alerts.map((x, j) => (j === i ? { ...x, fired: 0 } : x)))}>
                        فعال دوباره
                      </button>
                    ) : null}
                    <button className="fin-mini ghost" aria-label="حذف هشدار" onClick={() => setAlerts(alerts.filter((_, j) => j !== i))}>
                      حذف
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty art="alerts">هنوز هشداری تعریف نشده است.</Empty>
          )}
          <div className="fin-grid alert-form">
            <Field label="دارایی">
              <select className="fin-input" aria-label="دارایی" value={chosen?.key ?? ''} onChange={(e) => setAsset(e.target.value)}>
                {items.map((i) => (
                  <option key={i.key} value={i.key}>
                    {i.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="وقتی قیمت">
              <select className="fin-input" aria-label="جهت" value={dir} onChange={(e) => setDir(e.target.value as PriceAlert['dir'])}>
                <option value="above">بالاتر رفت از</option>
                <option value="below">پایین‌تر آمد از</option>
              </select>
            </Field>
            <Field label={`قیمت (${unitLabel(chosen?.unit)})`} hint={chosen && isNum(chosen.price) ? `الان: ${faN(chosen.price)}` : ' '}>
              <input className="fin-input" aria-label="قیمت هشدار" inputMode="decimal" dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} placeholder={chosen && isNum(chosen.price) ? String(Math.round(chosen.price)) : ''} />
            </Field>
          </div>
          <div className="fin-actions">
            <button className="btn run" onClick={add} disabled={!items.length}>
              افزودن هشدار
            </button>
            {msg ? <span className="fin-err">{msg}</span> : null}
          </div>
        </Card>

        <Card title="از چه چیزهایی خبردار شوم؟">
          <div className="notif-prefs">
            <Toggle checked={prefs.on} onChange={(v) => setPrefs({ ...prefs, on: v })}>
              <b>همه اعلان‌ها</b>
            </Toggle>
            {NOTIFY_CATS.map((c) => (
              <Toggle key={c.k} checked={prefs.on && prefs[c.k]} onChange={(v) => setPrefs({ ...prefs, [c.k]: v })}>
                <span>
                  {c.t}
                  <small className="muted"> — {c.d}</small>
                </span>
              </Toggle>
            ))}
            <Field label="آستانه جهش روزانه (٪)" hint="بالاتر از این درصد تغییر در یک روز، اعلان می‌آید">
              <input
                className="fin-input sm"
                inputMode="decimal"
                dir="ltr"
                defaultValue={String(prefs.movePct)}
                key={prefs.movePct}
                onBlur={(e) => {
                  const n = parseAmount(e.target.value);
                  setPrefs({ ...prefs, movePct: n > 0 ? n : 2 });
                }}
              />
            </Field>
          </div>
          <div className="fin-actions" style={{ marginTop: 12 }}>
            <button
              className="fin-mini"
              onClick={async () => {
                const r = await askPermission();
                if (r === 'granted') notify('اعلان‌ها فعال شد', native ? 'از این پس رویدادهای اپ روی گوشی اعلام می‌شوند.' : 'در مرورگر فقط تا وقتی صفحه باز است کار می‌کند.', 'trade');
                else setMsg(r === 'denied' ? 'اجازه اعلان داده نشد؛ از تنظیمات گوشی/مرورگر روشنش کنید.' : 'این دستگاه اعلان را پشتیبانی نمی‌کند.');
              }}
            >
              {native ? 'اجازه اعلان روی گوشی' : 'اجازه اعلان در مرورگر'}
            </button>
          </div>
        </Card>
      </div>

      <Card title="اعلان‌های اخیر">
        {log.length ? (
          <ul className="fin-list">
            {log.slice(0, 30).map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <span className="fin-list-main">
                  <b>{e.title}</b>
                  {e.body ? <small>{e.body}</small> : null}
                </span>
                <small className="muted">{timeFa(e.at)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>هنوز اعلانی ثبت نشده است.</Empty>
        )}
      </Card>
    </div>
  );
}
