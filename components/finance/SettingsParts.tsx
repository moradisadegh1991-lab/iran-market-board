'use client';
// Settings that used to live on the accounts page — now on /settings (rule 91): the figures the calculations rest on,
// and the backup of the whole book.
import { useRef, useState } from 'react';
import { emptyData, normalizeData, type FinanceData } from '@/lib/finance/model';
import { useFinance } from './FinanceProvider';
import { Card, NumInput, parseAmount } from './kit';
import { download } from './views/TransactionsView';

function SettingField({ d, k, label, hint }: { d: FinanceData; k: 'inflationPct' | 'safeYieldPct' | 'emergencyMonths'; label: string; hint: string }) {
  const { update } = useFinance();
  const [v, setV] = useState(String(d.settings[k]));
  const n = parseAmount(v);
  const valid = Number.isFinite(n) && n >= 0 && n <= 1000;
  return (
    <NumInput
      label={label}
      hint={valid ? hint : 'عدد نامعتبر — ذخیره نشد'}
      value={v}
      onChange={(x) => {
        setV(x);
        const m = parseAmount(x);
        if (Number.isFinite(m) && m >= 0 && m <= 1000) update((dr) => void (dr.settings[k] = m));
      }}
    />
  );
}

export function SettingsCard({ d }: { d: FinanceData }) {
  return (
    <Card title="مبنای محاسبات مالی">
      <div className="fin-grid">
        <SettingField d={d} k="inflationPct" label="تورم سالانه مورد انتظار (٪)" hint="برای قیمت آینده اهداف و بازده واقعی" />
        <SettingField d={d} k="safeYieldPct" label="سود صندوق درآمد ثابت (٪ سالانه)" hint="حداقل بازدهی که هر انتخاب دیگری باید از آن بیشتر باشد" />
        <SettingField d={d} k="emergencyMonths" label="صندوق اضطراری (ماه خرج)" hint="معمولاً ۳ تا ۶ ماه؛ برای درآمد ناپایدار بیشتر" />
      </div>
    </Card>
  );
}

export function Backup({ d }: { d: FinanceData }) {
  const { replace, today } = useFinance();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card title="پشتیبان و انتقال">
      <p className="muted small">
        دفتر فقط در همین مرورگر است؛ پاک کردن داده‌های مرورگر یا عوض کردن گوشی آن را از بین می‌برد. هر چند وقت یک بار فایل پشتیبان بگیرید. فایل پشتیبان رمزگذاری نشده؛ جای امنی نگهش دارید.
      </p>
      <div className="fin-actions">
        <button className="btn" onClick={() => void download(`mali-man-backup-${today}.json`, JSON.stringify(d, null, 1), 'application/json')}>
          دریافت فایل پشتیبان
        </button>
        <button className="fin-mini" onClick={() => file.current?.click()}>
          بازگردانی از فایل
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const next = normalizeData(JSON.parse(await f.text()), today);
              if (!window.confirm(`دفتر فعلی با این فایل جایگزین شود؟ (${next.txns.length.toLocaleString('fa-IR')} تراکنش، ${next.accounts.length.toLocaleString('fa-IR')} حساب)`)) return;
              replace(next);
              setMsg('بازگردانی شد.');
            } catch (err) {
              setMsg(err instanceof Error ? err.message : 'فایل خوانده نشد.');
            }
          }}
        />
        <button
          className="fin-mini ghost"
          onClick={() => {
            if (window.confirm('همه داده‌های مالی این مرورگر پاک شود؟ اول پشتیبان بگیرید.') && window.confirm('مطمئن هستید؟ این کار برگشت ندارد.')) {
              replace(emptyData(today));
              setMsg('دفتر خالی شد.');
            }
          }}
        >
          پاک کردن همه
        </button>
      </div>
      {msg ? (
        <p className="note" role="status">
          {msg}
        </p>
      ) : null}
    </Card>
  );
}
